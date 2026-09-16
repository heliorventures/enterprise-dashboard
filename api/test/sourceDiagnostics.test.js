const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const db=require('../src/db');
after(()=>db.close());
test('diagnostic validation bounds inputs, preserves locations and removes credentials',()=>{
  const {validateEvent}=require('../src/sourceDiagnostics');
  const event={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',occurredAt:new Date().toISOString(),event:'source_collection_failed',message:'request https://user:password@localhost:9000/xml?token=secret failed Authorization: Bearer abcdef',details:{xmlPath:'/ENVELOPE/GROUP',xmlLine:42,errorCodes:['XML_TRUNCATED'],requestId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}};
  const result=validateEvent(event);
  assert.equal(result.details.xmlLine,42);
  assert.ok(!JSON.stringify(result).includes('password'));assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('abcdef'));
  assert.throws(()=>validateEvent({...event,message:'x'.repeat(4000)}),/Invalid/);
  for(const message of ['Authorization: Basic ZHVtbXk6ZHVtbXk=', '{"password":"dummy-secret"}', '<TOKEN>dummy-secret</TOKEN>']){
    const redacted=validateEvent({...event,message}).message;
    assert.ok(!redacted.includes('dummy-secret'));assert.ok(!redacted.includes('ZHVtbXk6ZHVtbXk='));
  }
});
test('diagnostics are durable, retry-safe, conflict checked and readable even without a snapshot',{skip:process.env.DB_NAME!=='enterprise_dashboard_test'},async()=>{
  const api=require('../src/sourceDiagnostics');
  await db.migrate();await db.migrate();
  const {randomUUID}=require('node:crypto');
  const event={id:randomUUID(),runId:randomUUID(),batchId:'failed-before-archive',occurredAt:new Date().toISOString(),event:'source_collection_failed',company:{name:'Synthetic diagnostics only',externalId:'diagnostic-fixture'},collection:'VOUCHER',message:'Tally rejected export',details:{tallyMessage:'Unknown collection FinanceSourceArchive',from:'2026-09-01',to:'2026-09-07',xmlPath:'/ENVELOPE/LINEERROR',errorCodes:['TALLY_SOURCE_ERROR']}};
  try {
    assert.deepEqual((await api.save({events:[event]})).ids,[event.id]);
    await api.save({events:[event]});
    assert.equal((await db.query('SELECT count(*)::int n FROM tally_diagnostics WHERE id=$1',[event.id])).rows[0].n,1);
    await assert.rejects(()=>api.save({events:[{...event,message:'changed retry'}]}),/conflict/);
    const page=await api.list({batch:event.batchId});
    assert.equal(page.items[0].details.tallyMessage,event.details.tallyMessage);
    const id=await api.recordApiFailure(Object.assign(new Error('row secret should not leak'),{code:'23505',constraint:'source_identity'}),{operation:'full/chunk',body:{batchId:'diagnostic-server-test',index:3}});
    const saved=(await api.list({batch:'diagnostic-server-test'})).items.find(e=>e.id===id);
    assert.equal(saved.details.constraint,'source_identity');assert.equal(saved.details.chunkIndex,3);assert.ok(!saved.message.includes('secret'));
  } finally {await db.query("DELETE FROM tally_diagnostics WHERE batch_id IN ('failed-before-archive','diagnostic-server-test')");}
});
test('a stopped manual export saves exact diagnostics via authenticated HTTP without a source batch',{skip:process.env.DB_NAME!=='enterprise_dashboard_test'},async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const config=require('../src/config');config.ingestToken='diagnostics-integration-test-token-000000';
  const {app}=require('../src/server');
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`,original=global.fetch;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-diagnostic-http-'));
  const envelope=rows=>`<ENVELOPE><BODY><DATA><COLLECTION>${rows}</COLLECTION></DATA></BODY></ENVELOPE>`;
  const company='<COMPANY NAME="Diagnostic HTTP"><NAME>Diagnostic HTTP</NAME><GUID>diagnostic-http</GUID></COMPANY>';
  let groups=0;
  try {
    const denied=await original(base+'/api/ingest/tally/diagnostics',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"events":[]}'});
    assert.equal(denied.status,401);
    const malformed=await original(base+'/api/ingest/tally/source/begin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.ingestToken}`},body:'{invalid'});
    assert.equal(malformed.status,400);assert.ok((await malformed.json()).diagnosticId);
    global.fetch=async(url,options)=>{
      if(String(url).startsWith('https://diagnostic-test.invalid'))return original(String(url).replace('https://diagnostic-test.invalid',base),options);
      if(options.body.includes('<TYPE>Group</TYPE>')){groups++;return new Response('<ENVELOPE><BODY><DATA><LINEERROR>Collection disabled by Tally</LINEERROR></DATA></BODY></ENVELOPE>');}
      return new Response(envelope(company));
    };
    const run=require('../../deploy/tally-agent/source-agent').run;
    assert.equal(await run(path.join(dir,'unused.json'),false,{config:{apiUrl:'https://diagnostic-test.invalid',tallyUrl:'http://localhost:9000',stopOnFailure:true},token:config.ingestToken,selectedCompanyIds:['diagnostic-http'],quiet:true}),1);
    assert.equal(groups,1);
    const saved=(await db.query("SELECT * FROM tally_diagnostics WHERE company_external_id='diagnostic-http' AND event='tally_export_failed'")).rows;
    assert.equal(saved.length,1);assert.match(saved[0].details.tallyMessage,/Collection disabled/);
    assert.equal(saved[0].collection,'GROUP');assert.ok(saved[0].batch_id);assert.ok(saved[0].exporter.buildHash);
    assert.equal((await db.query('SELECT count(*)::int n FROM tally_source_snapshots WHERE batch_id=$1',[saved[0].batch_id])).rows[0].n,0);
    assert.equal(fs.readdirSync(path.join(dir,'state','diagnostics-outbox')).length,0);
  } finally {
    global.fetch=original;await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true});
    await db.query("DELETE FROM tally_diagnostics WHERE company_external_id='diagnostic-http'");
  }
});
