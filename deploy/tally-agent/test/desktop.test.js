const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {run}=require('../source-agent');
const {deliver}=require('../outbox');
const {withLock}=require('../launcher');
const envelope=rows=>`<ENVELOPE><BODY><DATA><COLLECTION>${rows}</COLLECTION></DATA></BODY></ENVELOPE>`;
const company=(id,name)=>`<COMPANY NAME="${name}"><NAME>${name}</NAME><GUID>${id}</GUID></COMPANY>`;

test('desktop failure stops at the first collection without contacting another company or uploading',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-fail-fast-')),original=global.fetch,calls=[];
  global.fetch=async(url,options)=>{calls.push(options.body);if(String(url).startsWith('https:'))throw new Error('Unexpected upload');if(options.body.includes('<TYPE>Group</TYPE>'))throw new Error('Synthetic busy Tally');return new Response(envelope(company('a','Alpha')+company('b','Beta')));};
  try {
    const result=await run(path.join(dir,'unused.json'),false,{config:{apiUrl:'https://example.invalid',tallyUrl:'http://localhost:9000',stopOnFailure:true},token:'x'.repeat(40),selectedCompanyIds:['a','b'],quiet:true});
    assert.equal(result,1);assert.equal(calls.length,3);
    assert.ok(!calls.some(body=>body.includes('<TYPE>Ledger</TYPE>')||body.includes('<SVCURRENTCOMPANY>Beta</SVCURRENTCOMPANY>')));
  } finally {global.fetch=original;fs.rmSync(dir,{recursive:true});}
});

test('period baseline check fails before any collection export and never retries',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-period-preflight-')),original=global.fetch,calls=[];
  global.fetch=async(url)=>{calls.push(String(url));return String(url).startsWith('https:')?new Response('{}',{status:409}):new Response(envelope(company('a','Alpha')));};
  try {
    const events=[];
    assert.equal(await run(path.join(dir,'unused.json'),false,{config:{apiUrl:'https://example.invalid',tallyUrl:'http://localhost:9000',stopOnFailure:true,scope:{kind:'period',from:'2026-09-01',to:'2026-09-15'}},token:'x'.repeat(40),selectedCompanyIds:['a'],quiet:true,onEvent:e=>events.push(e)}),1);
    assert.equal(calls.length,2);assert.match(calls[1],/source-period\/preflight$/);assert.ok(!events.some(e=>e.event==='source_collection_started'));
  } finally {global.fetch=original;fs.rmSync(dir,{recursive:true});}
});

test('an explicitly stale period is retained but cannot trap every subsequent manual sync',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-stale-period-')),original=global.fetch;
  const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',pending=path.join(dir,'state','source-outbox',id),scope={kind:'period',from:'2026-09-01',to:'2026-09-15'};
  fs.mkdirSync(pending,{recursive:true});fs.writeFileSync(path.join(pending,'manifest.json'),JSON.stringify({batchId:id,profile:'company-business-v1',scope,company:{externalId:'a',name:'Alpha'}}));
  const calls=[],options={config:{apiUrl:'https://example.invalid',tallyUrl:'http://localhost:9000',scope,stopOnFailure:true,uploadAttempts:1},token:'x'.repeat(40),selectedCompanyIds:['a'],quiet:true};
  global.fetch=async(url,request)=>{
    calls.push(String(url));
    if(String(url).endsWith('/preflight'))return new Response(JSON.stringify({ok:true,companyExternalId:'a',baselineBatchId:'newer'}));
    if(String(url).startsWith('https:'))return new Response(JSON.stringify({code:'PERIOD_CAPTURE_STALE'}),{status:409});
    if(request.body.includes('<TYPE>Group</TYPE>'))throw new Error('End synthetic fresh capture');
    return new Response(envelope(company('a','Alpha')));
  };
  try {
    assert.equal(await run(path.join(dir,'unused.json'),false,options),1);
    assert.ok(fs.existsSync(path.join(pending,'held.json')));assert.ok(fs.existsSync(path.join(pending,'manifest.json')));
    calls.length=0;
    await run(path.join(dir,'unused.json'),false,options);
    assert.ok(calls.some(url=>url.endsWith('/preflight')));assert.ok(!calls.some(url=>url.endsWith('/begin')));
  } finally {global.fetch=original;fs.rmSync(dir,{recursive:true});}
});

test('desktop selection excludes unchecked companies from capture and durable retries',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-desktop-selection-'));
  const original=global.fetch;
  const events=[],uploads=[];
  const pending=path.join(dir,'state','source-outbox','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  fs.mkdirSync(pending,{recursive:true});
  fs.writeFileSync(path.join(pending,'manifest.json'),JSON.stringify({company:{externalId:'b',name:'Beta'}}));
  global.fetch=async(url,options)=>{
    if(String(url).startsWith('https:')){uploads.push(url);throw new Error('Unselected upload attempted');}
    assert.ok(!options.body.includes('<SVCURRENTCOMPANY>Beta</SVCURRENTCOMPANY>'));
    return new Response(envelope(options.body.includes('<TYPE>Company</TYPE>')||options.body.includes('<ID>FinanceAgent</ID>')?company('a','Alpha')+company('b','Beta'):''));
  };
  try {
    const result=await run(path.join(dir,'unused.json'),true,{config:{apiUrl:'https://example.invalid',tallyUrl:'http://localhost:9000'},selectedCompanyIds:['a'],onEvent:e=>events.push(e),quiet:true});
    assert.equal(result,0);
    assert.deepEqual(events.filter(e=>e.event==='source_preview').map(e=>e.company),['Alpha']);
    // Live run retries only the selected Alpha capture, never pending Beta.
    global.fetch=async(url,options)=>{
      if(String(url).startsWith('https:')) {
        const body=JSON.parse(options.body);uploads.push(body);
        return {status:401};
      }
      return new Response(envelope(options.body.includes('<TYPE>Company</TYPE>')||options.body.includes('<ID>FinanceAgent</ID>')?company('a','Alpha')+company('b','Beta'):''));
    };
    assert.equal(await run(path.join(dir,'unused.json'),false,{config:{apiUrl:'https://example.invalid',tallyUrl:'http://localhost:9000'},token:'x'.repeat(40),selectedCompanyIds:['a'],quiet:true}),1);
    assert.deepEqual(uploads.map(m=>m.company.externalId),['a']);
    assert.ok(fs.existsSync(path.join(pending,'manifest.json')));
  } finally {global.fetch=original;fs.rmSync(dir,{recursive:true});}
});

test('empty selection and disappeared selected GUID fail before uploads',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-desktop-missing-'));
  const original=global.fetch;let uploads=0;
  global.fetch=async(url)=>{if(String(url).startsWith('https:'))uploads++;return new Response(envelope(company('b','Beta')));};
  const options={config:{apiUrl:'https://example.invalid',tallyUrl:'http://localhost:9000'},token:'x'.repeat(40),quiet:true};
  try {
    await assert.rejects(()=>run(path.join(dir,'unused.json'),false,{...options,selectedCompanyIds:[]}),/select|selection/i);
    const events=[];
    assert.equal(await run(path.join(dir,'unused.json'),false,{...options,selectedCompanyIds:['a'],onEvent:e=>events.push(e)}),1);
    assert.equal(uploads,0);
    assert.ok(events.some(e=>e.event==='run_failure'));
  } finally {global.fetch=original;fs.rmSync(dir,{recursive:true});}
});

test('cancellation during extraction never uploads a partial cancelled snapshot',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-desktop-stop-'));
  const original=global.fetch,controller=new AbortController();let uploads=0;
  global.fetch=async(url,options)=>{
    if(String(url).startsWith('https:'))uploads++;
    if(options.body.includes('<TYPE>Ledger</TYPE>'))controller.abort();
    return new Response(envelope(options.body.includes('<TYPE>Company</TYPE>')||options.body.includes('<ID>FinanceAgent</ID>')?company('a','Alpha'):''));
  };
  try {
    const events=[];
    assert.equal(await run(path.join(dir,'unused.json'),false,{config:{apiUrl:'https://example.invalid',tallyUrl:'http://localhost:9000'},token:'x'.repeat(40),selectedCompanyIds:['a'],signal:controller.signal,onEvent:e=>events.push(e),quiet:true}),1);
    assert.equal(uploads,0);
    assert.ok(events.some(e=>e.event==='run_cancelled'));
    assert.deepEqual(fs.readdirSync(path.join(dir,'state','source-outbox')),[]);
  } finally {global.fetch=original;fs.rmSync(dir,{recursive:true});}
});

test('upload reports acknowledged chunks and cancellation preserves the original batch',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-desktop-delivery-'));
  const controller=new AbortController(),events=[];
  fs.writeFileSync(path.join(dir,'0.json'),JSON.stringify({records:[]}));
  const m={batchId:'batch',profile:'company-business-v1',company:{name:'Alpha'},chunkCount:1,recordCount:0,collections:[{status:'success'}],consistency:'stable'};
  try {
    await assert.rejects(()=>deliver({apiUrl:'https://example.invalid',requestTimeoutMs:1000,signal:controller.signal},'token',dir,m,e=>events.push(e),async(url)=>{
      if(url.endsWith('/chunk'))controller.abort();
      return {status:200,json:async()=>({ok:true,batchId:'batch'})};
    }),/abort/i);
    assert.ok(events.some(e=>e.event==='upload_progress'&&e.chunksAcknowledged===1&&e.chunkCount===1));
    assert.ok(fs.existsSync(path.join(dir,'0.json')));
  } finally {fs.rmSync(dir,{recursive:true});}
});

test('desktop and command-line calls share the state-directory lock',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-desktop-lock-'));
  const file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify({stateDirectory:'state'}));
  try {assert.equal(await withLock({stateDirectory:path.join(dir,'state')},()=>withLock(file,()=>0)),2);}
  finally {fs.rmSync(dir,{recursive:true});}
});
test('manual upload makes one attempt and never automatically sleeps or retries',async()=>{
  let calls=0;
  await assert.rejects(()=>deliver({apiUrl:'https://example.invalid',requestTimeoutMs:1000,uploadAttempts:1},'test','unused',
    {batchId:'test',profile:'company-business-v1',company:{name:'A'}},()=>{},async()=>{calls++;return {status:503};},async()=>{throw new Error('Unexpected retry');}),/HTTP 503/);
  assert.equal(calls,1);
});
