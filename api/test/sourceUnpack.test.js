const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../src/sourceUnpack');
const sourceArchive = require('../src/sourceArchive');
const db = require('../src/db');

after(() => db.close());

const ledger = (name, parent, closing, opening) => ({
  tag: 'LEDGER',
  attributes: { NAME: name },
  content: [
    { tag: 'PARENT', attributes: {}, content: [parent] },
    ...(closing === undefined ? [] : [{ tag: 'CLOSINGBALANCE', attributes: { TYPE: 'Amount' }, content: closing === null ? [] : [closing] }]),
    ...(opening === undefined ? [] : [{ tag: 'OPENINGBALANCE', attributes: {}, content: [opening] }]),
  ],
});

const voucher = (overrides = {}) => ({
  tag: 'VOUCHER',
  attributes: { VCHTYPE: 'Sales' },
  content: [
    { tag: 'DATE', attributes: {}, content: [overrides.date || '20260401'] },
    { tag: 'VOUCHERTYPENAME', attributes: {}, content: [overrides.type || 'Sales'] },
    { tag: 'VOUCHERNUMBER', attributes: {}, content: [overrides.number || 'S1'] },
    { tag: 'PARTYLEDGERNAME', attributes: {}, content: [overrides.party || 'Customer'] },
    { tag: 'NARRATION', attributes: {}, content: [overrides.narration || 'Invoice'] },
    { tag: 'ISCANCELLED', attributes: {}, content: [overrides.cancelled || 'No'] },
    { tag: 'ISOPTIONAL', attributes: {}, content: [overrides.optional || 'No'] },
    ...(overrides.amount === undefined ? [] : [{ tag: 'AMOUNT', attributes: {}, content: [overrides.amount] }]),
    ...(overrides.costCentre ? [{ tag: 'COSTCENTRENAME', attributes: {}, content: [overrides.costCentre] }] : []),
    ...(overrides.costCentres || []).map((name) => ({ tag: 'COSTCENTRENAME', attributes: {}, content: [name] })),
    ...(overrides.entries || []).map((entry) => ({
      tag: 'ALLLEDGERENTRIES.LIST',
      attributes: {},
      content: [
        { tag: 'LEDGERNAME', attributes: {}, content: [entry.name] },
        { tag: 'AMOUNT', attributes: {}, content: [entry.amount] },
      ],
    })),
  ],
});

test('source JSON trees project to dashboard ledger and voucher rows', () => {
  assert.deepEqual(api.interpretLedger(ledger('Sales', 'Sales Accounts', '1,234.50')), {
    name: 'Sales', group: 'Sales Accounts', balance: '1234.50',
  });
  assert.deepEqual(api.interpretLedger(ledger('Cash', 'Cash-in-Hand', '')), {
    name: 'Cash', group: 'Cash-in-Hand', balance: '0.00',
  });
  assert.deepEqual(api.interpretLedger(ledger('Bank', 'Bank Accounts', undefined, '-9500000.00')), {
    name: 'Bank', group: 'Bank Accounts', balance: '-9500000.00',
  });
  assert.equal(api.interpretVoucher(voucher({ cancelled: 'Yes' })), null);
  assert.deepEqual(api.interpretVoucher(voucher({ amount: '250.00' })), {
    date: '2026-04-01', type: 'Sales', amount: '250.00', narration: 'Invoice', number: 'S1', party: 'Customer',
  });
  assert.equal(api.interpretVoucher(voucher({ amount: '1,23,456.00' })).amount, '123456.00');
  assert.equal(api.interpretVoucher(voucher({ amount: '5,000.00 Cr' })).amount, '-5000.00');
  assert.equal(api.interpretVoucher(voucher({
    amount: undefined,
    entries: [{ name: 'Sales', amount: '100.00' }, { name: 'Debtors', amount: '-100.00' }],
  })).amount, '100.00');
  assert.equal(api.interpretVoucher(voucher({ amount: undefined })).amount, '0.00');
  assert.equal(api.interpretCostCentre({ tag: 'COSTCENTRE', attributes: { NAME: 'Hingoli' }, content: [] }).name, 'Hingoli');
  assert.equal(api.interpretVoucher(voucher({ amount: '250.00', costCentre: 'Majalgaon-Beed' })).project, 'Majalgaon-Beed');
  assert.equal(api.interpretVoucher(voucher({ amount: '250.00', costCentres: ['Office', 'Hingoli'] })).project, undefined);
  assert.throws(() => api.interpretVoucher(voucher({ date: 'not-a-date', amount: '1.00' })), /date/);
  const projected = api.projectRecords([
    { collection: 'LEDGER', ordinal: 0, payload: ledger('Sales', 'Sales Accounts', '10.00') },
    { collection: 'LEDGER', ordinal: 1, payload: ledger('Sales', 'Sales Accounts', '11.00') },
    { collection: 'VOUCHER', ordinal: 0, payload: voucher({ cancelled: 'Yes', amount: '10.00' }) },
    { collection: 'VOUCHER', ordinal: 1, payload: treeInvalid() },
    { collection: 'COSTCENTRE', ordinal: 0, payload: { tag: 'COSTCENTRE', attributes: { NAME: 'Hingoli' }, content: [] } },
    { collection: 'VOUCHER', ordinal: 2, payload: voucher({ amount: '80.00', costCentre: 'Hingoli' }) },
  ]);
  assert.equal(projected.ledgers.length, 1);
  assert.equal(projected.projects.length, 1);
  assert.equal(projected.projects[0].name, 'Hingoli');
  assert.equal(projected.vouchers.length, 1);
  assert.equal(projected.vouchers[0].project, 'Hingoli');
  assert.equal(projected.skipped.ledgers, 1);
  assert.equal(projected.skipped.cancelled, 1);
  assert.equal(projected.skipped.vouchers, 1);
});

function treeInvalid() {
  return voucher({ date: 'not-a-date', amount: 'USD 1.00' });
}

test('unpack writes latest complete source records into dashboard tables', {
  skip: process.env.DB_NAME !== 'enterprise_dashboard_test',
}, async () => {
  await db.migrate();
  await db.query('TRUNCATE tally_source_uploads, tally_source_snapshots, tally_ingestions, "Vouchers", "Projects", "Ledgers", "Companies", "SyncLog" RESTART IDENTITY CASCADE');
  const collections = sourceArchive.COLLECTIONS.map((name) => ({
    name, status: 'success', count: name === 'COMPANY' || name === 'LEDGER' || name === 'VOUCHER' || name === 'COSTCENTRE' ? 1 : 0,
  }));
  const manifest = {
    batchId: 'unpack-1', capturedAt: '2026-09-12T00:00:00Z',
    company: { externalId: 'unpack-guid', name: 'Unpack Company' },
    schemaVersion: 1, profile: 'company-business-v1', recordCount: 4, chunkCount: 1,
    consistency: 'unavailable', collections,
  };
  const company = {
    collection: 'COMPANY', ordinal: 0, sourceId: 'unpack-guid',
    payload: { tag: 'COMPANY', attributes: { NAME: 'Unpack Company' }, content: [{ tag: 'GUID', attributes: {}, content: ['unpack-guid'] }] },
  };
  await sourceArchive.begin(manifest);
  await sourceArchive.chunk({
    batchId: manifest.batchId, index: 0,
    records: [
      company,
      { collection: 'LEDGER', ordinal: 0, sourceId: null, payload: ledger('Sales', 'Sales Accounts', '123.45') },
      { collection: 'COSTCENTRE', ordinal: 0, sourceId: null, payload: { tag: 'COSTCENTRE', attributes: { NAME: 'Hingoli' }, content: [] } },
      { collection: 'VOUCHER', ordinal: 0, sourceId: 'v1', payload: voucher({ amount: '123.45', costCentre: 'Hingoli' }) },
    ],
  });
  await sourceArchive.complete({ batchId: manifest.batchId });
  const first = await api.unpackBatch(manifest.batchId);
  assert.equal(first.duplicate, false);
  assert.equal(first.ledgerCount, 1);
  assert.equal(first.voucherCount, 1);
  assert.equal(first.ledgers.insert, 1);
  assert.equal(first.vouchers.insert, 1);
  assert.equal(first.projects.linked, 1);
  const linked = await db.query('SELECT p."ProjectName", v."ProjectID" FROM "Vouchers" v JOIN "Projects" p ON p."ProjectID" = v."ProjectID"');
  assert.equal(linked.rows[0].ProjectName, 'Hingoli');
  await db.query('UPDATE "Vouchers" SET "ProjectID" = NULL');
  const again = await api.unpackBatch(manifest.batchId);
  assert.equal(again.duplicate, true);
  assert.equal(again.projects.linked, 1);
  assert.equal((await db.query('SELECT "LedgerName", "CurrentBalance" FROM "Ledgers"')).rows[0].LedgerName, 'Sales');
  assert.equal((await db.query('SELECT "Amount" FROM "Vouchers"')).rows[0].Amount, '123.45');
  assert.equal((await db.query('SELECT p."ProjectName" FROM "Vouchers" v JOIN "Projects" p ON p."ProjectID" = v."ProjectID"')).rows[0].ProjectName, 'Hingoli');
  await db.query('TRUNCATE tally_source_uploads, tally_source_snapshots, tally_ingestions, "Vouchers", "Projects", "Ledgers", "Companies", "SyncLog" RESTART IDENTITY CASCADE');
});
