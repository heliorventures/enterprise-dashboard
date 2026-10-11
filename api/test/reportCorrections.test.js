const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const reports = require('../src/reports');
const books = require('../src/books');
const management = require('../src/managementReports');
after(() => db.close());

test('expense corrections net at company level and reconcile through groups and ledgers', () => {
  const [company] = reports.nestExpenses([
    { CompanyID: 1, CompanyName: 'A', LedgerID: 1, LedgerName: 'Rent', GroupCategory: 'Indirect Expenses', CurrentBalance: -100 },
    { CompanyID: 1, CompanyName: 'A', LedgerID: 2, LedgerName: 'Refund', GroupCategory: 'Direct Expenses', CurrentBalance: 30 },
  ]);
  assert.equal(company.total, 70);
  assert.equal(company.groups.reduce((sum, group) => sum + group.total, 0), 70);
  assert.equal(company.groups.flatMap(group => group.ledgers).find(row => row.name === 'Refund').balance, -30);
});

test('each books response reads count, items and filters inside one snapshot', async () => {
  const originalQuery = db.query, originalSnapshot = db.readSnapshot;
  let snapshot = false, reads = 0, snapshots = 0;
  db.readSnapshot = async work => { snapshots++; snapshot = true; try { return await work(); } finally { snapshot = false; } };
  db.query = async sql => {
    assert.equal(snapshot, true, 'books query escaped snapshot'); reads++;
    return { rows: /COUNT\(\*\)/.test(sql) ? [{ Total: 0 }] : [] };
  };
  try {
    assert.equal((await books.listLedgers()).total, 0);
    assert.equal((await books.listVouchers()).total, 0);
    assert.equal(snapshots, 2);
    assert.equal(reads, 6);
  } finally { db.query = originalQuery; db.readSnapshot = originalSnapshot; }
});

test('invalid book filters fail before acquiring a snapshot or database connection', async () => {
  const originalSnapshot = db.readSnapshot;
  db.readSnapshot = () => { throw new Error('Invalid filters reached database connection'); };
  try {
    await assert.rejects(async () => books.listLedgers({ page: '1.5' }), error => error.status === 400);
    await assert.rejects(async () => books.listVouchers({ from: '2026-02-30' }), error => error.status === 400);
    await assert.rejects(async () => books.listVouchers({ company: 'oops' }), error => error.status === 400);
  } finally { db.readSnapshot = originalSnapshot; }
});

test('large voucher report returns more than 100 rows and classifies custom names by root', async () => {
  const originalQuery = db.query, originalSnapshot = db.readSnapshot;
  db.readSnapshot = work => work();
  db.query = async sql => {
    if (/FROM "Companies" c LEFT JOIN finance_snapshots/.test(sql)) return { rows: [{ currency: 'USD', uniform_currency: 'true' }] };
    const rows = Array.from({ length: 125 }, (_, index) => ({ id: index + 1, company_id: 1, voucher_type: 'Vendor settlement', resolved_type: 'Payment', amount: 200000, turnover: 200000 }));
    return { rows: /LIMIT 100\b/.test(sql) ? rows.slice(0, 100) : rows };
  };
  try {
    const result = await management.large({ company: '1' });
    assert.equal(result.items.length, 125);
    assert.equal(result.items[0].flow, 'outflow');
    assert.equal(result.items[0].voucher_type, 'Vendor settlement');
    assert.equal(result.currency, 'USD');
  } finally { db.query = originalQuery; db.readSnapshot = originalSnapshot; }
});

test('aggregate monetary reports reject mixed and unknown currency before totals are read', async () => {
  const originalQuery = db.query, originalSnapshot = db.readSnapshot;
  db.readSnapshot = work => work();
  try {
    for (const currencies of [['INR', 'USD'], [null], ['ZZZ']]) {
      db.query = async sql => {
        if (/FROM "Companies" c LEFT JOIN finance_snapshots/.test(sql)) return { rows: currencies.map(currency => ({ currency, uniform_currency: 'true' })) };
        return { rows: [] };
      };
      await assert.rejects(management.daily({}), error => error.status === 422 && /currency/i.test(error.message));
    }
  } finally { db.query = originalQuery; db.readSnapshot = originalSnapshot; }
});

test('large voucher overflow is rejected instead of exposing an exportable partial result', async () => {
  const originalQuery = db.query, originalSnapshot = db.readSnapshot;
  db.readSnapshot = work => work();
  db.query = async sql => ({ rows: /FROM "Companies" c LEFT JOIN finance_snapshots/.test(sql)
    ? [{ currency: 'INR', uniform_currency: 'true' }] : Array.from({ length: 20001 }, (_, id) => ({ id })) });
  try {
    await assert.rejects(management.large({}), error => error.status === 422 && /20000/.test(error.message));
  } finally { db.query = originalQuery; db.readSnapshot = originalSnapshot; }
});

test('every management flow aggregation joins resolved voucher roots while keeping original type filters', async () => {
  const originalQuery = db.query, originalSnapshot = db.readSnapshot;
  db.readSnapshot = work => work();
  let flowQueries = 0;
  db.query = async (sql, values) => {
    if (/FROM "Companies" c LEFT JOIN finance_snapshots/.test(sql)) return { rows: [{ currency: 'INR', uniform_currency: 'true' }] };
    if (/CASE WHEN/.test(sql)) {
      assert.match(sql, /LEFT JOIN voucher_types vt/);
      assert.match(sql, /CASE WHEN COALESCE\(vt.resolved_root,v\."VoucherType"\)/);
      assert.match(sql, /v\."VoucherType" = \$2/);
      assert.equal(values[1], 'Custom type');
      flowQueries++;
    }
    return { rows: [{ vouchers: 1, with_amount: 1, turnover: 100, inflow: 0, outflow: 100, voucher_type: 'Custom type', resolved_type: 'Payment' }] };
  };
  try {
    for (const kind of ['summary', 'daily', 'weekly', 'monthly', 'types', 'parties', 'companies']) {
      const result = await management.run(kind, { type: 'Custom type' });
      assert.equal(result.currency, 'INR');
      if (kind === 'types') assert.equal(result.items[0].flow, 'outflow');
    }
    assert.equal(flowQueries, 7);
  } finally { db.query = originalQuery; db.readSnapshot = originalSnapshot; }
});
