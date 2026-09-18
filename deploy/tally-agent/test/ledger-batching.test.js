const {test}=require('node:test');
const assert=require('node:assert/strict');
const source=require('../source-export');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const envelope=rows=>`<ENVELOPE><BODY><DATA><COLLECTION>${rows}</COLLECTION></DATA></BODY></ENVELOPE>`;
const ledger=id=>`<LEDGER><MASTERID>${id}</MASTERID><NAME>Ledger ${id}</NAME></LEDGER>`;
const config={tallyUrl:'http://localhost:9000',requestTimeoutMs:1000,ledgerBatchSize:2};
test('ledger discovery is lightweight and details are requested in sequential bounded ranges',async t=>{
  const requests=[],records=[];let active=0;
  t.mock.method(global,'fetch',async(url,{body})=>{
    assert.equal(active++,0);requests.push(body);
    const match=body.match(/\$MasterID &gt;= (\d+) AND \$MasterID &lt;= (\d+)/);
    const ids=[1,5,100];const selected=match?ids.filter(id=>id>=+match[1]&&id<=+match[2]):ids;
    active--;return new Response(envelope(selected.map(ledger).join('')));
  });
  await source.extract(config,'LEDGER','Example',row=>records.push(source.field(row,'MASTERID')));
  assert.deepEqual(records,['1','5','100']);assert.equal(requests.length,4);
  assert.match(requests[0],/<FETCH>MasterID<\/FETCH>/);assert.doesNotMatch(requests[0],/NATIVEMETHOD|\*/);
  assert.match(requests[1],/\$MasterID &gt;= 1 AND \$MasterID &lt;= 5/);
  assert.match(requests[2],/\$MasterID &gt;= 100 AND \$MasterID &lt;= 100/);
});
test('ignored filter, duplicate, missing and changed identities fail closed',async t=>{
  for(const detail of [[1,5,100],[1,1],[1],[1,6]]){
    let calls=0;t.mock.method(global,'fetch',async()=>new Response(envelope((++calls===1?[1,5,100]:detail).map(ledger).join(''))));
    await assert.rejects(source.extract(config,'LEDGER','Example',()=>{}),/BATCH_LEDGER_/);t.mock.restoreAll();
  }
  let calls=0;t.mock.method(global,'fetch',async()=>new Response(envelope((++calls===1?[1]:calls===2?[1]:[2]).map(ledger).join(''))));
  await assert.rejects(source.extract(config,'LEDGER','Example',()=>{}),/BATCH_LEDGER_/);
});
test('Stop between ledger batches prevents another request',async t=>{
  const abort=new AbortController();let calls=0;
  t.mock.method(global,'fetch',async()=>{calls++;return new Response(envelope([1,2].map(ledger).join('')));});
  await assert.rejects(source.extract({...config,signal:abort.signal},'LEDGER','Example',()=>abort.abort()),/abort/i);
  assert.equal(calls,2);
});
test('a failed ledger batch cannot produce a publishable capture',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-ledger-batch-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  t.mock.method(global,'fetch',async(url,{body})=>{
    if(/<TYPE>Company<\/TYPE>/i.test(body))return new Response(envelope('<COMPANY><NAME>Example</NAME><GUID>company-1</GUID></COMPANY>'));
    if(body.includes('<TYPE>Ledger</TYPE>'))return new Response(envelope((body.includes('<FETCH>MasterID</FETCH>')?[1,2]:[1]).map(ledger).join('')));
    return new Response(envelope(''));
  });
  await assert.rejects(require('../source-agent').capture(config,{name:'Example',externalId:'company-1'},directory,()=>{}),/BATCH_LEDGER_COUNT_MISMATCH/);
  assert.equal(fs.existsSync(path.join(directory,'manifest.json')),false);
});
