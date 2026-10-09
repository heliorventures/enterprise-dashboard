const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const ExcelJS=require('exceljs');
const enabled=process.env.DB_HOST==='127.0.0.1' && process.env.DB_PORT==='58419' && process.env.DB_NAME==='enterprise_dashboard_test' && process.env.DB_USER==='dashboard_test';

test('durable imports publish exact immutable company snapshots with atomic corrections',{skip:!enabled},async t=>{
  const db=require('../src/db');
  const imports=require('../src/intelligence/imports/service');
  const dashboard=require('../src/intelligence/dashboard/service');
  const sync=require('../src/intelligence/sync/service');
  const tally=require('../src/intelligence/tally/provider');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'intel-publication-'));
  const source=(await db.query("SELECT id FROM intel_source_systems WHERE type='EXCEL' LIMIT 1")).rows[0].id;
  const name=`Intelligence Test ${randomUUID()}`;
  const tallyId=(await db.query('INSERT INTO "Companies"("CompanyName") VALUES($1) RETURNING "CompanyID" AS id',[name])).rows[0].id;
  const company=(await db.query('INSERT INTO intel_companies(name,tally_company_id) VALUES($1,$2) RETURNING id',[name,tallyId])).rows[0].id;
  const batchRef=`test-${randomUUID()}`;
  const ledgers=(await db.query('INSERT INTO "Ledgers"("CompanyID","LedgerName","GroupCategory","CurrentBalance") VALUES($1,\'Alpha\',\'Debtors\',\'90071992547409.91\'),($1,\'Other\',\'Debtors\',\'7.00\') RETURNING "LedgerID" AS id',[tallyId])).rows;
  await db.query('INSERT INTO tally_source_snapshots(batch_id,company_external_id,company_name,captured_at,schema_version,coverage_status,manifest) VALUES($1,$2,$3,\'2026-10-08\',1,\'complete\',$4)',[batchRef,String(tallyId),name,{dateContext:{ledgers:{from:'2026-01-01',to:'2026-09-30'}}}]);
  await db.query('INSERT INTO finance_snapshots(company_id,batch_id,captured_at) VALUES($1,$2,\'2026-10-08\')',[tallyId,batchRef]);
  await db.query('INSERT INTO finance_ledger_facts(company_id,name,group_name,closing_balance,batch_id,ordinal) VALUES($1,\'Alpha\',\'Debtors\',\'90071992547409.91\',$2,0),($1,\'Other\',\'Debtors\',\'7.00\',$2,1)',[tallyId,batchRef]);
  await db.query('INSERT INTO intel_rules(company_id,key,value) VALUES($1,\'amount_tolerance\',\'{"amount":0}\')',[company]);
  const fileIds=[];
  async function file(date='2026-09-30',rows=[['Alpha','90071992547409.91'],['Beta','20.00']]) {
    const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Outstanding');
    sheet.getRow(1).values=['Outstanding Report'];sheet.getRow(2).values=['From: 01/01/2026 To: 30/09/2026'];sheet.getRow(3).values=[name];
    sheet.getRow(4).values=['Particulars','Pending Bill'];sheet.getRow(5).values=[null,'Dr Amt'];
    rows.forEach((row,index)=>{sheet.getRow(index+6).values=row;});
    const storedPath=path.join(temp,`${randomUUID()}.xlsx`);await fs.writeFile(storedPath,await book.xlsx.writeBuffer());
    const id=(await db.query('INSERT INTO intel_import_files(company_id,source_system_id,file_name,stored_path,file_hash,file_size,status,reporting_period_to,analysis) VALUES($1,$2,\'test.xlsx\',$3,$4,1,\'ANALYZED\',$5,\'{}\') RETURNING id',[company,source,storedPath,randomUUID(),date])).rows[0].id;
    fileIds.push(id);return id;
  }
  const current=async()=> (await db.query('SELECT import_batch_id FROM intel_company_publications WHERE company_id=$1',[company])).rows[0]?.import_batch_id;
  const id=await file();let firstBatch;
  try {
    await t.test('six concurrent workers create one generation without exhausting the five-client pool',async()=>{
      await Promise.all(Array.from({length:6},()=>imports.processFile(id,{username:'test'})));
      firstBatch=await current();assert.ok(firstBatch);
      assert.equal((await imports.getResults(id)).batch.total_rows,2);
      await imports.processFile(id);assert.equal((await db.query('SELECT count(*)::int AS count FROM intel_import_batches WHERE import_file_id=$1',[id])).rows[0].count,1);
      const rows=(await dashboard.outstanding({companyId:company})).items;
      assert.equal(rows.length,2);assert.equal(rows.find(row=>row.account_name==='Alpha').pending_bill_debit,'90071992547409.91');
      const recon=await dashboard.gaps({companyId:company});
      assert.equal(recon.find(row=>row.tally_ledger_name==='Alpha').status,'MATCHED');
      assert.equal(recon.find(row=>row.outstanding_id===null).status,'MISSING_IN_SOURCE');
      assert.equal(recon[0].tally_balance_date,'2026-09-30');
      assert.equal((await tally.snapshot(tallyId)).balanceDate,'2026-09-30');
      await db.query('UPDATE "Ledgers" SET "CurrentBalance"=999 WHERE "CompanyID"=$1',[tallyId]);
      assert.equal((await tally.snapshot(tallyId)).ledgers.find(row=>row.name==='Alpha').balance,'90071992547409.91');
      const summary=await dashboard.summary({companyId:company});
      assert.equal(summary.cards.totalFinancialGap,'27.00');
      assert.equal(summary.byCompany[0].gap,'27.00');
      assert.equal((await sync.listSync({companyId:company})).items.find(row=>row.outstanding_id===null).reporting_date,'2026-09-30');
      assert.equal((await dashboard.outstanding({companyId:company,status:'MATCHED'})).total,1);
    });
    await t.test('older and undated reports stay history without replacing current data',async()=>{
      await imports.processFile(await file('2026-08-31',[['Alpha','1.00']]));
      await imports.processFile(await file(null,[['Alpha','2.00']]));
      assert.equal(await current(),firstBatch);assert.equal((await dashboard.outstanding({companyId:company})).total,2);
      const alpha=(await db.query('SELECT id FROM intel_accounts WHERE company_id=$1 AND account_name=\'Alpha\'',[company])).rows[0].id;
      const history=await dashboard.accountDetail(alpha);assert.equal(history.outstanding.length,3);assert.equal(history.outstanding.filter(row=>row.is_current).length,1);
    });
    await t.test('reprocess appends history; publication failure preserves previous complete generation',async()=>{
      await imports.processFile(id,{reprocess:true});const before=await current();assert.notEqual(before,firstBatch);
      await db.query(`CREATE FUNCTION intel_test_outstanding_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.company_id='${company}'::uuid THEN RAISE EXCEPTION 'injected publication failure'; END IF; RETURN NEW; END $$`);
      await db.query('CREATE TRIGGER intel_test_outstanding_fail BEFORE INSERT ON intel_outstanding FOR EACH ROW EXECUTE FUNCTION intel_test_outstanding_fail()');
      try {await assert.rejects(imports.processFile(id,{reprocess:true}),/injected publication failure/);}finally{await db.query('DROP TRIGGER intel_test_outstanding_fail ON intel_outstanding');await db.query('DROP FUNCTION intel_test_outstanding_fail()');}
      assert.equal(await current(),before);assert.equal((await db.query('SELECT count(*)::int AS count FROM intel_outstanding WHERE company_id=$1',[company])).rows[0].count,6);
      assert.equal((await db.query('SELECT count(*)::int AS count FROM intel_outstanding o JOIN intel_import_batches b ON b.id=o.import_batch_id WHERE o.company_id=$1 AND b.status=\'FAILED\'',[company])).rows[0].count,0);
      const retry=await imports.processFile(id);
      assert.equal(retry.batch.status,'COMPLETED');assert.equal(retry.batch.id,before);
      assert.equal((await imports.getProgress(id)).batch.id,before);
    });
    await t.test('manual correction publishes new generation with scoped exceptions and Tally-only membership',async()=>{
      const before=await current();const beta=(await sync.listSync({companyId:company,q:'Beta'})).items[0];
      const column=(await imports.getFile(id)).analysis.columns.find(column=>column.target==='pending_bill_debit').canonical;
      await imports.updateMapping(id,[{sourceHeader:column,targetField:'paid_amount'}],'test');
      await db.query('UPDATE intel_rules SET value=\'{"amount":999999}\' WHERE company_id=$1 AND key=\'amount_tolerance\'',[company]);
      const mapped=await sync.mapRecon(beta.id,ledgers[1].id,'test');assert.notEqual(mapped.id,beta.id);assert.equal(mapped.mapping.method,'MANUAL');assert.equal(mapped.comparison.tallyBalanceDate,'2026-09-30');
      assert.equal(mapped.comparison.sourceAmount,'20.00');assert.equal(mapped.status,'AMOUNT_MISMATCH');
      await imports.updateMapping(id,[{sourceHeader:column,targetField:'pending_bill_debit'}],'test');
      await db.query('UPDATE intel_rules SET value=\'{"amount":0}\' WHERE company_id=$1 AND key=\'amount_tolerance\'',[company]);
      assert.notEqual(await current(),before);assert.equal((await dashboard.gaps({companyId:company})).filter(row=>row.outstanding_id===null).length,0);
      assert.ok((await db.query('SELECT id FROM intel_reconciliations WHERE id=$1',[beta.id])).rowCount);
      const alpha=(await sync.listSync({companyId:company,q:'Alpha'})).items[0];
      const pointer=await current();await assert.rejects(sync.mapRecon(alpha.id,ledgers[1].id,'test'),/already reserved/);assert.equal(await current(),pointer);
    });
    await t.test('abandoned durable claim recovers; complete validation rejects duplicates',async()=>{
      const recoveryFile=await file('2026-08-01',[['Gamma','1.00']]);const abandoned=await imports.claim(recoveryFile);
      await db.query("UPDATE intel_import_batches SET heartbeat_at=now()-interval '3 minutes' WHERE id=$1",[abandoned.batch.id]);
      const recovered=await imports.getProgress(recoveryFile);assert.equal(recovered.status,'FAILED');assert.equal(recovered.running,false);
      await imports.processFile(recoveryFile);
      assert.equal((await db.query('SELECT status FROM intel_import_batches WHERE id=$1',[abandoned.batch.id])).rows[0].status,'FAILED');
      const duplicate=await file('2026-10-01',[['Alpha','1.00'],['alpha','2.00']]);
      assert.equal((await imports.validateOnly(duplicate)).canProcess,false);await assert.rejects(imports.processFile(duplicate),/Validation failed/);
      assert.equal((await db.query('SELECT count(*)::int AS count FROM intel_import_batches WHERE import_file_id=$1',[duplicate])).rows[0].count,0);
    });
    await t.test('malformed and unnamed financial rows reject the entire workbook',async()=>{
      for(const rows of [[['Alpha','1.00'],['Bad','oops']],[['Alpha','1.00'],[null,'2.00']]]) {
        const invalid=await file('2026-10-01',rows);const validation=await imports.validateOnly(invalid);
        assert.equal(validation.total,2);assert.equal(validation.canProcess,false);
        await assert.rejects(imports.processFile(invalid),/Validation failed/);
      }
    });
    await t.test('exception pages remain accessible beyond the display export cap',async()=>{
      const batch=await current();
      await db.query("INSERT INTO intel_exceptions(company_id,import_batch_id,type,title) SELECT $1,$2,'TEST_PAGE','Test paging '||n FROM generate_series(1,601) n",[company,batch]);
      const page=await dashboard.listExceptionsPage({companyId:company,q:'Test paging',page:4,pageSize:200});
      assert.equal(page.total,601);assert.equal(page.items.length,1);assert.equal(page.page,4);
      assert.equal((await dashboard.listExceptions({companyId:company,q:'Test paging',limit:10001})).length,601);
      await db.query("DELETE FROM intel_exceptions WHERE company_id=$1 AND type='TEST_PAGE'",[company]);
    });
    await t.test('unknown legacy provenance cannot certify current matching or financial gaps',async()=>{
      const recon=(await dashboard.gaps({companyId:company})).find(row=>row.tally_ledger_name==='Other');
      await db.query("UPDATE intel_reconciliations SET comparison_available=false,status='AMOUNT_MISMATCH',difference=999 WHERE id=$1",[recon.id]);
      const view=(await dashboard.gaps({companyId:company})).find(row=>row.id===recon.id);
      assert.equal(view.status,'COMPARISON_UNAVAILABLE');assert.equal(view.difference,null);
      assert.equal((await db.query('SELECT status,difference FROM intel_reconciliations WHERE id=$1',[recon.id])).rows[0].difference,'999.00');
      const exception=(await dashboard.listExceptions({companyId:company})).find(row=>row.reconciliation_id===recon.id);
      if (exception) {assert.equal(exception.type,'COMPARISON_UNAVAILABLE');assert.equal(exception.detail.difference,null);}
      const account=(await db.query('SELECT account_id FROM intel_outstanding WHERE id=$1',[recon.outstanding_id])).rows[0];
      if (account) assert.equal((await dashboard.accountDetail(account.account_id)).outstanding.find(row=>row.is_current).status,'COMPARISON_UNAVAILABLE');
    });
    await t.test('a compound report retains one generation when publication changes between sections',async()=>{
      const newFile=await file('2026-10-01',[['Alpha','100.00']]);
      const query=db.query;let published=false;
      db.query=async(sql,params)=>{
        const result=await query(sql,params);
        if(!published && sql.includes('AS records') && sql.includes('intel_current_outstanding')) {
          published=true;await imports.processFile(newFile);
        }
        return result;
      };
      let summary;
      try {summary=await dashboard.summary({companyId:company});} finally {db.query=query;}
      assert.equal(summary.cards.records,2);assert.equal(summary.cards.totalOutstanding,summary.byCompany[0].outstanding);
      assert.equal((await dashboard.outstanding({companyId:company})).items[0].pending_bill_debit,'100.00');
    });
    await t.test('mapping edits invalidate validation and explicit ignores defeat automatic guessing',async()=>{
      const mappingFile=await file();assert.equal((await imports.validateOnly(mappingFile)).canProcess,true);
      const secondMapping=await file();
      await Promise.all([mappingFile,secondMapping].map(file=>imports.updateMapping(file,[{sourceHeader:'Particulars',targetField:'account_name'}],'test')));
      assert.equal((await imports.getFile(mappingFile)).analysis.validation,undefined);
      await imports.updateMapping(mappingFile,[{sourceHeader:'Particulars',targetField:null}],'test');
      assert.equal((await imports.getFile(mappingFile)).analysis.validation,undefined);
      assert.equal((await imports.validateOnly(mappingFile)).canProcess,false);
    });
  } finally {
    await db.query('DELETE FROM intel_company_publications WHERE company_id=$1',[company]);
    await db.query('DELETE FROM intel_exceptions WHERE company_id=$1',[company]);
    await db.query('DELETE FROM intel_reconciliations WHERE company_id=$1',[company]);
    await db.query('DELETE FROM intel_outstanding WHERE company_id=$1',[company]);
    await db.query('DELETE FROM intel_import_files WHERE id=ANY($1::uuid[])',[fileIds]);
    await db.query('DELETE FROM intel_companies WHERE id=$1',[company]);
    await db.query('DELETE FROM finance_ledger_facts WHERE company_id=$1',[tallyId]);await db.query('DELETE FROM finance_snapshots WHERE company_id=$1',[tallyId]);await db.query('DELETE FROM tally_source_snapshots WHERE batch_id=$1',[batchRef]);
    await db.query('DELETE FROM "Ledgers" WHERE "CompanyID"=$1',[tallyId]);await db.query('DELETE FROM "Companies" WHERE "CompanyID"=$1',[tallyId]);
    await fs.rm(temp,{recursive:true});await db.close();
  }
});
