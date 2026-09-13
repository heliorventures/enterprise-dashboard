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
