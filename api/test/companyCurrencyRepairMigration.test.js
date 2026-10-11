const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../src/db');
const config = require('../src/config');
const { reportingCurrency } = require('../src/reportCurrency');
after(() => db.close());
const disposable = config.db.host === '127.0.0.1' && config.db.port === 58419
  && config.db.database === 'enterprise_dashboard_test' && config.db.user === 'dashboard_test';

test('025 repairs damaged source currency after 024 and protects subsequent imports', { skip: !disposable }, async () => {
  const rollback = new Error('rollback currency repair fixture');
  await assert.rejects(db.transaction(async client => {
    await client.query('CREATE SCHEMA currency_repair_fixture');
    await client.query('SET LOCAL search_path TO currency_repair_fixture, public');
    const directory = path.join(__dirname, '../migrations');
    const files = (await fs.readdir(directory)).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
    for (const name of files.filter(name => name < '025')) await client.query(await fs.readFile(path.join(directory, name), 'utf8'));
    await client.query(`INSERT INTO "Companies"("CompanyName") SELECT 'Currency repair '||id FROM generate_series(1,7) id`);
    await client.query(`INSERT INTO tally_source_snapshots(batch_id,company_external_id,company_name,captured_at,schema_version,coverage_status,manifest)
      SELECT 'repair-'||"CompanyID",'repair-'||"CompanyID","CompanyName",'2026-10-01',1,'complete','{}' FROM "Companies" WHERE "CompanyID"<7`);
    await client.query(`INSERT INTO finance_ledger_facts(company_id,name,group_name,closing_balance,currency,batch_id,ordinal)
      SELECT "CompanyID",'Cash','Cash-in-Hand',123.45,CASE WHEN "CompanyID"=5 THEN 'USD' ELSE '?' END,
      'repair-'||"CompanyID",0 FROM "Companies" WHERE "CompanyID"<7`);
    await client.query(`INSERT INTO finance_snapshots(company_id,batch_id,currency,captured_at,coverage)
      SELECT "CompanyID",'repair-'||"CompanyID",CASE "CompanyID" WHEN 1 THEN '?' WHEN 2 THEN 'I?' WHEN 4 THEN 'USD' WHEN 6 THEN 'unsupported' ELSE 'INR' END,
      '2026-10-01','{"history":{"complete":true},"postingsComplete":true}' FROM "Companies" WHERE "CompanyID"<7`);
    await client.query(`UPDATE "Companies" SET "Currency"='?' WHERE "CompanyID"=7`);
    const before = (await client.query('SELECT company_id,batch_id,captured_at,applied_at FROM finance_snapshots ORDER BY company_id')).rows;
    const facts = (await client.query('SELECT * FROM finance_ledger_facts ORDER BY company_id')).rows;
    const originalQuery = db.query;
    db.query = (sql, values) => client.query(sql, values);
    try {
      await assert.rejects(reportingCurrency('1'), error => error.status === 422);
      await client.query(await fs.readFile(path.join(directory, '025_repair_damaged_currency.sql'), 'utf8'));
      for (const id of ['1','2','3','7']) assert.equal(await reportingCurrency(id), 'INR');
      assert.equal(await reportingCurrency('4'), 'USD', 'damaged ledger label inherits the explicit company currency');
      for (const id of ['5','6','all']) await assert.rejects(reportingCurrency(id), error => error.status === 422);
      assert.deepEqual((await client.query('SELECT company_id,batch_id,captured_at,applied_at FROM finance_snapshots ORDER BY company_id')).rows, before);
      assert.deepEqual((await client.query('SELECT * FROM finance_ledger_facts ORDER BY company_id')).rows, facts);
      for (const row of (await client.query('SELECT coverage FROM finance_snapshots')).rows) assert.deepEqual(row.coverage.history, { complete: true });
      for (const label of ['?', 'I?', '\uFFFD']) {
        await client.query('UPDATE finance_snapshots SET currency=$1 WHERE company_id IN (1,4)', [label]);
        assert.equal(await reportingCurrency('1'), 'INR');
        assert.equal(await reportingCurrency('4'), 'USD');
      }
      await client.query('UPDATE "Companies" SET "IsActive"=false WHERE "CompanyID" IN (4,5,6)');
      assert.equal(await reportingCurrency('all'), 'INR');
      // This repair can be safely retried without changing source or financial history.
      await client.query(await fs.readFile(path.join(directory, '025_repair_damaged_currency.sql'), 'utf8'));
      assert.equal(await reportingCurrency('all'), 'INR');
    } finally { db.query = originalQuery; }
    throw rollback;
  }), error => error === rollback);
});
