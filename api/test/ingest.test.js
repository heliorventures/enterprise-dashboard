const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { validateSnapshot, ingestSnapshot } = require('../src/ingest');
const db = require('../src/db');
const payload = () => ({
  batchId: 'test-1', capturedAt: '2026-09-08T10:00:00Z', fullSnapshot: true,
  company: { externalId: 'tally-guid-1', name: 'Test Company' },
  ledgers: [{ name: 'Sales', group: 'Sales Accounts', balance: '123.45' }],
  vouchers: [{ date: '2026-09-10', type: 'Sales', amount: '123.45', number: 'S1' }],
});
test('reject incomplete snapshots, invalid dates and imprecise amounts', () => {
  assert.throws(() => validateSnapshot({ ...payload(), vouchers: undefined }), /vouchers/);
  assert.throws(() => validateSnapshot({ ...payload(), fullSnapshot: false }), /fullSnapshot/);
  assert.throws(() => validateSnapshot({ ...payload(), capturedAt: '2026-02-30T10:00:00Z' }), /calendar date/);
  const invalid = payload(); invalid.vouchers[0].date = '2026-02-30';
  assert.throws(() => validateSnapshot(invalid), /date/);
  invalid.vouchers[0].date = '2026-09-10'; invalid.vouchers[0].amount = '1.123';
  assert.throws(() => validateSnapshot(invalid), /amount/);
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
  // An injected database failure after deletion must roll the entire company back.
  await db.query(`CREATE FUNCTION fail_test_voucher() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'simulated write failure'; END $$`);
  await db.query(`CREATE TRIGGER fail_test BEFORE INSERT ON "Vouchers" FOR EACH ROW EXECUTE FUNCTION fail_test_voucher()`);
  try { await assert.rejects(() => ingestSnapshot(broken), /simulated write failure/); }
  finally { await db.query('DROP TRIGGER fail_test ON "Vouchers"'); await db.query('DROP FUNCTION fail_test_voucher()'); }
  assert.equal((await db.query('SELECT "Amount" FROM "Vouchers"')).rows[0].Amount, '123.45');
  assert.equal((await db.query('SELECT count(*) FROM tally_ingestions')).rows[0].count, '1');
  await db.query('TRUNCATE tally_ingestions, "Vouchers", "Projects", "Ledgers", "Companies", "SyncLog" RESTART IDENTITY CASCADE');
});
after(async () => { await db.close(); });
