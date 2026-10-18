process.env.TALLY_INGEST_TOKEN = 'projects-test-ingest-token-with-32-characters';
process.env.DASHBOARD_USER = 'projects-user';
process.env.DASHBOARD_PASSWORD = 'projects-password';
process.env.DASHBOARD_SESSION_SECRET = 'projects-session-secret-at-least-32-chars';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const enabled = process.env.DB_HOST === '127.0.0.1' && process.env.DB_PORT === '58419' && process.env.DB_NAME === 'enterprise_dashboard_test' && process.env.DB_USER === 'dashboard_test';

test('budget status uses the billed amount against the project budget', () => {
  const { budgetStatus } = require('../src/intelligence/projects/service');
  assert.deepEqual(budgetStatus('50.00', '100.00'), { used: 50, status: 'ON_TRACK' });
  assert.deepEqual(budgetStatus('80.00', '100.00'), { used: 80, status: 'AT_RISK' });
  assert.deepEqual(budgetStatus('101.00', '100.00'), { used: 101, status: 'OVER_BUDGET' });
  assert.deepEqual(budgetStatus('10.00', null), { used: null, status: 'NO_BUDGET' });
  assert.deepEqual(budgetStatus('10.00', '0.00'), { used: null, status: 'NO_BUDGET' });
});

test('a party is missing in Tally only when no ledger matched; a partial name match needs checking', () => {
  const { classify } = require('../src/intelligence/presence');
  assert.equal(classify({ tally_ledger_id: null, match_method: null }), 'MISSING_IN_TALLY');
  assert.equal(classify({ tally_ledger_id: 4, match_method: 'FUZZY_NAME' }), 'POSSIBLE');
  assert.equal(classify({ tally_ledger_id: 4, match_method: 'FUZZY_NAME_AMOUNT' }), 'POSSIBLE');
  assert.equal(classify({ tally_ledger_id: 4, match_method: 'NAME' }), 'FOUND');
  assert.equal(classify({ tally_ledger_id: 4, match_method: 'MANUAL' }), 'FOUND');
  assert.equal(classify({ tally_ledger_id: 4, match_method: 'PAN_NAME' }), 'FOUND');
});

test('Excel parties are grouped by project and compared with Tally per project', { skip: !enabled }, async t => {
  const db = require('../src/db');
  const imports = require('../src/intelligence/imports/service');
  const projects = require('../src/intelligence/projects/service');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'intel-projects-'));
  const source = (await db.query("SELECT id FROM intel_source_systems WHERE type='EXCEL' LIMIT 1")).rows[0].id;
  const name = `Projects Test ${randomUUID()}`;
  const tallyId = (await db.query('INSERT INTO "Companies"("CompanyName") VALUES($1) RETURNING "CompanyID" AS id', [name])).rows[0].id;
  const company = (await db.query('INSERT INTO intel_companies(name,tally_company_id) VALUES($1,$2) RETURNING id', [name, tallyId])).rows[0].id;
  const tallyProject = (await db.query('INSERT INTO "Projects"("CompanyID","ProjectName") VALUES($1,\'Majalgaon-Beed\') RETURNING "ProjectID" AS id', [tallyId])).rows[0].id;
  const batchRef = `test-${randomUUID()}`;
  await db.query('INSERT INTO "Ledgers"("CompanyID","LedgerName","GroupCategory","CurrentBalance") VALUES($1,\'Pratik Petrolium - Majalgaon\',\'Creditors\',\'100.00\'),($1,\'Gamma Works - Isapur\',\'Creditors\',\'50.00\'),($1,\'Tally Only - Majalgaon\',\'Creditors\',\'5.00\')', [tallyId]);
  await db.query('UPDATE "Ledgers" SET "SourceKey"=\'ledger:\'||lower("LedgerName") WHERE "CompanyID"=$1', [tallyId]);
  await db.query('INSERT INTO tally_source_snapshots(batch_id,company_external_id,company_name,captured_at,schema_version,coverage_status,manifest) VALUES($1,$2,$3,\'2026-10-08\',1,\'complete\',$4)', [batchRef, String(tallyId), name, { dateContext: { ledgers: { from: '2026-01-01', to: '2026-09-30' } } }]);
  await db.query('INSERT INTO finance_snapshots(company_id,batch_id,captured_at) VALUES($1,$2,\'2026-10-08\')', [tallyId, batchRef]);
  await db.query('UPDATE finance_snapshots SET currency=\'INR\',coverage=\'{"uniformCurrency":true}\' WHERE company_id=$1', [tallyId]);
  await db.query('INSERT INTO finance_ledger_facts(company_id,name,group_name,closing_balance,batch_id,ordinal) VALUES($1,\'Pratik Petrolium - Majalgaon\',\'Creditors\',\'100.00\',$2,0),($1,\'Gamma Works - Isapur\',\'Creditors\',\'50.00\',$2,1),($1,\'Tally Only - Majalgaon\',\'Creditors\',\'5.00\',$2,2)', [tallyId, batchRef]);
  await db.query('INSERT INTO intel_rules(company_id,key,value) VALUES($1,\'amount_tolerance\',\'{"amount":0}\')', [company]);

  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Outstanding');
  sheet.getRow(1).values = ['Outstanding Report'];
  sheet.getRow(2).values = ['From: 01/01/2026 To: 30/09/2026'];
  sheet.getRow(3).values = [name, 'Currency: INR'];
  sheet.getRow(4).values = ['Particulars', 'Pending Bill', 'Pending Bill'];
  sheet.getRow(5).values = [null, 'Dr Amt', 'Cr Amt'];
  [['Pratik Petrolium - Majalgaon', '100.00'], ['Gamma Works - Isapur', '70.00'], ['Other Party', '10.00']].forEach((row, index) => { sheet.getRow(index + 6).values = row; });
  const storedPath = path.join(temp, `${randomUUID()}.xlsx`);
  await fs.writeFile(storedPath, await book.xlsx.writeBuffer());
  const fileId = (await db.query('INSERT INTO intel_import_files(company_id,source_system_id,file_name,stored_path,file_hash,file_size,status,reporting_period_to,analysis) VALUES($1,$2,\'test.xlsx\',$3,$4,1,\'ANALYZED\',\'2026-09-30\',\'{}\') RETURNING id', [company, source, storedPath, randomUUID()])).rows[0].id;
  const row = (list, account) => list.items.find(item => item.account_name === account);

  try {
    await t.test('rules place new parties in projects and the summary shows the per-project gap', async () => {
      const majalgaon = await projects.createProject(company, { name: 'Majalgaon', keywords: ['Majalgaon'], tallyProjectId: tallyProject, budgetExpense: '200.00' }, 'test');
      const isapur = await projects.createProject(company, { name: 'Isapur', keywords: ['Isapur'] }, 'test');
      await imports.processFile(fileId, { username: 'test' });
      const result = await projects.summary(company);
      const byName = Object.fromEntries(result.projects.map(project => [project.name, project]));
      assert.equal(result.currency, 'INR');
      assert.equal(byName.Majalgaon.parties, 1);
      assert.equal(byName.Majalgaon.matched, 1);
      assert.equal(byName.Majalgaon.tallyOnlyLedgers, 1, 'a Tally ledger missing from Excel is attributed by the same keyword');
      assert.equal(byName.Majalgaon.gap, '5.00');
      assert.equal(byName.Majalgaon.tallyProjectName, 'Majalgaon-Beed');
      assert.equal(byName.Majalgaon.health, 'HAS_GAPS');
      assert.deepEqual([byName.Majalgaon.excelAmount, byName.Majalgaon.tallyAmount, byName.Majalgaon.netDifference], ['100.00', '105.00', '-5.00'],
        'Tally total includes the ledger that is missing from Excel');
      assert.equal(byName.Isapur.parties, 1);
      assert.equal(byName.Isapur.differences, 1);
      assert.equal(byName.Isapur.gap, '20.00');
      assert.deepEqual([byName.Isapur.excelAmount, byName.Isapur.tallyAmount, byName.Isapur.netDifference], ['70.00', '50.00', '20.00']);
      assert.equal(result.unassigned.parties, 1);
      assert.deepEqual(result.coverage, { assigned: 2, total: 3 });
      assert.equal(result.tally.amountsAvailable, false, 'Tally voucher amounts are reported as unavailable, not guessed');
      assert.equal(result.latestImport.file_name, 'test.xlsx');
      const detail = await projects.detail(company, isapur.id, {});
      assert.equal(detail.items.length, 1);
      assert.equal(detail.items[0].difference, '20.00', 'difference is Excel minus Tally');
      assert.equal(row(await projects.detail(company, null, {}), 'Other Party').project_source, null);
    });

    await t.test('each upload stores a snapshot per project for progress over time', async () => {
      const all = await projects.history(company);
      const byName = Object.fromEntries(all.items.map(item => [item.projectName, item]));
      assert.equal(all.items.length, 3, 'two projects plus the parties without a project');
      assert.equal(byName.Majalgaon.parties, 1);
      assert.equal(byName.Majalgaon.matched, 1);
      assert.equal(byName.Majalgaon.tallyOnlyLedgers, 1);
      assert.equal(byName.Majalgaon.gap, '5.00');
      assert.equal(byName.Majalgaon.pending, '100.00');
      assert.equal(byName.Isapur.gap, '20.00');
      assert.equal(byName['Not assigned to a project'].parties, 1);
      assert.ok(all.items.every(item => item.current && item.fileName === 'test.xlsx' && item.currency === 'INR'));
      const isapur = (await projects.summary(company)).projects.find(project => project.name === 'Isapur');
      const one = await projects.history(company, isapur.id);
      assert.deepEqual(one.items.map(item => item.projectName), ['Isapur']);
      assert.deepEqual((await projects.history(company, 'unassigned')).items.map(item => item.projectName), ['Not assigned to a project']);
    });

    await t.test('the difference report lists every gap with its project, Excel minus Tally', async () => {
      const report = require('../src/intelligence/projects/report');
      const built = await report.build(company);
      const line = what => built.lines.find(item => item.where === what);
      assert.equal(built.lines.length, 3, 'the matched party is not a difference');
      assert.deepEqual([line('Amounts differ').project, line('Amounts differ').excel, line('Amounts differ').tally, line('Amounts differ').difference], ['Isapur', 70, 50, 20]);
      assert.deepEqual([line('In Tally, not in Excel').project, line('In Tally, not in Excel').tally], ['Majalgaon', 5]);
      assert.equal(line('In Excel, not found in Tally').project, 'Not assigned to a project');
      const text = report.toCsv(built);
      assert.match(text, /^Project,What is different,Name in Excel,Name in Tally,Excel amount,Tally amount,Difference \(Excel minus Tally\),Currency\r\n/);
      assert.equal(text.trim().split('\r\n').length, 4);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await report.toWorkbook(built));
      assert.deepEqual(book.worksheets.map(sheetItem => sheetItem.name), ['Summary', 'Differences', 'Progress by upload']);
      assert.equal(book.getWorksheet('Differences').rowCount, 4);
      assert.equal(book.getWorksheet('Progress by upload').rowCount, 4);
      assert.match(report.fileName(built.company, 'xlsx'), /^projects-test-.*-project-difference-\d{4}-\d{2}-\d{2}\.xlsx$/);
    });

    await t.test('what is missing in Tally is answered by name, even when amounts cannot be compared', async () => {
      const presence = require('../src/intelligence/presence');
      const names = list => list.map(item => item.account_name || item.tally_ledger_name).sort();
      const check = data => {
        assert.deepEqual(data.summary, { excelParties: 3, found: 2, possible: 0, missingInTally: 1, missingInExcel: 1 });
        assert.deepEqual(names(data.missingInTally), ['Other Party']);
        assert.deepEqual(names(data.missingInExcel), ['Tally Only - Majalgaon']);
        assert.deepEqual(names(data.found), ['Gamma Works - Isapur', 'Pratik Petrolium - Majalgaon']);
      };
      check(await presence.presence(company));
      const original = (await db.query('SELECT id,frozen_inputs FROM intel_import_batches WHERE import_file_id=$1 ORDER BY generation DESC LIMIT 1', [fileId])).rows[0];
      try {
        // Forget the currencies, as for a company whose Tally currency is not confirmed.
        await db.query(`UPDATE intel_import_batches SET frozen_inputs=jsonb_set(jsonb_set(frozen_inputs,'{analysis,currency}','null'),'{reference,uniformCurrency}','false') WHERE id=$1`, [original.id]);
        assert.equal((await projects.summary(company)).currency, null, 'amounts are not comparable now');
        assert.match((await projects.summary(company)).currencyMessage, /Missing in Tally/);
        check(await presence.presence(company));
      } finally {
        await db.query('UPDATE intel_import_batches SET frozen_inputs=$2 WHERE id=$1', [original.id, original.frozen_inputs]);
      }
      const data = await presence.presence(company);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await presence.toWorkbook(data));
      assert.deepEqual(book.worksheets.map(item => item.name), ['Summary', 'Missing in Tally', 'Check these', 'Missing in Excel', 'Found in both']);
      assert.equal(book.getWorksheet('Missing in Tally').rowCount, 2);
      assert.equal(book.getWorksheet('Missing in Excel').getRow(2).getCell(1).value, 'Tally Only - Majalgaon');
      const rows = presence.toCsv(data).trim().split('\r\n');
      assert.equal(rows.length, 3, 'only the differences are listed: header, one missing in Tally, one missing in Excel');
      assert.match(rows[1], /^"In Excel, missing in Tally",Other Party,,10,/);
      assert.match(rows[2], /^"In Tally, missing in Excel",,Tally Only - Majalgaon,,5,Creditors,Majalgaon$/);
    });

    await t.test('history and the report download are served over HTTP behind the session', async () => {
      const { app } = require('../src/server');
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      try {
        const query = `company=${tallyId}`;
        assert.equal((await fetch(`${origin}/api/imports/projects/history?${query}`)).status, 401);
        assert.equal((await fetch(`${origin}/api/imports/projects/report/xlsx?${query}`)).status, 401);
        const login = await fetch(`${origin}/api/auth/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'projects-user', password: 'projects-password' }),
        });
        const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
        const history = await (await fetch(`${origin}/api/imports/projects/history?${query}`, { headers })).json();
        assert.equal(history.items.length, 3);
        assert.equal((await fetch(`${origin}/api/imports/projects/history`, { headers })).status, 400, 'a company is required');
        assert.equal((await fetch(`${origin}/api/imports/projects/history?${query}&project=not-a-uuid`, { headers })).status, 400);
        const xlsx = await fetch(`${origin}/api/imports/projects/report/xlsx?${query}`, { headers });
        assert.equal(xlsx.status, 200);
        assert.match(xlsx.headers.get('content-type'), /spreadsheetml\.sheet/);
        assert.match(xlsx.headers.get('content-disposition'), /attachment; filename="projects-test-.*\.xlsx"/);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
        assert.equal(book.getWorksheet('Differences').rowCount, 4);
        const csv = await fetch(`${origin}/api/imports/projects/report/csv?${query}`, { headers });
        assert.match(csv.headers.get('content-type'), /text\/csv/);
        assert.equal((await csv.text()).trim().split('\r\n').length, 4);
        assert.equal((await fetch(`${origin}/api/imports/projects/report/pdf?${query}`, { headers })).status, 404);
        assert.equal((await fetch(`${origin}/api/imports/missing?${query}`)).status, 401);
        const missing = await (await fetch(`${origin}/api/imports/missing?${query}`, { headers })).json();
        assert.equal(missing.summary.missingInTally, 1);
        assert.equal((await fetch(`${origin}/api/imports/missing`, { headers })).status, 400, 'a company is required');
        const missingXlsx = await fetch(`${origin}/api/imports/missing/report/xlsx?${query}`, { headers });
        assert.match(missingXlsx.headers.get('content-disposition'), /filename="projects-test-.*-missing-in-tally-.*\.xlsx"/);
        const missingCsv = await fetch(`${origin}/api/imports/missing/report/csv?${query}`, { headers });
        assert.match(await missingCsv.text(), /^Result,Name in Excel,Name in Tally,Amount in Excel \(as stated\),Balance in Tally,Group,Project\r\n/);
        assert.equal((await fetch(`${origin}/api/imports/missing/report/pdf?${query}`, { headers })).status, 404);
      } finally {
        await new Promise(resolve => server.close(resolve));
      }
    });

    await t.test('a manual decision beats rules and survives re-applying them', async () => {
      const other = (await db.query("SELECT id FROM intel_accounts WHERE company_id=$1 AND account_name='Other Party'", [company])).rows[0].id;
      const majalgaon = (await projects.summary(company)).projects.find(project => project.name === 'Majalgaon');
      await projects.assignAccount(other, majalgaon.id, 'test');
      assert.equal((await projects.reapply(company, 'test')).changed, 0);
      assert.equal((await projects.summary(company)).projects.find(project => project.name === 'Majalgaon').parties, 2);
      assert.equal((await projects.history(company, majalgaon.id)).items[0].parties, 2, 'the newest snapshot follows the move');
      const pratik = (await db.query("SELECT id FROM intel_accounts WHERE company_id=$1 AND account_name LIKE 'Pratik%'", [company])).rows[0].id;
      await assert.rejects(() => projects.assignAccount(pratik, randomUUID(), 'test'), /same company/);
      await projects.assignAccount(other, null, 'test');
      assert.equal((await projects.summary(company)).unassigned.parties, 1, 'clearing a manual choice returns the party to the rules');
    });

    await t.test('keywords are unique, deleting a rule releases only rule-assigned parties', async () => {
      const list = await projects.summary(company);
      const majalgaon = list.projects.find(project => project.name === 'Majalgaon');
      await assert.rejects(() => projects.addRule(list.projects.find(project => project.name === 'Isapur').id, 'majalgaon', 'test'), error => error.status === 409);
      await assert.rejects(() => projects.createProject(company, { name: ' majalgaon ' }, 'test'), error => error.status === 409);
      await projects.deleteRule(majalgaon.rules[0].id, 'test');
      const after = await projects.summary(company);
      assert.equal(after.projects.find(project => project.name === 'Majalgaon').parties, 0);
      assert.equal(after.unassigned.parties, 2);
      await projects.addRule(majalgaon.id, 'Majalgaon', 'test');
      assert.equal((await projects.summary(company)).projects.find(project => project.name === 'Majalgaon').parties, 1);
    });

    await t.test('suggestions come from name suffixes and Tally projects; deleting a project releases its parties', async () => {
      await projects.deleteProject((await projects.summary(company)).projects.find(project => project.name === 'Isapur').id, 'test');
      const suggested = await projects.suggestions(company);
      assert.ok(suggested.every(item => item.keyword.toLowerCase() !== 'majalgaon'),
        'a keyword that already has a rule is not suggested again');
      assert.ok(Array.isArray(suggested));
      const final = await projects.summary(company);
      assert.equal(final.projects.length, 1);
      assert.equal(final.unassigned.parties, 2);
      await assert.rejects(() => projects.createProject(company, { name: 'Bad', tallyProjectId: 2147483000 }, 'test'), /Tally project/);
    });

    await t.test('re-importing keeps assignments and applies rules to new parties', async () => {
      await imports.processFile(fileId, { username: 'test', reprocess: true });
      const result = await projects.summary(company);
      assert.equal(result.projects.find(project => project.name === 'Majalgaon').parties, 1);
      const history = await projects.history(company, result.projects.find(project => project.name === 'Majalgaon').id);
      assert.equal(history.items.length, 2, 'every upload keeps its own snapshot');
      assert.equal(history.items.filter(item => item.current).length, 1);
    });
  } finally {
    await db.query('DELETE FROM intel_project_snapshots WHERE company_id=$1', [company]);
    await db.query('DELETE FROM intel_company_publications WHERE company_id=$1', [company]);
    await db.query('DELETE FROM intel_exceptions WHERE company_id=$1', [company]);
    await db.query('DELETE FROM intel_reconciliations WHERE company_id=$1', [company]);
    await db.query('DELETE FROM intel_outstanding WHERE company_id=$1', [company]);
    await db.query('DELETE FROM intel_import_files WHERE id=$1', [fileId]);
    await db.query('DELETE FROM intel_accounts WHERE company_id=$1', [company]);
    await db.query('DELETE FROM intel_projects WHERE company_id=$1', [company]);
    await db.query('DELETE FROM intel_companies WHERE id=$1', [company]);
    await db.query('DELETE FROM finance_ledger_facts WHERE company_id=$1', [tallyId]);
    await db.query('DELETE FROM finance_snapshots WHERE company_id=$1', [tallyId]);
    await db.query('DELETE FROM tally_source_snapshots WHERE batch_id=$1', [batchRef]);
    await db.query('DELETE FROM "Projects" WHERE "CompanyID"=$1', [tallyId]);
    await db.query('DELETE FROM "Ledgers" WHERE "CompanyID"=$1', [tallyId]);
    await db.query('DELETE FROM "Companies" WHERE "CompanyID"=$1', [tallyId]);
    await fs.rm(temp, { recursive: true });
    await db.close();
  }
});
