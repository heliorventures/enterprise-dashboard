const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const db = require('../src/db');
const { companyFinancials } = require('../src/dashboardService');
after(() => db.close());

// Opt in against any reachable PostgreSQL database. CTE fixtures shadow every
// referenced table and the connection enforces read-only mode: no schema/data writes.
test('financial SQL distinguishes publication status and resolves expense hierarchy', {
  skip: process.env.READONLY_DB_TEST !== '1',
}, async () => {
  const client = new Client({ ...require('../src/config').db, connectionTimeoutMillis: 8000,
    statement_timeout: 10000, options: '-c default_transaction_read_only=on' });
  const original = db.query;
  const fixture = `WITH
    "Companies"("CompanyID","CompanyName","IsActive") AS (VALUES
      (1,'Unvalidated archive',true),(2,'Published archive',true),(3,'Legacy direct import',true)),
    "Ledgers"("LedgerID","CompanyID","LedgerName","GroupCategory","CurrentBalance") AS (VALUES
      (1,1,'Provision','Provision for Expenses (G)',80947::numeric),
      (2,2,'Provision','Expense reserve',800::numeric),
      (3,2,'Rent','Premises',100::numeric),
      (4,3,'Fuel','Direct Expenses',200::numeric)),
    "Vouchers"("CompanyID") AS (VALUES (1)),
    finance_ledger_facts(company_id,name,root_group) AS (VALUES
      (2,'Provision','Current Liabilities'),(2,'Rent','Indirect Expenses')),
    finance_snapshots(company_id,coverage) AS (VALUES (2,'{}'::jsonb)),
    tally_ingestions(company_id,batch_id) AS (VALUES (1,'old'),(2,'published'),(3,'direct')),
    tally_source_snapshots(batch_id) AS (VALUES ('old'),('published')) `;
  try {
    await client.connect();
    assert.equal((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only, 'on');
    db.query = (sql, values) => client.query(fixture + sql, values);
    const rows = await companyFinancials(0);
    const byId = new Map(rows.map(row => [row.CompanyID, row]));
    assert.equal(byId.get(1).FinancialDataAvailable, false);
    assert.equal(Number(byId.get(1).Expenses), 0);
    assert.equal(byId.get(2).FinancialDataAvailable, true);
    assert.equal(Number(byId.get(2).Expenses), 100);
    assert.equal(byId.get(3).FinancialDataAvailable, false);
    assert.equal(Number(byId.get(3).Expenses), 200);
    assert.deepEqual((await companyFinancials(2)).map(row => row.CompanyID), [2]);
  } finally {
    db.query = original;
    await client.end();
  }
});
