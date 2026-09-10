const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');

// Only run against a disposable test database, never the configured development/VPS DB.
const enabled = process.env.DB_NAME === 'enterprise_dashboard_test';
after(async () => { if (db.close) await db.close(); });

test('PostgreSQL database exposes explicit migration and shutdown operations', () => {
  assert.equal(typeof db.migrate, 'function');
  assert.equal(typeof db.close, 'function');
});

test('schema is repeatable, empty by default, and queries preserve API types', { skip: !enabled }, async () => {
  await db.migrate();
  await db.migrate();
  const dashboard = require('../src/dashboardService');
  const books = require('../src/books');
  assert.deepEqual(await dashboard.getCompanies(), []);
  await db.query(`INSERT INTO "Companies" ("CompanyName") VALUES ($1)`, ["O'Brien Test"]);
  const company = (await dashboard.getCompanies())[0];
  await db.query(`INSERT INTO "Ledgers" ("CompanyID", "LedgerName", "GroupCategory", "CurrentBalance")
    VALUES ($1, 'Sales', 'Sales Accounts', 123.45), ($1, 'Rent', 'Indirect Expenses', 23.45)`, [company.CompanyID]);
  await db.query(`INSERT INTO "Vouchers" ("CompanyID", "VoucherDate", "VoucherType", "Amount")
    VALUES ($1, '2026-09-10', 'Sales', 123.45)`, [company.CompanyID]);
  const ledgers = await books.listLedgers({ q: 'sales', pageSize: 1 });
  assert.equal(ledgers.total, 1);
  assert.equal(ledgers.items[0].balance, 123.45);
  assert.equal((await books.listLedgers({ q: "' OR 1=1 --" })).total, 0);
  const vouchers = await books.listVouchers({ from: '2026-09-10', to: '2026-09-10' });
  assert.equal(vouchers.items[0].date, '2026-09-10');
  assert.equal((await books.listVouchers({ from: '2026-09-11' })).total, 0);
  const snapshot = await dashboard.getDashboard();
  assert.equal(snapshot.kpis.profit, 100);
  await db.query('TRUNCATE tally_ingestions, "Vouchers", "Projects", "Ledgers", "Companies", "SyncLog" RESTART IDENTITY CASCADE');
});
