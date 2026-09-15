const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const archive=require('../src/sourceArchive');
const db=require('../src/db');
after(()=>db.close());
const node=(tag,value)=>({tag,attributes:{},content:[value]});
const company={collection:'COMPANY',ordinal:0,sourceId:'replace-co',payload:{tag:'COMPANY',attributes:{NAME:'Replace Co'},content:[node('GUID','replace-co')]}};
const v=(guid,date,amount='10',ordinal=0)=>({collection:'VOUCHER',ordinal,sourceId:guid,payload:{tag:'VOUCHER',attributes:{},content:[node('GUID',guid),node('DATE',date),node('VOUCHERTYPENAME','Sales'),node('VOUCHERNUMBER',guid),node('AMOUNT',amount)]}});
const make=(id,day,records,from='2026-09-01',to='2026-09-30')=>({batchId:id,capturedAt:`2026-09-${day}T00:00:00Z`,company:{externalId:'replace-co',name:'Replace Co'},schemaVersion:1,profile:'company-business-v1',periodMode:'replace',scope:{kind:'period',from,to},chunkCount:1,recordCount:records.length,consistency:'stable',collections:archive.COLLECTIONS.map(name=>({name,status:'success',count:records.filter(r=>r.collection===name).length}))});
test('replacement protocol is explicit and cannot be silently accepted by legacy period route',()=>{
  const m=make('protocol','10',[company]);
  assert.throws(()=>archive.manifest(m,'period'),/replacement|mode/i);
  assert.equal(archive.manifest(m,'period-replace').periodMode,'replace');
});
test('first period import, scoped deletion, out-of-period preservation, empty replacement and manual entry isolation',{skip:process.env.DB_NAME!=='enterprise_dashboard_test'},async()=>{
  await db.migrate();
  await db.query('TRUNCATE tally_source_uploads,tally_source_snapshots,tally_ingestions,"Vouchers","Projects","Ledgers","Companies","SyncLog" RESTART IDENTITY CASCADE');
  const unpack=require('../src/sourceUnpack');
  const upload=async(m,rows)=>{await archive.begin(m,'period-replace');await archive.chunk({batchId:m.batchId,index:0,records:rows},'period-replace');const r=await archive.complete({batchId:m.batchId},'period-replace');await unpack.unpackBatch(r.reportingBatchId);return r;};
  const first=await upload(make('replace-first','10',[company,v('remove','20260902')]),[company,v('remove','20260902')]);
  const coverage=async()=>(await db.query('SELECT coverage FROM finance_snapshots')).rows[0].coverage.history;
  assert.deepEqual(await coverage(),{kind:'periods',periods:[{from:'2026-09-01',to:'2026-09-30'}]});
  const id=(await db.query('SELECT "CompanyID" FROM "Companies" WHERE "ExternalID"=\'replace-co\'')).rows[0].CompanyID;
  await db.query(`INSERT INTO "Vouchers"("CompanyID","VoucherDate","VoucherType","Amount","VoucherNumber","Source") VALUES($1,'2026-09-02','Sales',123,'manual','manual')`,[id]);
  const august=[company,v('outside','20260815','20')];await upload(make('replace-aug','11',august,'2026-08-01','2026-08-31'),august);
  const sep=[company,v('new','20260903','30')];await upload(make('replace-sep','12',sep),sep);
  const rows=async()=>(await db.query('SELECT "VoucherNumber" AS number FROM "Vouchers" ORDER BY 1')).rows.map(r=>r.number);
  assert.deepEqual(await rows(),['manual','new','outside']);
  await upload(make('replace-empty','13',[company]),[company]);
  assert.deepEqual(await rows(),['manual','outside']);
  const broken=make('replace-bad','14',[company,v('bad','20260901','not-money')]);
  await archive.begin(broken,'period-replace');await archive.chunk({batchId:broken.batchId,index:0,records:[company,v('bad','20260901','not-money')]},'period-replace');
  const receipt=await archive.complete({batchId:broken.batchId},'period-replace');await assert.rejects(()=>unpack.unpackBatch(receipt.reportingBatchId),/validation/i);assert.deepEqual(await rows(),['manual','outside']);
  const stage=async(m,records)=>{await archive.begin(m,'period-replace');await archive.chunk({batchId:m.batchId,index:0,records},'period-replace');return archive.complete({batchId:m.batchId},'period-replace');};
  const ar=[company,v('race-a','20260905')],br=[company,v('race-b','20260906')];
  const a=await stage({...make('race-a','14',ar),capturedAt:'2026-09-14T01:00:00Z'},ar);
  const b=await stage({...make('race-b','14',br),capturedAt:'2026-09-14T02:00:00Z'},br);
  await unpack.unpackBatch(a.reportingBatchId);
  await assert.rejects(()=>unpack.unpackBatch(b.reportingBatchId),/Finance changed/);
  assert.deepEqual(await rows(),['manual','outside','race-a']);
  await upload({...make('retry-after-failure','14',br),capturedAt:'2026-09-14T03:00:00Z'},br);
  assert.deepEqual(await rows(),['manual','outside','race-b']);
  const full={...make('replacement-full','14',[company]),capturedAt:'2026-09-14T04:00:00Z'};delete full.scope;delete full.periodMode;
  await archive.begin(full);await archive.chunk({batchId:full.batchId,index:0,records:[company]});await archive.complete({batchId:full.batchId});await unpack.unpackBatch(full.batchId);
  assert.deepEqual(await rows(),['manual']);assert.deepEqual(await coverage(),{kind:'full'});
  assert.ok(first.reportingBatchId);
});

test('first replacement preserves legacy imported rows outside the period without a source baseline',{skip:process.env.DB_NAME!=='enterprise_dashboard_test'},async()=>{
  await db.query('TRUNCATE tally_source_uploads,tally_source_snapshots,tally_ingestions,"Vouchers","Projects","Ledgers","Companies","SyncLog" RESTART IDENTITY CASCADE');
  await require('../src/ingest').ingestSnapshot({batchId:'legacy-before-period',capturedAt:'2026-09-09T00:00:00Z',fullSnapshot:true,company:{externalId:'replace-co',name:'Replace Co'},ledgers:[],vouchers:[{date:'2026-07-01',type:'Sales',amount:'10',number:'legacy-july'},{date:'2026-09-01',type:'Sales',amount:'20',number:'legacy-september'}]});
  const m=make('legacy-period','10',[company]);await archive.begin(m,'period-replace');await archive.chunk({batchId:m.batchId,index:0,records:[company]},'period-replace');
  const r=await archive.complete({batchId:m.batchId},'period-replace');await require('../src/sourceUnpack').unpackBatch(r.reportingBatchId);
  assert.deepEqual((await db.query('SELECT "VoucherNumber" FROM "Vouchers"')).rows.map(r=>r.VoucherNumber),['legacy-july']);
  const config=require('../src/config'),saved=config.ingestToken;config.ingestToken='synthetic-period-replacement-token-123456789';
  const server=require('../src/server').app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {
    const url=`http://127.0.0.1:${server.address().port}/api/ingest/tally/source-period-replace/preflight`;
    const options={method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.ingestToken}`},body:JSON.stringify({companyExternalId:'never-imported'})};
    const response=await fetch(url,options);assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,companyExternalId:'never-imported',baselineBatchId:null,periodMode:'replace'});
    assert.equal((await fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer wrong'}})).status,401);
  } finally {config.ingestToken=saved;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
