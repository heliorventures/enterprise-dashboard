const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { validateSnapshot, ingestSnapshot, planIncremental, ledgerKey, projectKey, voucherKey } = require('../src/ingest');
const db = require('../src/db');

test('force replay keeps its marker and refuses to overwrite a newer batch', async () => {
  const { applySnapshot } = require('../src/ingest');
  for (const newer of [true, false]) {
    const calls = [];
    let writes = 0;
    const client = { query: async sql => {
      calls.push(sql);
      if (sql.includes('SELECT checksum')) return { rows: [{ checksum: 'old', company_id: 1 }] };
      if (sql.includes('SELECT 1 FROM tally_ingestions')) return { rows: newer ? [{}] : [] };
      return { rows: [] };
    } };
    const work = applySnapshot(client, { batchId: 'same', capturedAt: '2026-09-01T00:00:00Z', company: { name: 'Example' } }, 'new', async () => { writes++; return { ledgerCount: 1, voucherCount: 1 }; }, true);
    if (newer) await assert.rejects(work, /older snapshot/);
    else assert.equal((await work).duplicate, false);
    assert.equal(writes, newer ? 0 : 1);
    assert.ok(!calls.some(sql => sql.includes('DELETE FROM tally_ingestions')));
    assert.equal(calls.some(sql => sql.startsWith('UPDATE tally_ingestions')), !newer);
  }
});
const payload = () => ({
  batchId: 'test-1', capturedAt: '2026-09-08T10:00:00Z', fullSnapshot: true,
  company: { externalId: 'tally-guid-1', name: 'Test Company' },
  ledgers: [{ name: 'Sales', group: 'Sales Accounts', balance: '123.45' }],
  vouchers: [{ date: '2026-09-10', type: 'Sales', amount: '123.45', number: 'S1' }],
});
test('reject incomplete snapshots, invalid dates and imprecise amounts', () => {
  assert.notEqual(voucherKey({amount:'9999999999999999.99'}),voucherKey({amount:'9999999999999999.98'}));
  assert.throws(() => validateSnapshot({ ...payload(), vouchers: undefined }), /vouchers/);
  assert.throws(() => validateSnapshot({ ...payload(), fullSnapshot: false }), /fullSnapshot/);
  assert.throws(() => validateSnapshot({ ...payload(), capturedAt: '2026-02-30T10:00:00Z' }), /calendar date/);
  const invalid = payload(); invalid.vouchers[0].date = '2026-02-30';
  assert.throws(() => validateSnapshot(invalid), /date/);
  invalid.vouchers[0].date = '2026-09-10'; invalid.vouchers[0].amount = '1.123';
  assert.throws(() => validateSnapshot(invalid), /amount/);
  const valid = validateSnapshot(payload());
  assert.equal(valid.ledgers[0].sourceKey, 'ledger:sales');
  assert.equal(valid.vouchers[0].sourceKey, 'voucher|2026-09-10|Sales|S1|123.45|');
  assert.equal(projectKey({ name: ' Majalgaon-Beed ' }), 'project:majalgaon-beed');
  const tagged = payload();
  tagged.vouchers[0].project = 'Hingoli';
  assert.equal(validateSnapshot(tagged).vouchers[0].project, 'Hingoli');
});

test('archived validation accepts a complete collection above the single-request limit', () => {
  const data=payload(); data.vouchers=Array.from({length:50100},(_,i)=>({...data.vouchers[0],number:String(i)}));
  assert.throws(()=>validateSnapshot(data),/at most 50000/);
  assert.equal(validateSnapshot(data,5000000).vouchers.length,50100);
});

test('incremental plan inserts, updates, and removes only changed source keys', () => {
  assert.equal(ledgerKey({ name: ' Sales ' }), 'ledger:sales');
  assert.equal(voucherKey({ date: '2026-09-10', type: 'Sales', number: 'S1', amount: '123.4', party: 'A' }), 'voucher|2026-09-10|Sales|S1|123.40|A');
  const plan = planIncremental(
    [
      { sourceKey: 'ledger:sales', name: 'Sales', group: 'Sales Accounts', balance: '10.00' },
      { sourceKey: 'ledger:rent', name: 'Rent', group: 'Indirect Expenses', balance: '5.00' },
    ],
    [
      { sourceKey: 'ledger:sales', name: 'Sales', group: 'Sales Accounts', balance: '12.00' },
      { sourceKey: 'ledger:cash', name: 'Cash', group: 'Cash-in-Hand', balance: '1.00' },
    ],
    (prior, row) => prior.name === row.name && prior.group === row.group && Number(prior.balance) === Number(row.balance)
  );
  assert.deepEqual(plan.insert.map((row) => row.sourceKey), ['ledger:cash']);
  assert.deepEqual(plan.update.map((row) => row.sourceKey), ['ledger:sales']);
  assert.deepEqual(plan.remove, ['ledger:rent']);
  assert.equal(plan.unchanged, 0);
});
test('transactional snapshot, retry deduplication, stale rejection and rollback', {
  skip: process.env.DB_NAME !== 'enterprise_dashboard_test',
}, async () => {
  await db.migrate();
  const first = await ingestSnapshot(payload());
  assert.equal(first.duplicate, false);
  assert.equal((await ingestSnapshot(payload())).duplicate, true);
  assert.equal((await db.query('SELECT count(*) FROM "Vouchers"')).rows[0].count, '1');
  await assert.rejects(() => ingestSnapshot({ ...payload(), batchId: 'old', capturedAt: '2026-09-07T10:00:00Z' }), /older/);
  const conflict = payload(); conflict.ledgers[0].balance = '999.00';
  await assert.rejects(() => ingestSnapshot(conflict), /batchId/);
  const broken = payload(); broken.batchId = 'test-2'; broken.capturedAt = '2026-09-09T11:00:00Z';
  broken.vouchers = [...broken.vouchers, { date: '2026-09-11', type: 'Sales', amount: '10.00', number: 'S2' }];
  // An injected database failure on a new voucher insert must roll the entire company back.
  await db.query(`CREATE FUNCTION fail_test_voucher() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'simulated write failure'; END $$`);
  await db.query(`CREATE TRIGGER fail_test BEFORE INSERT ON "Vouchers" FOR EACH ROW EXECUTE FUNCTION fail_test_voucher()`);
  try { await assert.rejects(() => ingestSnapshot(broken), /simulated write failure/); }
  finally { await db.query('DROP TRIGGER fail_test ON "Vouchers"'); await db.query('DROP FUNCTION fail_test_voucher()'); }
  assert.equal((await db.query('SELECT "Amount" FROM "Vouchers"')).rows[0].Amount, '123.45');
  assert.equal((await db.query('SELECT count(*) FROM tally_ingestions')).rows[0].count, '1');
  const precise=payload(); precise.batchId='precise-1'; precise.capturedAt='2026-09-10T12:00:00Z'; precise.ledgers[0].balance='9999999999999999.98';
  await ingestSnapshot(precise);
  precise.batchId='precise-2'; precise.capturedAt='2026-09-11T12:00:00Z'; precise.ledgers[0].balance='9999999999999999.99';
  assert.equal((await ingestSnapshot(precise)).ledgers.update,1);
  assert.equal((await db.query('SELECT "CurrentBalance" FROM "Ledgers"')).rows[0].CurrentBalance,'9999999999999999.99');
  await db.query('TRUNCATE tally_ingestions, "Vouchers", "Projects", "Ledgers", "Companies", "SyncLog" RESTART IDENTITY CASCADE');
});
after(async () => { await db.close(); });
