const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const enabled = process.env.DB_HOST === '127.0.0.1' && process.env.DB_PORT === '58419'
  && process.env.DB_NAME === 'enterprise_dashboard_test' && process.env.DB_USER === 'dashboard_test';

test('balance-date repair republishes frozen data atomically and preserves the original generation', { skip: !enabled }, async t => {
  const db = require('../src/db');
  const imports = require('../src/intelligence/imports/service');
  const tally = require('../src/intelligence/tally/provider');
  const config = require('../src/intelligence/config');
  const repair = require('../src/intelligence/imports/repairBalanceDates');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'balance-date-repair-'));
  const source = (await db.query("SELECT id FROM intel_source_systems WHERE type='EXCEL' LIMIT 1")).rows[0].id;
  const name = `Balance Date ${randomUUID()}`;
  const tallyId = (await db.query('INSERT INTO "Companies"("CompanyName","Currency") VALUES($1,\'INR\') RETURNING "CompanyID" AS id', [name])).rows[0].id;
  const company = (await db.query('INSERT INTO intel_companies(name,tally_company_id) VALUES($1,$2) RETURNING id', [name, tallyId])).rows[0].id;
  const sourceBatch = randomUUID();
  const stored = path.join(temp, 'report.xlsx');
  const originalPolicy = config.assumeUndatedTallyBalances;
  config.assumeUndatedTallyBalances = true;
  try {
    await db.query('INSERT INTO "Ledgers"("CompanyID","LedgerName","GroupCategory","CurrentBalance") VALUES($1,\'Alpha\',\'Creditors\',\'100.00\')', [tallyId]);
    await db.query('INSERT INTO tally_source_snapshots(batch_id,company_external_id,company_name,captured_at,schema_version,coverage_status,manifest) VALUES($1,$2,$3,now(),1,\'complete\',$4)',
      [sourceBatch, String(tallyId), name, { dateContext: { ledgers: { from: '1901-01-01', to: '9999-12-31' } } }]);
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Outstanding');
    sheet.addRow(['Outstanding Report']);
    sheet.addRow(['From: 01/04/2026 To: 31/03/2027']);
    sheet.addRow([name, 'Currency: INR']);
    sheet.addRow(['Particulars', 'Pending Bill', 'Pending Bill']);
    sheet.addRow([null, 'Dr Amt', 'Cr Amt']);
    sheet.addRow(['Alpha', '100.00']);
    await book.xlsx.writeFile(stored);
    const file = (await db.query('INSERT INTO intel_import_files(company_id,source_system_id,file_name,stored_path,file_hash,file_size,status,reporting_period_to,analysis) VALUES($1,$2,\'report.xlsx\',$3,$4,1,\'ANALYZED\',\'2027-03-31\',\'{}\') RETURNING id',
      [company, source, stored, randomUUID()])).rows[0].id;
    const oldReference = { ...await tally.snapshot(tallyId), batchId: sourceBatch, balanceDate: '9999-12-31', balanceDateAssumed: false };
    await imports.processFile(file, { username: 'test', reference: oldReference });
    const original = (await db.query('SELECT * FROM intel_import_batches WHERE import_file_id=$1', [file])).rows[0];
    assert.equal((await imports.getResults(file)).accounts[0].status, 'COMPARISON_UNAVAILABLE');
    await fs.unlink(stored); // Repair must not require the server's original workbook path.
    const selected = async () => (await db.query('SELECT selected_batch_id,status FROM intel_import_files WHERE id=$1', [file])).rows[0];
    const generations = async () => (await db.query('SELECT count(*)::int AS n FROM intel_import_batches WHERE import_file_id=$1', [file])).rows[0].n;
    const candidates = (await repair.inspect()).filter(row => row.import_file_id === file);
    assert.equal(candidates.length, 1);
    assert.equal(await generations(), 1, 'inspection must not change the database');

    await t.test('a failed publication rolls back the claim, rows and selected pointer', async t => {
      const publish = imports.publishGeneration;
      t.mock.method(imports, 'publishGeneration', async (...args) => {
        await publish(...args);
        throw new Error('Synthetic publication failure');
      });
      await assert.rejects(repair.repairOne(candidates[0]), /Synthetic publication failure/);
      assert.equal(await generations(), 1);
      assert.deepEqual(await selected(), { selected_batch_id: original.id, status: 'COMPLETED' });
    });

    // A mapping edited after the original capture must not alter the repair's inputs.
    const account = (await db.query('SELECT id FROM intel_accounts WHERE company_id=$1', [company])).rows[0].id;
    await db.query('INSERT INTO intel_account_maps(company_id,account_id,tally_ledger_id,tally_ledger_name,mapped_by,source) VALUES($1,$2,$3,\'Alpha\',\'test\',\'MANUAL\')',
      [company, account, oldReference.ledgers[0].id]);
    const correction = await repair.repairOne(candidates[0]);
    assert.equal(correction.status, 'corrected');
    assert.equal(await generations(), 2);
    const result = await imports.getResults(file);
    assert.equal(result.accounts[0].status, 'MATCHED');
    assert.equal(result.accounts[0].difference, '0.00');
    assert.equal(result.accounts[0].tally_balance_date, null);
    assert.equal(result.batch.frozen_inputs.reference.balanceDateAssumed, true);
    assert.deepEqual(result.batch.frozen_inputs.accountMaps, original.frozen_inputs.accountMaps);
    assert.deepEqual(result.batch.frozen_inputs.staged, original.frozen_inputs.staged);
    assert.deepEqual(result.batch.frozen_inputs.analysis, original.frozen_inputs.analysis);
    assert.deepEqual(result.batch.frozen_inputs.reference.ledgers, original.frozen_inputs.reference.ledgers);
    assert.match(result.notes[0], /full history/);
    assert.match(result.notes[0], /assumed.*2027-03-31/);
    assert.equal((await db.query('SELECT import_batch_id FROM intel_company_publications WHERE company_id=$1', [company])).rows[0].import_batch_id, correction.batch_id);
    assert.deepEqual((await db.query('SELECT frozen_inputs FROM intel_import_batches WHERE id=$1', [original.id])).rows[0].frozen_inputs, original.frozen_inputs);
    assert.equal((await db.query('SELECT tally_balance_date FROM intel_reconciliations WHERE import_batch_id=$1', [original.id])).rows[0].tally_balance_date, '9999-12-31');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM intel_audit WHERE action='BALANCE_DATE_CORRECTION' AND entity_id=$1", [file])).rows[0].n, 1);
    assert.equal((await repair.inspect()).filter(row => row.import_file_id === file).length, 0);
    assert.equal((await repair.repairOne(candidates[0])).status, 'skipped');
    assert.equal(await generations(), 2);
  } finally {
    config.assumeUndatedTallyBalances = originalPolicy;
    for (const table of ['intel_project_snapshots', 'intel_company_publications', 'intel_exceptions', 'intel_reconciliations', 'intel_outstanding', 'intel_import_files', 'intel_account_maps', 'intel_accounts']) {
      await db.query(`DELETE FROM ${table} WHERE company_id=$1`, [company]);
    }
    await db.query('DELETE FROM intel_companies WHERE id=$1', [company]);
    await db.query('DELETE FROM "Ledgers" WHERE "CompanyID"=$1', [tallyId]);
    await db.query('DELETE FROM "Companies" WHERE "CompanyID"=$1', [tallyId]);
    await db.query('DELETE FROM tally_source_snapshots WHERE batch_id=$1', [sourceBatch]);
    await fs.rm(temp, { recursive: true });
    await db.close();
  }
});
