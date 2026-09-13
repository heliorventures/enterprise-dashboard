const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const source=require('../source-export');
const {run}=require('../agent');
const {deliver}=require('../outbox');
const envelope=records=>`<ENVELOPE><HEADER><VERSION><COMPANY>1</COMPANY></VERSION><STATUS>1</STATUS></HEADER><BODY><DATA><COLLECTION>${records}</COLLECTION></DATA></BODY></ENVELOPE>`;
const company='<COMPANY NAME="Source Company"><NAME TYPE="String">Source Company</NAME><GUID>source-guid</GUID></COMPANY>';
const voucher='<VOUCHER><GUID>v-guid</GUID><DATE TYPE="Date">not-a-date</DATE><AMOUNT TYPE="Amount">USD 1,23,456.789 Cr</AMOUNT><ISCANCELLED>Yes</ISCANCELLED><ISOPTIONAL>Yes</ISOPTIONAL><ALLLEDGERENTRIES.LIST><LEDGERNAME>A</LEDGERNAME><AMOUNT></AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>A</LEDGERNAME><AMOUNT></AMOUNT></ALLLEDGERENTRIES.LIST><UDF:EXTRA ISLIST="Yes">  unchanged &amp; spaced  </UDF:EXTRA></VOUCHER>';
function parse(collection,xml,step=1) {
  const rows=[],parser=source.parser(collection,row=>rows.push(row));
  for(let i=0;i<xml.length;i+=step) parser.write(xml.slice(i,i+step));
  parser.close();return rows;
}
test('source JSON keeps exact decoded text, attributes, nested/repeated fields and unsupported business values',()=>{
  const rows=parse('VOUCHER',envelope(voucher));
  assert.deepEqual(rows,parse('VOUCHER',envelope(voucher),10000));
  assert.equal(rows.length,1);
  assert.equal(source.field(rows[0],'AMOUNT'),'USD 1,23,456.789 Cr');
  assert.equal(source.field(rows[0],'DATE'),'not-a-date');
  assert.equal(source.field(rows[0],'UDF:EXTRA'),'  unchanged & spaced  ');
  assert.equal(rows[0].content.filter(n=>n.tag==='ALLLEDGERENTRIES.LIST').length,2);
  assert.equal(source.field(rows[0],'ISCANCELLED'),'Yes');
  assert.equal(source.field(rows[0],'ISOPTIONAL'),'Yes');
  assert.deepEqual(parse('LEDGER',envelope('<LEDGER><CLOSINGBALANCE TYPE="Amount"/></LEDGER>'))[0].content[0],
    {tag:'CLOSINGBALANCE',attributes:{TYPE:'Amount'},content:[]});
});
test('source parser only accepts complete collection transfers without interpreting business ERROR/STATUS fields',()=>{
  assert.equal(parse('VOUCHER',envelope('<VOUCHER><STATUS>0</STATUS><ERROR>business field</ERROR></VOUCHER>')).length,1);
  assert.throws(()=>parse('VOUCHER',envelope(voucher).slice(0,-5)),/valid XML/);
  assert.throws(()=>parse('VOUCHER','<ENVELOPE><HEADER><STATUS>0</STATUS></HEADER><BODY><DATA><COLLECTION/></DATA></BODY></ENVELOPE>'),/export error/);
  assert.throws(()=>parse('VOUCHER',envelope('<LEDGER/>')),/Unexpected record/);
  assert.throws(()=>parse('VOUCHER','<!DOCTYPE ENVELOPE><ENVELOPE/>'),/DTD/);
});
test('source requests fetch broad nested data with explicit company context for the entire catalog',()=>{
  assert.equal(Object.keys(source.CATALOG).length,13);
  for(const c of Object.keys(source.CATALOG)) {
    const request=source.request(c,'A & B');
    assert.ok(request.includes(`<FETCH>${source.fetchList(c)}</FETCH>`));
    assert.ok(request.includes('<SVCURRENTCOMPANY>A &amp; B</SVCURRENTCOMPANY>'));
  }
  const voucherRequest=source.request('VOUCHER','A & B');
  assert.ok(voucherRequest.includes('<NATIVEMETHOD>Amount</NATIVEMETHOD>'));
  assert.ok(source.fetchList('VOUCHER').includes('Amount'));
  assert.ok(!source.fetchList('VOUCHER').startsWith('*'));
});
test('default source import captures empty/unrecognized values without dashboard conversions and records failed coverage',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-source-test-'));
  const originalFetch=global.fetch,originalLog=console.log;
  const logs=[];
  console.log=line=>logs.push(JSON.parse(line));
  let failStock=true;
  global.fetch=async(url,options)=>{
    assert.equal(url,'http://localhost:9000');
    if(options.body.includes('<ID>FinanceAgent</ID>'))return new Response(envelope(company));
    const c=Object.keys(source.CATALOG).find(k=>options.body.includes(`<TYPE>${source.CATALOG[k]}</TYPE>`));
    assert.ok(c);
    if(c==='STOCKITEM'&&failStock) return new Response(envelope('<STOCKITEM NAME="Incomplete"/>').slice(0,-6));
    return new Response(envelope(c==='COMPANY'?company:c==='VOUCHER'?voucher:c==='LEDGER'?'<LEDGER NAME="Empty"><CLOSINGBALANCE/></LEDGER>':''));
  };
  try {
    const configFile=path.join(directory,'config.json');
    fs.writeFileSync(configFile,JSON.stringify({tallyUrl:'http://localhost:9000',apiUrl:'https://example.invalid',requestTimeoutMs:1000}));
    assert.equal(await run(configFile,true),1);
    const preview=logs.find(row=>row.event==='source_preview');assert.equal(preview.coverageStatus,'partial');
    const m=JSON.parse(fs.readFileSync(path.join(preview.directory,'manifest.json'),'utf8'));
    assert.equal(m.recordCount,3);
    assert.deepEqual(m.collections.find(c=>c.name==='STOCKITEM'),{name:'STOCKITEM',status:'failed',count:0});
    const records=JSON.parse(fs.readFileSync(path.join(preview.directory,'0.json'),'utf8')).records;
    assert.equal(source.field(records.find(r=>r.collection==='VOUCHER').payload,'AMOUNT'),'USD 1,23,456.789 Cr');
    assert.equal(source.field(records.find(r=>r.collection==='LEDGER').payload,'CLOSINGBALANCE'),'');
    assert.equal(records.some(r=>r.collection==='STOCKITEM'),false);
    logs.length=0;failStock=false;
    assert.equal(await run(configFile,true),0);
    assert.equal(logs.find(row=>row.event==='source_preview').coverageStatus,'complete');
  } finally {global.fetch=originalFetch;console.log=originalLog;fs.rmSync(directory,{recursive:true});}
});
test('source delivery uses its own routes and retries the exact persisted payload',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-source-delivery-'));
  try {
    const records=[{collection:'VOUCHER',ordinal:0,sourceId:null,payload:parse('VOUCHER',envelope(voucher))[0]}];
    fs.writeFileSync(path.join(directory,'0.json'),JSON.stringify({records}));
    const m={batchId:'source-delivery',profile:'company-business-v1',company:{name:'Company'},chunkCount:1,recordCount:1,consistency:'unavailable',collections:[{status:'success'}]};
    const payloads=[];let first=true;
    const result=await deliver({apiUrl:'https://example.invalid',requestTimeoutMs:1000},'token',directory,m,()=>{},async(url,options)=>{
      assert.ok(url.includes('/api/ingest/tally/source/'));
      if(url.endsWith('/chunk')) {payloads.push(options.body);if(first){first=false;throw new Error('connection lost');}}
      return {status:200,json:async()=>({ok:true,batchId:m.batchId,recordCount:1,coverageStatus:'complete'})};
    },async()=>{});
    assert.equal(result.retries,1);assert.equal(payloads[0],payloads[1]);assert.equal(result.coverageStatus,'complete');
  } finally {fs.rmSync(directory,{recursive:true});}
});

test('source outbox resumes before Tally access and legacy pending batches remain untouched',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-source-resume-'));
  const originalFetch=global.fetch,originalLog=console.log;
  const events=[];let offline=false,apiReady=false,manifest;
  console.log=line=>events.push(JSON.parse(line));
  global.fetch=async(url,options)=>{
    if(String(url).startsWith('https://example.invalid')) {
      if(!apiReady)return {status:401};
      const body=JSON.parse(options.body);
      if(url.endsWith('/begin'))manifest=body;
      return {status:200,json:async()=>({ok:true,batchId:body.batchId,recordCount:manifest.recordCount,coverageStatus:'complete'})};
    }
    if(offline)throw new Error('Tally offline');
    if(options.body.includes('<ID>FinanceAgent</ID>')||options.body.includes('<TYPE>Company</TYPE>'))return new Response(envelope(company));
    return new Response(envelope(''));
  };
  try {
    fs.writeFileSync(path.join(directory,'config.json'),JSON.stringify({tallyUrl:'http://localhost:9000',apiUrl:'https://example.invalid',requestTimeoutMs:1000}));
    fs.writeFileSync(path.join(directory,'token.txt'),'test-source-token-at-least-32-characters');
    const legacy=path.join(directory,'state','outbox');fs.mkdirSync(legacy,{recursive:true});fs.writeFileSync(path.join(legacy,'preserved'),'legacy');
    assert.equal(await run(path.join(directory,'config.json')),1);
    const outbox=path.join(directory,'state','source-outbox');
    assert.equal(fs.readdirSync(outbox).length,1);
    const saved=JSON.parse(fs.readFileSync(path.join(outbox,fs.readdirSync(outbox)[0],'manifest.json'),'utf8'));
    offline=true;apiReady=true;events.length=0;
    assert.equal(await run(path.join(directory,'config.json')),1); // New discovery fails; pending delivery still succeeds.
    assert.equal(fs.readdirSync(outbox).length,0);
    assert.equal(manifest.batchId,saved.batchId);
    assert.equal(events.find(e=>e.event==='source_snapshot_saved').coverageStatus,'complete');
    assert.equal(fs.readFileSync(path.join(legacy,'preserved'),'utf8'),'legacy');
  } finally {global.fetch=originalFetch;console.log=originalLog;fs.rmSync(directory,{recursive:true});}
});
