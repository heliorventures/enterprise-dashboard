const {test}=require('node:test');
const assert=require('node:assert/strict');
const source=require('../source-export');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const envelope=rows=>`<ENVELOPE><BODY><DATA><COLLECTION>${rows}</COLLECTION></DATA></BODY></ENVELOPE>`;
const ledger=id=>`<LEDGER><MASTERID>${id}</MASTERID><NAME>Ledger ${id}</NAME></LEDGER>`;
const config={tallyUrl:'http://localhost:9000',requestTimeoutMs:1000,ledgerBatchSize:2};

test('canonical XML native-method declarations explicitly export IDs in discovery and detail responses',async t=>{
  const requests=[],records=[];
  t.mock.method(global,'fetch',async(_url,{body})=>{
    requests.push(body);
    // A Ledger object may omit its internal identity from the default XML tree.
    const explicit=body.includes('<NATIVEMETHOD>MasterID</NATIVEMETHOD>');
    return new Response(envelope(explicit?ledger(7):'<LEDGER><NAME>Example</NAME></LEDGER>'));
  });
  await source.extract(config,'LEDGER','Example',row=>records.push(row));
  assert.equal(records.length,1);assert.equal(requests.length,3);
  for(const request of requests)assert.match(request,/<NATIVEMETHOD>MasterID<\/NATIVEMETHOD>/);
  assert.doesNotMatch(requests[0],/<FETCH>|ClosingBalance|OpeningBalance|\*/);
  assert.match(requests[1],/\$MasterID &gt;= 7 AND \$MasterID &lt;= 7/);
  assert.equal(source.field(records[0],'MASTERID'),'7');
});

test('numeric ID padding is interpreted without changing raw records; invalid identities remain coded failures',async t=>{
  t.mock.method(global,'fetch',async()=>new Response(envelope(ledger('  7  '))));
  const rows=[];
  await source.extract(config,'LEDGER','Example',row=>rows.push(row));
  assert.equal(source.field(rows[0],'MASTERID'),'  7  ');
  t.mock.restoreAll();
  for(const value of ['', '1x', '-1', '1.5', '9007199254740993']) {
    t.mock.method(global,'fetch',async()=>new Response(envelope(ledger(value))));
    await assert.rejects(source.extract(config,'LEDGER','Example',()=>{}),error=>{
      assert.equal(error.code,'BATCH_LEDGER_ID_REQUIRED');
      assert.ok(error.exportDiagnostic.errorCodes.includes('BATCH_LEDGER_ID_REQUIRED'));
      assert.doesNotMatch(error.exportDiagnostic.action,/disk space|folder permissions/i);
      return true;
    });
    t.mock.restoreAll();
  }
});
test('repeated MasterID copies are accepted only when they agree after Tally padding',async t=>{
  const repeated=(a,b)=>`<LEDGER><MASTERID>${a}</MASTERID><NAME>Example</NAME><MASTERID>${b}</MASTERID></LEDGER>`;
  t.mock.method(global,'fetch',async()=>new Response(envelope(repeated(' 7','7'))));
  const rows=[];
  await source.extract(config,'LEDGER','Example',row=>rows.push(row));
  assert.equal(rows.length,1);
  t.mock.restoreAll();
  t.mock.method(global,'fetch',async()=>new Response(envelope(repeated('7','8'))));
  await assert.rejects(source.extract(config,'LEDGER','Example',()=>{}),error=>error.code==='BATCH_LEDGER_ID_REQUIRED');
});
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
  assert.match(requests[0],/<NATIVEMETHOD>MasterID<\/NATIVEMETHOD>/);assert.doesNotMatch(requests[0],/<FETCH>|ClosingBalance|OpeningBalance|\*/);
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
  const events=[];
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  t.mock.method(global,'fetch',async(url,{body})=>{
    if(/<TYPE>Company<\/TYPE>/i.test(body))return new Response(envelope('<COMPANY><NAME>Example</NAME><GUID>company-1</GUID></COMPANY>'));
    if(body.includes('<TYPE>Ledger</TYPE>'))return new Response(envelope((!body.includes('<FETCH>')?[1,2]:[1]).map(ledger).join('')));
    return new Response(envelope(''));
  });
  await assert.rejects(require('../source-agent').capture(config,{name:'Example',externalId:'company-1'},directory,event=>events.push(event)),/BATCH_LEDGER_COUNT_MISMATCH/);
  assert.ok(events.find(event=>event.event==='source_collection_failed').diagnostic.errorCodes.includes('BATCH_LEDGER_COUNT_MISMATCH'));
  assert.equal(fs.existsSync(path.join(directory,'manifest.json')),false);
});
