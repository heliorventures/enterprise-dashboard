const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const enabled = process.env.DB_HOST === '127.0.0.1' && process.env.DB_PORT === '58419' && process.env.DB_NAME === 'enterprise_dashboard_test' && process.env.DB_USER === 'dashboard_test';

async function workbook(name, currencyCell) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Outstanding');
  sheet.getRow(1).values = ['Outstanding Report'];
  sheet.getRow(2).values = ['From: 01/01/2026 To: 30/09/2026'];
  sheet.getRow(3).values = currencyCell ? [name, currencyCell] : [name];
  sheet.getRow(4).values = ['Particulars', 'Pending Bill', 'Pending Bill'];
  sheet.getRow(5).values = [null, 'Dr Amt', 'Cr Amt'];
  [['Same Party', '100.00'], ['Different Party', '70.00'], ['Only In Excel', '10.00']].forEach((row, index) => { sheet.getRow(index + 6).values = row; });
  return book.xlsx.writeBuffer();
}

test('a workbook without a currency uses the company currency and undated Tally balances compare', { skip: !enabled }, async t => {
  const db = require('../src/db');
  const config = require('../src/intelligence/config');
  const imports = require('../src/intelligence/imports/service');
  const projects = require('../src/intelligence/projects/service');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'intel-currency-'));
  const source = (await db.query("SELECT id FROM intel_source_systems WHERE type='EXCEL' LIMIT 1")).rows[0].id;
  const name = `Currency Test ${randomUUID()}`;
  const tallyId = (await db.query('INSERT INTO "Companies"("CompanyName","Currency") VALUES($1,\'INR\') RETURNING "CompanyID" AS id', [name])).rows[0].id;
  const company = (await db.query('INSERT INTO intel_companies(name,tally_company_id) VALUES($1,$2) RETURNING id', [name, tallyId])).rows[0].id;
  await db.query('INSERT INTO "Ledgers"("CompanyID","LedgerName","GroupCategory","CurrentBalance") VALUES($1,\'Same Party\',\'Creditors\',\'100.00\'),($1,\'Different Party\',\'Creditors\',\'50.00\'),($1,\'Only In Tally\',\'Creditors\',\'5.00\')', [tallyId]);
  await db.query('UPDATE "Ledgers" SET "SourceKey"=\'ledger:\'||lower("LedgerName") WHERE "CompanyID"=$1', [tallyId]);
  await db.query('INSERT INTO intel_rules(company_id,key,value) VALUES($1,\'amount_tolerance\',\'{"amount":0}\')', [company]);
  const fileIds = [];
  const addFile = async currencyCell => {
    const stored = path.join(temp, `${randomUUID()}.xlsx`);
    await fs.writeFile(stored, await workbook(name, currencyCell));
    const id = (await db.query('INSERT INTO intel_import_files(company_id,source_system_id,file_name,stored_path,file_hash,file_size,status,reporting_period_to,analysis) VALUES($1,$2,\'test.xlsx\',$3,$4,1,\'ANALYZED\',\'2026-09-30\',\'{}\') RETURNING id', [company, source, stored, randomUUID()])).rows[0].id;
    fileIds.push(id);
    return id;
  };
  const statuses = async () => Object.fromEntries((await db.query(
    `SELECT a.account_name,r.status,r.difference FROM intel_current_reconciliations r JOIN intel_outstanding o ON o.id=r.outstanding_id JOIN intel_accounts a ON a.id=o.account_id WHERE r.company_id=$1`, [company])).rows
    .map(row => [row.account_name, `${row.status}${row.difference == null ? '' : ':' + row.difference}`]));

  try {
    await t.test('no stated currency and no Tally snapshot: INR is used and amounts are compared', async () => {
      const id = await addFile(null);
      await imports.processFile(id, { username: 'test' });
      assert.deepEqual(await statuses(), { 'Same Party': 'MATCHED:0.00', 'Different Party': 'AMOUNT_MISMATCH:20.00', 'Only In Excel': 'MISSING_IN_TALLY:10.00' });
      const summary = await projects.summary(company);
      assert.equal(summary.currency, 'INR');
      assert.equal(summary.currencyMessage, null);
      assert.equal(summary.notes.length, 2, 'the assumed currency and the undated Tally balances are both disclosed');
      assert.match(summary.notes[0], /INR/);
      assert.match(summary.notes[1], /no date/);
    });

    await t.test('the undated-balance assumption can be switched off', async () => {
      const original = config.assumeUndatedTallyBalances;
      config.assumeUndatedTallyBalances = false;
      try {
        await imports.processFile(fileIds[0], { username: 'test', reprocess: true });
        const values = Object.values(await statuses());
        assert.ok(values.every(value => value === 'COMPARISON_UNAVAILABLE'), 'nothing is compared without a confirmed date');
        assert.equal((await projects.summary(company)).unassigned.health, 'COMPARISON_UNAVAILABLE');
      } finally { config.assumeUndatedTallyBalances = original; }
      await imports.processFile(fileIds[0], { username: 'test', reprocess: true });
      assert.equal((await statuses())['Same Party'], 'MATCHED:0.00');
    });

    await t.test('a currency the workbook states wins and is never converted', async () => {
      const id = await addFile('Currency: USD');
      await imports.processFile(id, { username: 'test' });
      assert.ok(Object.values(await statuses()).every(value => value === 'COMPARISON_UNAVAILABLE'), 'USD against an INR company is not compared');
      assert.equal((await projects.summary(company)).currency, null);
    });
  } finally {
    await db.query('DELETE FROM intel_project_snapshots WHERE company_id=$1', [company]);
    await db.query('DELETE FROM intel_company_publications WHERE company_id=$1', [company]);
    await db.query('DELETE FROM intel_exceptions WHERE company_id=$1', [company]);
    await db.query('DELETE FROM intel_reconciliations WHERE company_id=$1', [company]);
    await db.query('DELETE FROM intel_outstanding WHERE company_id=$1', [company]);
    await db.query('DELETE FROM intel_import_files WHERE company_id=$1', [company]);
    await db.query('DELETE FROM intel_accounts WHERE company_id=$1', [company]);
    await db.query('DELETE FROM intel_companies WHERE id=$1', [company]);
    await db.query('DELETE FROM "Ledgers" WHERE "CompanyID"=$1', [tallyId]);
    await db.query('DELETE FROM "Companies" WHERE "CompanyID"=$1', [tallyId]);
    await fs.rm(temp, { recursive: true });
    await db.close();
  }
});
