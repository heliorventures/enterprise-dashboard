const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const config=require('../src/config');
const {pendingSummary,validateSelection}=require('../src/state');
const {publicEvent,explainError,failureKind}=require('../src/events');

test('failures split into temporary connection/availability problems and data or application problems',()=>{
  for(const event of [{diagnostic:{errorCodes:['TypeError','ECONNRESET']}},{diagnostic:{operation:'chunk',httpStatus:503}},{event:'run_failure',error:'fetch failed'},
    {event:'run_failure',error:'API capabilities: HTTP 502'},{event:'run_failure',error:'A selected company is no longer available. Load it in Tally and check again.'}])
    assert.equal(failureKind(event),'temporary');
  for(const event of [{diagnostic:{errorCodes:['BATCH_LEDGER_ID_REQUIRED']}},{diagnostic:{operation:'chunk',httpStatus:409}},{event:'run_failure',error:'Finance processing was not validated.'},{}])
    assert.equal(failureKind(event),'data');
  const published=publicEvent({event:'source_upload_failed',error:'fetch failed',diagnostic:{errorCodes:['ECONNRESET']}});
  assert.equal(published.failureKind,'temporary');
  assert.equal(publicEvent(published).failureKind,'temporary');
});

test('ledger identity errors stay specific in exported diagnostics without raw accounting values',()=>{
  const event=publicEvent({event:'tally_export_failed',errorCodes:['BATCH_LEDGER_ID_REQUIRED','Error'],
    rawRecord:{name:'PRIVATE LEDGER'},httpStatus:200,recordsReceived:1});
  assert.ok(event.errorCodes.includes('BATCH_LEDGER_ID_REQUIRED'));
  assert.match(event.message,/ledger identifier/i);
  assert.ok(!JSON.stringify(event).includes('PRIVATE'));
});

test('capture capacity and UTF-8 failures receive specific messages without exposing source text',()=>{
  assert.match(explainError({error:'Source snapshot exceeds capture limits',diagnostic:{errorCodes:['SOURCE_SNAPSHOT_LIMIT']}}),/size|limit/i);
  assert.match(explainError({diagnostic:{errorCodes:['ERR_ENCODING_INVALID_ENCODED_DATA']}}),/UTF-8|encoding/i);
  const event=publicEvent({event:'source_capture_failed',error:'private narration',diagnostic:{errorCodes:['SOURCE_SNAPSHOT_LIMIT'],limitBytes:1024,actualBytes:1025}});
  assert.ok(!JSON.stringify(event).includes('private narration'));
  assert.doesNotMatch(event.message,/network/i);
  assert.match(explainError({diagnostic:{errorCodes:['SOURCE_STAGING_LIMIT']}}),/staging is full/i);
  const encoding=publicEvent({event:'tally_export_failed',invalidByteOffset:93863932,invalidByteValue:255,
    utf8FailureReason:'invalid_leading_byte',rawResponse:'PRIVATE SOURCE',errorCodes:['ERR_ENCODING_INVALID_ENCODED_DATA']});
  assert.equal(encoding.invalidByteOffset,93863932);
  assert.equal(encoding.invalidByteValue,255);
  assert.equal(encoding.utf8FailureReason,'invalid_leading_byte');
  assert.ok(!JSON.stringify(encoding).includes('PRIVATE'));
});

test('build config fails closed on absent tokens, insecure API URLs and remote Tally',()=>{
  const valid={FINANCE_API_URL:'https://finance.example',TALLY_INGEST_TOKEN:'a'.repeat(40),TALLY_URL:'http://localhost:9000'};
  assert.equal(config.fromEnvironment(valid).apiUrl,'https://finance.example');
  for(const change of [{TALLY_INGEST_TOKEN:''},{TALLY_INGEST_TOKEN:'a'.repeat(40)+'\nsecret'},{FINANCE_API_URL:'http://finance.example'},
    {FINANCE_API_URL:'https://finance.example/?token=secret'},{TALLY_URL:'http://remote-host:9000'}, {TALLY_REQUEST_TIMEOUT_MS:'zero'}]) {
    assert.throws(()=>config.fromEnvironment({...valid,...change}));
  }
});

test('selection rejects forged and duplicate GUIDs and never expands an empty selection',()=>{
  const companies=[{externalId:'a'},{externalId:'b'}];
  assert.deepEqual(validateSelection(['b'],companies),['b']);
  for(const ids of [[],['c'],['a','a'],null,'a'])assert.throws(()=>validateSelection(ids,companies));
});

test('pending summaries ignore unfinished captures and flag damaged ready manifests without deleting data',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-desktop-state-'));
  try {
    const box=path.join(dir,'source-outbox');fs.mkdirSync(box);
    for(const id of ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccccc'])fs.mkdirSync(path.join(box,id));
    fs.writeFileSync(path.join(box,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','manifest.json'),JSON.stringify({company:{name:'Alpha',externalId:'a'},recordCount:17}));
    fs.writeFileSync(path.join(box,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','manifest.json'),'{broken');
    const result=pendingSummary(dir);
    assert.equal(result.count,1);assert.equal(result.damaged,1);assert.equal(result.companies[0].externalId,'a');
    assert.equal(fs.readdirSync(box).length,3);
  } finally {fs.rmSync(dir,{recursive:true});}
});

test('desktop events exclude raw exceptions, filesystem paths, payloads and credentials',()=>{
  const result=publicEvent({event:'source_upload_failed',company:'Alpha',error:'API begin: HTTP 401',token:'secret',directory:'C:/secret',payload:{bank:'private'}});
  assert.equal(result.company,'Alpha');assert.match(result.message,/credentials/i);
  assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!Object.hasOwn(result,'error'));
  const failed=publicEvent({event:'run_failure',error:'sensitive arbitrary server text'});
  assert.ok(!JSON.stringify(failed).includes('sensitive'));
});

test('readiness does not mislabel connectivity or empty companies as a confirmed login rejection',()=>{
  assert.match(explainError({code:'NO_COMPANIES'}),/load|company/i);
  assert.doesNotMatch(explainError({code:'ECONNREFUSED'}),/not logged in/i);
  assert.match(explainError({exportDiagnostic:{httpStatus:403}}),/permission|access/i);
});
