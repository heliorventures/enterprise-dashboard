const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../src/sourceArchive');
const db=require('../src/db');
after(()=>db.close());
const enabled=process.env.DB_NAME==='enterprise_dashboard_test';
const tree={tag:'VOUCHER',attributes:{REMOTEID:'external'},content:[
  {tag:'DATE',attributes:{TYPE:'Date'},content:['not-a-date']},
  {tag:'AMOUNT',attributes:{TYPE:'Amount'},content:['USD 1,23,456.789 Cr']},
  {tag:'CLOSINGBALANCE',attributes:{},content:[]},
  {tag:'ALLOCATIONS.LIST',attributes:{},content:['  exact whitespace  ']},
  {tag:'ALLOCATIONS.LIST',attributes:{},content:['  exact whitespace  ']}]};
const input=(batchId='source-1')=>({batchId,capturedAt:'2026-09-10T00:00:00Z',company:{externalId:'source-guid',name:'Source Company'},
  schemaVersion:1,profile:'company-business-v1',recordCount:2,chunkCount:2,consistency:'unavailable',
  collections:api.COLLECTIONS.map(name=>({name,status:'success',count:['COMPANY','VOUCHER'].includes(name)?1:0}))});
const company={collection:'COMPANY',ordinal:0,sourceId:'source-guid',payload:{tag:'COMPANY',attributes:{NAME:'Source Company'},content:[{tag:'GUID',attributes:{},content:['source-guid']}]}};
const voucher={collection:'VOUCHER',ordinal:0,sourceId:'external',payload:tree};
test('archive protocol checks transfer structure without validating amounts/dates or changing source values',()=>{
  assert.equal(api.manifest(input()).coverageStatus,'complete');
  assert.doesNotThrow(()=>api.validateTree(tree));
  assert.throws(()=>api.manifest({...input(),schemaVersion:2}));
  assert.throws(()=>api.manifest({...input(),collections:[]}));
  assert.throws(()=>api.manifest({...input(),recordCount:3}));
  assert.equal(api.manifest({...input(),consistency:'changed'}).coverageStatus,'partial');
});
test('JSONB source archive is atomic, company-isolated, lossless and retry-safe without dashboard writes',{skip:!enabled},async()=>{
  await db.migrate();await db.migrate();
  const m=input();
  await api.begin(m);
  const c0={batchId:m.batchId,index:0,records:[company]},c1={batchId:m.batchId,index:1,records:[voucher]};
  await api.chunk(c0);
  await assert.rejects(()=>api.complete({batchId:m.batchId}),/incomplete/);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM tally_source_snapshots')).rows[0].count,0);
  await api.chunk(c1);
  assert.equal((await api.chunk(c1)).duplicate,true);
  const result=await api.complete({batchId:m.batchId});
  assert.equal(result.recordCount,2);assert.equal(result.coverageStatus,'complete');
  assert.equal((await api.complete({batchId:m.batchId})).duplicate,true);
  assert.equal((await api.begin(m)).completed,true); // JSONB key-order independence.
  assert.equal((await api.chunk(c1)).duplicate,true);
  await assert.rejects(()=>api.chunk({...c1,records:[{...voucher,sourceId:'changed'}]}),/conflict/);
  await assert.rejects(()=>api.begin({...m,company:{...m.company,name:'Changed'}}),/conflict/);
  const saved=(await db.query("SELECT payload FROM tally_source_records WHERE batch_id=$1 AND collection='VOUCHER'",[m.batchId])).rows[0].payload;
  assert.deepEqual(saved,tree);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM "Companies"')).rows[0].count,0);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM "Vouchers"')).rows[0].count,0);
  const partial={...input('source-partial'),capturedAt:'2026-09-11T00:00:00Z',recordCount:1,chunkCount:1,
    collections:input().collections.map(c=>c.name==='VOUCHER'?{...c,status:'failed',count:0}:c)};
  await api.begin(partial);await api.chunk({batchId:partial.batchId,index:0,records:[company]});
  assert.equal((await api.complete({batchId:partial.batchId})).coverageStatus,'partial');
  assert.equal((await db.query('SELECT batch_id FROM tally_source_latest')).rows[0].batch_id,m.batchId);
  const bad={...input('source-duplicate'),recordCount:3,collections:input().collections.map(c=>c.name==='VOUCHER'?{...c,count:2}:c)};
  await api.begin(bad);await api.chunk({batchId:bad.batchId,index:0,records:[company,voucher]});
  await api.chunk({batchId:bad.batchId,index:1,records:[voucher]});
  await assert.rejects(()=>api.complete({batchId:bad.batchId}),e=>e.code==='23505');
  assert.equal((await db.query('SELECT 1 FROM tally_source_snapshots WHERE batch_id=$1',[bad.batchId])).rowCount,0);
  const missing={...input('source-missing'),recordCount:3,collections:bad.collections};
  await api.begin(missing);await api.chunk({batchId:missing.batchId,index:0,records:[company]});
  await api.chunk({batchId:missing.batchId,index:1,records:[voucher]});
  await assert.rejects(()=>api.complete({batchId:missing.batchId}),/counts/);
  const other={...input('source-other'),company:{externalId:'other-guid',name:'Other Company'}};
  await api.begin(other);await api.chunk({batchId:other.batchId,index:0,records:[{...company,sourceId:'other-guid',payload:{...company.payload,content:[{tag:'GUID',attributes:{},content:['other-guid']}]}}]});
  await api.chunk({batchId:other.batchId,index:1,records:[voucher]});await api.complete({batchId:other.batchId});
  assert.equal((await db.query('SELECT * FROM tally_source_latest')).rowCount,2);
  const old={...input('source-old'),capturedAt:'2026-09-01T00:00:00Z'};
  await api.begin(old);await api.chunk({batchId:old.batchId,index:0,records:[company]});await api.chunk({batchId:old.batchId,index:1,records:[voucher]});await api.complete({batchId:old.batchId});
  assert.equal((await db.query('SELECT batch_id FROM tally_source_latest WHERE company_external_id=$1',['source-guid'])).rows[0].batch_id,m.batchId);
  const mismatch=input('source-wrong-company');
  await api.begin(mismatch);await api.chunk({batchId:mismatch.batchId,index:0,records:[{...company,payload:{...company.payload,content:[{tag:'GUID',attributes:{},content:['wrong-guid']}]}}]});
  await api.chunk({batchId:mismatch.batchId,index:1,records:[voucher]});
  await assert.rejects(()=>api.complete({batchId:mismatch.batchId}),/transfer identity/);
  await db.query('TRUNCATE tally_source_uploads,tally_source_snapshots CASCADE');
});

test('source agent transfers raw values through authenticated HTTP into PostgreSQL',{skip:!enabled},async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {run}=require('../../deploy/tally-agent/agent');
  const {CATALOG,field}=require('../../deploy/tally-agent/source-export');
  const config=require('../src/config');
  const oldToken=config.ingestToken;config.ingestToken='local-source-test-token-at-least-32-characters';
  const {app}=require('../src/server');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'source-http-test-'));
  const originalFetch=global.fetch,originalLog=console.log;
  const events=[];console.log=line=>events.push(JSON.parse(line));
  const envelope=xml=>`<ENVELOPE><BODY><DATA><COLLECTION>${xml}</COLLECTION></DATA></BODY></ENVELOPE>`;
  global.fetch=async(url,options)=>{
    if(String(url).startsWith('https://source-test.invalid')) return originalFetch(String(url).replace('https://source-test.invalid',`http://127.0.0.1:${server.address().port}`),options);
    assert.equal(url,'http://localhost:9000');
    if(options.body.includes('<ID>FinanceAgent</ID>')||options.body.includes('<TYPE>Company</TYPE>'))return new Response(envelope('<COMPANY NAME="Raw"><GUID>raw-guid</GUID></COMPANY>'));
    const c=Object.keys(CATALOG).find(k=>options.body.includes(`<TYPE>${CATALOG[k]}</TYPE>`));
    return new Response(envelope(c==='LEDGER'?'<LEDGER NAME="L"><CLOSINGBALANCE/></LEDGER>':c==='VOUCHER'?'<VOUCHER><DATE>uninterpreted-date</DATE><AMOUNT>USD 1,23,456.789 Cr</AMOUNT><ISCANCELLED>Yes</ISCANCELLED></VOUCHER>':''));
  };
  try {
    const configFile=path.join(directory,'config.json');
    fs.writeFileSync(configFile,JSON.stringify({tallyUrl:'http://localhost:9000',apiUrl:'https://source-test.invalid',requestTimeoutMs:1000}));
    fs.writeFileSync(path.join(directory,'token.txt'),config.ingestToken);
    assert.equal(await run(configFile),0);
    assert.equal(fs.readdirSync(path.join(directory,'state','source-outbox')).length,0);
    assert.equal(events.find(e=>e.event==='source_snapshot_saved').coverageStatus,'complete');
    const result=await db.query("SELECT r.collection,r.payload FROM tally_source_records r JOIN tally_source_latest s USING(batch_id) WHERE s.company_external_id='raw-guid'");
    assert.equal(result.rowCount,3);
    assert.equal(field(result.rows.find(r=>r.collection==='LEDGER').payload,'CLOSINGBALANCE'),'');
    assert.equal(field(result.rows.find(r=>r.collection==='VOUCHER').payload,'AMOUNT'),'USD 1,23,456.789 Cr');
    assert.equal((await db.query('SELECT 1 FROM "Vouchers"')).rowCount,0);
  } finally {
    global.fetch=originalFetch;console.log=originalLog;config.ingestToken=oldToken;
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(directory,{recursive:true});
    await db.query('TRUNCATE tally_source_uploads,tally_source_snapshots CASCADE');
  }
});
