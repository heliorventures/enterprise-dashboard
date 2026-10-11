const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../src/db');
const config = require('../src/config');
const { reportingCurrency } = require('../src/reportCurrency');
const books = require('../src/books');
const dashboard = require('../src/dashboardService');
after(() => db.close());
const disposable = config.db.host === '127.0.0.1' && config.db.port === 58419
  && config.db.database === 'enterprise_dashboard_test' && config.db.user === 'dashboard_test';

test('024 backfills company currency and preserves defaults, foreign evidence and financial history', {
  skip: !disposable,
}, async () => {
  const rollback = new Error('rollback currency fixture');
  await assert.rejects(db.transaction(async client => {
    await client.query('CREATE SCHEMA company_currency_fixture');
    await client.query('SET LOCAL search_path TO company_currency_fixture, public');
    const directory = path.join(__dirname, '../migrations');
    const files = (await fs.readdir(directory)).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
    for (const name of files.filter(name => name < '024')) await client.query(await fs.readFile(path.join(directory, name), 'utf8'));
    await client.query(`INSERT INTO "Companies"("CompanyName") VALUES ('Legacy'), ('Missing'), ('Rupees'), ('Foreign'), ('Mixed'), ('Unsupported')`);
    await client.query(`INSERT INTO tally_source_snapshots(batch_id,company_external_id,company_name,captured_at,schema_version,coverage_status,manifest)
      SELECT 'currency-'||"CompanyID",'currency-'||"CompanyID","CompanyName",'2026-10-01',1,'complete','{}' FROM "Companies" WHERE "CompanyID">1`);
    await client.query(`INSERT INTO finance_snapshots(company_id,batch_id,currency,captured_at,coverage)
      SELECT "CompanyID",'currency-'||"CompanyID",CASE "CompanyID" WHEN 3 THEN 'Rs.' WHEN 4 THEN 'USD' WHEN 5 THEN 'INR' WHEN 6 THEN 'unsupported' END,
      '2026-10-01','{"uniformCurrency":false,"history":{"complete":true},"postingsComplete":true}' FROM "Companies" WHERE "CompanyID">1`);
    await client.query(`INSERT INTO finance_ledger_facts(company_id,name,group_name,closing_balance,currency,batch_id,ordinal)
      SELECT "CompanyID",'Cash','Cash-in-Hand',123.45,CASE "CompanyID" WHEN 3 THEN '₹' WHEN 4 THEN 'usd' WHEN 5 THEN 'USD' END,
      'currency-'||"CompanyID",0 FROM "Companies" WHERE "CompanyID">1`);
    await client.query(`INSERT INTO "Ledgers"("CompanyID","LedgerName","GroupCategory","CurrentBalance") VALUES (1,'Legacy cash','Cash',123.45)`);
    await client.query(`INSERT INTO "Vouchers"("CompanyID","VoucherDate","VoucherType","Amount") VALUES (1,'2026-10-01','Receipt',123.45)`);
    const before = (await client.query('SELECT company_id,batch_id,captured_at,applied_at FROM finance_snapshots ORDER BY company_id')).rows;
    const facts = (await client.query('SELECT * FROM finance_ledger_facts ORDER BY company_id')).rows;
    await client.query(await fs.readFile(path.join(directory, '024_company_currency.sql'), 'utf8'));
    for (const label of ['₹', 'Rs', 'Rs.', 'Rupee', 'Rupees', 'Indian Rupee', ' Indian   Rupees ', '\nRs.\t']) {
      assert.equal((await client.query('SELECT normalize_finance_currency($1) AS currency', [label])).rows[0].currency, 'INR', label);
    }
    assert.deepEqual((await client.query('SELECT "Currency" FROM "Companies" ORDER BY "CompanyID"')).rows.map(row => row.Currency),
      ['INR', 'INR', 'INR', 'USD', 'INR', 'UNSUPPORTED']);
    assert.deepEqual((await client.query('SELECT company_id,batch_id,captured_at,applied_at FROM finance_snapshots ORDER BY company_id')).rows, before);
    assert.deepEqual((await client.query('SELECT * FROM finance_ledger_facts ORDER BY company_id')).rows, facts);
    const snapshots = (await client.query('SELECT currency,coverage FROM finance_snapshots ORDER BY company_id')).rows;
    assert.deepEqual(snapshots.map(row => row.coverage.uniformCurrency), [true, true, true, false, true]);
    for (const row of snapshots) assert.deepEqual(row.coverage.history, { complete: true });
    assert.equal((await client.query('SELECT count(*)::int count FROM finance_snapshots')).rows[0].count, 5, 'no invented validated snapshot');
    await client.query(`INSERT INTO "Companies"("CompanyName") VALUES ('New company')`);
    assert.equal((await client.query('SELECT "Currency" FROM "Companies" WHERE "CompanyID"=7')).rows[0].Currency, 'INR');
    // Older compatible publishers explicitly send null rather than omitting currency.
    await client.query(`UPDATE finance_snapshots SET currency=NULL,coverage='{"uniformCurrency":false,"history":{"complete":false}}' WHERE company_id IN (2,4,5)`);
    assert.deepEqual((await client.query('SELECT currency,coverage FROM finance_snapshots WHERE company_id IN (2,4,5) ORDER BY company_id')).rows,
      ['INR','USD','INR'].map((currency, i) => ({ currency, coverage: { uniformCurrency: i !== 2, history: { complete: false } } })));
    await client.query(`UPDATE "Companies" SET "Currency"='  Rupees  ' WHERE "CompanyID"=7`);
    assert.equal((await client.query('SELECT "Currency" FROM "Companies" WHERE "CompanyID"=7')).rows[0].Currency, 'INR');

    const originalQuery = db.query, originalSnapshot = db.readSnapshot;
    let tail = Promise.resolve();
    db.query = (sql, values) => {
      const result = tail.then(() => client.query(sql, values));
      tail = result.catch(() => {});
      return result;
    };
    db.readSnapshot = work => work();
    try {
      for (const id of [1,2,3,7]) assert.equal(await reportingCurrency(String(id)), 'INR');
      assert.equal(await reportingCurrency('4'), 'USD');
      for (const id of ['all','5','6']) await assert.rejects(reportingCurrency(id), error => error.status === 422);
      assert.equal((await books.listLedgers({ company: '1' })).items[0].currency, 'INR');
      assert.equal((await books.listVouchers({ company: '1' })).items[0].currency, 'INR');
      await client.query('UPDATE "Companies" SET "IsActive"=false WHERE "CompanyID" IN (4,5,6)');
      assert.equal(await reportingCurrency('all'), 'INR');
      assert.equal((await dashboard.getDashboard('all')).currency, 'INR');
    } finally { db.query = originalQuery; db.readSnapshot = originalSnapshot; }
    await client.query(`INSERT INTO tally_source_snapshots(batch_id,company_external_id,company_name,captured_at,schema_version,coverage_status,manifest)
      VALUES ('new-currency','new-currency','New company','2026-10-02',1,'complete','{}')`);
    await client.query(`INSERT INTO finance_snapshots(company_id,batch_id,currency,captured_at) VALUES (7,'new-currency',NULL,'2026-10-02')`);
    assert.equal((await client.query('SELECT currency FROM finance_snapshots WHERE company_id=7')).rows[0].currency, 'INR');
    await client.query(`UPDATE finance_snapshots SET currency='EUR' WHERE company_id=7`);
    assert.equal((await client.query('SELECT "Currency" FROM "Companies" WHERE "CompanyID"=7')).rows[0].Currency, 'EUR');
    await client.query(`UPDATE finance_snapshots SET currency=NULL WHERE company_id=7`);
    assert.equal((await client.query('SELECT currency FROM finance_snapshots WHERE company_id=7')).rows[0].currency, 'EUR');
    throw rollback;
  }), error => error === rollback);
});
