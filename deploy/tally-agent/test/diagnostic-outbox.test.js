const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('diagnostics survive API outage and retry the identical event without exporting again',async()=>{
  const {diagnosticQueue}=require('../diagnostic-outbox');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-diagnostics-'));
  const config={apiUrl:'https://example.invalid',requestTimeoutMs:1000};
  const event={event:'source_collection_failed',runId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',at:new Date().toISOString(),collection:'LEDGER',error:'socket closed',diagnostic:{errorCodes:['ECONNRESET'],stage:'read'}};
  try {
    let saved,requests=0;
    const queue=diagnosticQueue(dir,config,()=>{});
    queue.add(event);
    await queue.flush('x'.repeat(40),async()=>{requests++;throw new Error('offline');});
    assert.equal(requests,1);assert.equal(fs.readdirSync(dir).length,1);
    const bytes=fs.readFileSync(path.join(dir,fs.readdirSync(dir)[0]),'utf8');
    await queue.flush('x'.repeat(40),async(url,options)=>{
      saved=JSON.parse(options.body).events[0];
      assert.deepEqual(saved,JSON.parse(bytes));
      return new Response(JSON.stringify({ok:true,ids:[saved.id]}));
    });
    assert.equal(fs.readdirSync(dir).length,0);assert.equal(saved.collection,'LEDGER');
  } finally {fs.rmSync(dir,{recursive:true});}
});
test('one rejected diagnostic does not prevent delivery of valid events',async()=>{
  const {diagnosticQueue}=require('../diagnostic-outbox');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-diagnostics-rejected-'));
  try {
    const queue=diagnosticQueue(dir,{apiUrl:'https://example.invalid',requestTimeoutMs:1000},()=>{});
    queue.add({event:'run_failure',error:'bad'});queue.add({event:'run_failure',error:'good'});
    await queue.flush('x'.repeat(40),async(_url,options)=>{
      const events=JSON.parse(options.body).events;
      return events.some(e=>e.message==='bad')?new Response('{}',{status:400}):new Response(JSON.stringify({ok:true,ids:events.map(e=>e.id)}));
    });
    assert.equal(fs.readdirSync(dir).filter(f=>f.endsWith('.json')).length,0);
    assert.equal(fs.readdirSync(path.join(dir,'rejected')).length,1);
  } finally {fs.rmSync(dir,{recursive:true});}
});
test('consistency errors retain a valid company identity even when the request has no company name',async()=>{
  const {diagnosticQueue}=require('../diagnostic-outbox');
  const {validateEvent}=require('../../../api/src/sourceDiagnostics');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-diagnostics-company-'));
  try {
    const queue=diagnosticQueue(dir,{apiUrl:'https://example.invalid',requestTimeoutMs:1000},()=>{});
    queue.add({event:'tally_export_failed',companyExternalId:'company-guid',company:null,error:'Consistency check failed'});
    const e=JSON.parse(fs.readFileSync(path.join(dir,fs.readdirSync(dir)[0]),'utf8'));
    assert.equal(validateEvent(e).company.externalId,'company-guid');
  } finally {fs.rmSync(dir,{recursive:true});await require('../../../api/src/db').close();}
});
