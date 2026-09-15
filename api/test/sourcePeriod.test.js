const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const archive=require('../src/sourceArchive');
const db=require('../src/db');
after(()=>db.close());
const manifest={batchId:'period-test',capturedAt:'2026-09-14T12:00:00Z',company:{externalId:'period-co',name:'Period Co'},schemaVersion:1,profile:'company-business-v1',chunkCount:1,recordCount:1,consistency:'stable',collections:archive.COLLECTIONS.map(name=>({name,status:'success',count:name==='COMPANY'?1:0})),scope:{kind:'period',from:'2026-09-01',to:'2026-09-15'}};
test('full source endpoint refuses a period manifest instead of silently treating it as complete',()=>{
  assert.throws(()=>archive.manifest(manifest),/period|scope/i);
});
test('period manifests require complete coverage, real ordered calendar dates and preserve their scope',()=>{
  assert.deepEqual(archive.manifest(manifest,'period').scope,manifest.scope);
  assert.equal(archive.manifest(manifest,'period').coverageStatus,'partial');
  assert.throws(()=>archive.manifest({...manifest,scope:{...manifest.scope,from:'2026-02-30'}},'period'),/date/i);
  assert.throws(()=>archive.manifest({...manifest,scope:{...manifest.scope,to:'2026-08-01'}},'period'),/date|period/i);
  assert.throws(()=>archive.manifest({...manifest,consistency:'changed'},'period'),/complete|stable/i);
});

test('period merge preserves history, updates GUIDs, rejects stale/invalid inputs and supports subsequent full reconciliation',{
  skip:process.env.DB_NAME!=='enterprise_dashboard_test'
},async()=>{
  await db.migrate();
  await db.query('TRUNCATE tally_source_uploads,tally_source_snapshots,tally_ingestions,"Vouchers","Projects","Ledgers","Companies","SyncLog" RESTART IDENTITY CASCADE');
  const unpack=require('../src/sourceUnpack');
  const period=require('../src/sourcePeriod');
  const node=(tag,value)=>({tag,attributes:{},content:[value]});
  const company={collection:'COMPANY',ordinal:0,sourceId:'period-co',payload:{tag:'COMPANY',attributes:{NAME:'Period Co'},content:[node('GUID','period-co')]}};
  const v=(guid,date,amount,ordinal=0)=>({collection:'VOUCHER',ordinal,sourceId:guid,payload:{tag:'VOUCHER',attributes:{},content:[node('GUID',guid),node('DATE',date),node('VOUCHERTYPENAME','Sales'),node('VOUCHERNUMBER',guid),node('AMOUNT',amount)]}});
  const make=(id,at,records,scoped=true)=>({...manifest,batchId:id,capturedAt:at,...(!scoped?{scope:undefined}:{}),recordCount:records.length,collections:manifest.collections.map(c=>({...c,count:records.filter(r=>r.collection===c.name).length}))});
  const upload=async(m,records,mode)=>{await archive.begin(m,mode);await archive.chunk({batchId:m.batchId,index:0,records},mode);return archive.complete({batchId:m.batchId},mode);};
  await assert.rejects(()=>period.baseline(db,'period-co'),/full sync/);
  const baseRecords=[company,v('old','20260801','10',0),v('edited','20260903','20',1),v('omitted','20260904','30',2)];
  const base=make('period-base','2026-09-10T00:00:00Z',baseRecords,false);
  await upload(base,baseRecords,'full');
  await assert.rejects(()=>period.baseline(db,'period-co'),/full sync/);
  await unpack.unpackBatch(base.batchId);
  const rows=[company,v('edited','20260903','25',0),v('new','20260905','40',1)];
  const m=make('period-one','2026-09-11T00:00:00Z',rows);
  await archive.begin(m,'period');
  await assert.rejects(()=>archive.chunk({batchId:m.batchId,index:0,records:rows}),/endpoint mismatch/);
  await assert.rejects(()=>archive.chunk({batchId:m.batchId,index:0,records:[company,v('bad','20260801','10')]},'period'),/outside/);
  await assert.rejects(()=>archive.chunk({batchId:m.batchId,index:0,records:[company,{...v('bad','20260901','10'),sourceId:'wrong'}]},'period'),/GUID/);
  await archive.chunk({batchId:m.batchId,index:0,records:rows},'period');
  const receipt=await archive.complete({batchId:m.batchId},'period');
  assert.equal(receipt.coverageStatus,'partial');assert.ok(receipt.reportingBatchId);
  assert.equal((await archive.complete({batchId:m.batchId},'period')).reportingBatchId,receipt.reportingBatchId);
  await assert.rejects(()=>period.baseline(db,'period-co'),/full sync/); // unpublished derived archive blocks racing updates
  await unpack.unpackBatch(receipt.reportingBatchId);
  const amounts=async()=>Object.fromEntries((await db.query(`SELECT "VoucherNumber" AS id,"Amount"::text AS amount FROM "Vouchers" v JOIN "Companies" c USING("CompanyID") WHERE c."ExternalID"='period-co' ORDER BY 1`)).rows.map(r=>[r.id,r.amount]));
  assert.deepEqual(await amounts(),{edited:'25.00',new:'40.00',old:'10.00',omitted:'30.00'});
  assert.equal((await db.query('SELECT batch_id FROM tally_source_latest WHERE company_external_id=$1',['period-co'])).rows[0].batch_id,receipt.reportingBatchId);
  await assert.rejects(()=>archive.begin({...m,batchId:'period-stale'},'period'),/stale/);
  const empty=make('period-empty','2026-09-12T00:00:00Z',[company]);
  const emptyReceipt=await upload(empty,[company],'period');await unpack.unpackBatch(emptyReceipt.reportingBatchId);
  assert.deepEqual(await amounts(),{edited:'25.00',new:'40.00',old:'10.00',omitted:'30.00'});
  const duplicate=[company,v('dup','20260901','1'),v('dup','20260901','2',1)];
  const bad=make('period-duplicates','2026-09-13T00:00:00Z',duplicate);
  await assert.rejects(()=>upload(bad,duplicate,'period'),/Duplicate voucher GUID/);
  assert.equal((await db.query('SELECT 1 FROM tally_source_snapshots WHERE batch_id=$1',[bad.batchId])).rowCount,0);
  const full=make('period-final-full','2026-09-14T00:00:00Z',[company,v('new','20260905','40')],false);
  await upload(full,[company,v('new','20260905','40')],'full');await unpack.unpackBatch(full.batchId);
  assert.deepEqual(await amounts(),{new:'40.00'});
  const config=require('../src/config'),oldToken=config.ingestToken;
  config.ingestToken='synthetic-period-api-token-at-least-32-characters';
  const server=require('../src/server').app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const post=(route,body,token=config.ingestToken)=>fetch(`http://127.0.0.1:${server.address().port}/api/ingest/tally/${route}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  try {
    assert.equal((await post('source-period/preflight',{companyExternalId:'period-co'},'wrong')).status,401);
    assert.equal((await post('source-period/preflight',{companyExternalId:'period-co'})).status,200);
    const stale=await post('source-period/begin',{...m,batchId:'stale-http'});assert.equal(stale.status,409);assert.equal((await stale.json()).code,'PERIOD_CAPTURE_STALE');
    const httpRows=[company,v('new','20260905','50')],httpManifest=make('period-http','2026-09-14T01:00:00Z',httpRows);
    assert.equal((await post('source/begin',httpManifest)).status,400);
    assert.equal((await post('source-period/begin',httpManifest)).status,200);
    assert.equal((await post('source-period/chunk',{batchId:httpManifest.batchId,index:0,records:httpRows})).status,200);
    const response=await post('source-period/complete',{batchId:httpManifest.batchId});assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.reportingStatus,'validated');assert.ok(result.reportingBatchId);assert.equal(result.coverageStatus,'partial');
    assert.deepEqual(await amounts(),{new:'50.00'});
  } finally {config.ingestToken=oldToken;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

