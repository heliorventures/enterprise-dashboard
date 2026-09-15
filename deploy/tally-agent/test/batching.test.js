const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const source=require('../source-export');
const {capture}=require('../source-agent');
const {dateWindows}=require('../scope');
const envelope=rows=>`<ENVELOPE><BODY><DATA><COLLECTION>${rows}</COLLECTION></DATA></BODY></ENVELOPE>`;
const voucher=(date,guid='v1')=>`<VOUCHER><DATE>${date}</DATE><GUID>${guid}</GUID></VOUCHER>`;
const config={tallyUrl:'http://localhost:9000',requestTimeoutMs:1000,voucherWindowDays:7};
const scope={kind:'period',from:'2024-02-25',to:'2024-03-05'};
test('windows cover leap day contiguously without overlap and preserve final day',()=>{
  assert.deepEqual([...dateWindows(scope,7)],[{kind:'period',from:'2024-02-25',to:'2024-03-02'},{kind:'period',from:'2024-03-03',to:'2024-03-05'}]);
  assert.deepEqual([...dateWindows({kind:'period',from:'9999-12-31',to:'9999-12-31'},7)],[{kind:'period',from:'9999-12-31',to:'9999-12-31'}]);
});
test('full export discovers actual dates including future vouchers before requesting full windows',async t=>{
  const requests=[],rows=[];
  t.mock.method(global,'fetch',async(url,{body})=>{
    requests.push(body);
    if(body.includes('<FETCH>Date</FETCH>'))return new Response(envelope('<VOUCHER><DATE>20991231</DATE></VOUCHER><VOUCHER><DATE>21000108</DATE></VOUCHER>'));
    return new Response(envelope(voucher(body.includes('20991229')?'20991231':'21000108')));
  });
  await source.extract(config,'VOUCHER','Example',row=>rows.push(row));
  assert.equal(requests.length,3);assert.equal(rows.length,2);
  assert.match(requests[0],/<FETCH>Date<\/FETCH>/);assert.doesNotMatch(requests[0],/NATIVEMETHOD|<FETCH>[^<]*\*/);
  assert.match(requests[1],/>20991229<\/SVFROMDATE>/);assert.match(requests[1],/>21000104<\/SVTODATE>/);
  assert.match(requests[2],/>21000105<\/SVFROMDATE>/);assert.match(requests[2],/>21000111<\/SVTODATE>/);
});
test('out-of-window vouchers and missing stable GUID fail closed',async t=>{
  for(const row of [voucher('20240306'),voucher('20240225','')]){
    t.mock.method(global,'fetch',async()=>new Response(envelope(row)));
    await assert.rejects(source.extract({...config,scope},'VOUCHER','Example',()=>{}),/VOUCHER_(DATE_INVALID|GUID_REQUIRED)/);
    t.mock.restoreAll();
  }
});
test('empty discovery makes no full voucher request and invalid discovery dates fail closed',async t=>{
  let requests=0;
  t.mock.method(global,'fetch',async()=>{requests++;return new Response(envelope(''));});
  await source.extract(config,'VOUCHER','Example',()=>assert.fail('empty collection'));
  assert.equal(requests,1);
  t.mock.restoreAll();
  t.mock.method(global,'fetch',async()=>new Response(envelope('<VOUCHER><DATE>20240230</DATE></VOUCHER>')));
  await assert.rejects(source.extract(config,'VOUCHER','Example',()=>{}),/VOUCHER_DATE_INVALID/);
});
test('Stop during a pause prevents the following request',async t=>{
  const controller=new AbortController();let requests=0;
  t.mock.method(global,'fetch',async()=>{requests++;return new Response(envelope(''));});
  const operation=source.extract({...config,scope,requestPauseMs:100,signal:controller.signal,
    exportLog:event=>{if(event.event==='tally_request_pause'&&requests===1)controller.abort();}},'VOUCHER','Example',()=>{});
  await assert.rejects(operation,{name:'AbortError'});assert.equal(requests,1);
});
test('failed later window leaves no complete manifest even without legacy stopOnFailure flag',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-window-test-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  t.mock.method(global,'fetch',async(url,{body})=>{
    if(body.includes('<TYPE>Company</TYPE>'))return new Response(envelope('<COMPANY><GUID>company-1</GUID></COMPANY>'));
    if(body.includes('<TYPE>Voucher</TYPE>'))return body.includes('20240303')?new Response('failed',{status:500}):new Response(envelope(voucher('20240225')));
    return new Response(envelope(''));
  });
  await assert.rejects(capture({...config,scope},{name:'Example',externalId:'company-1'},directory,()=>{}),/HTTP 500/);
  assert.equal(fs.existsSync(path.join(directory,'manifest.json')),false);
});
test('capture keeps continuous voucher ordinals across windows before writing its manifest',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-window-ordinal-test-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  t.mock.method(global,'fetch',async(url,{body})=>{
    if(/<TYPE>Company<\/TYPE>/i.test(body))return new Response(envelope('<COMPANY><NAME>Example</NAME><GUID>company-1</GUID><LASTALTERID>1</LASTALTERID><LASTVCHID>2</LASTVCHID></COMPANY>'));
    if(body.includes('<TYPE>Voucher</TYPE>'))return new Response(envelope(body.includes('20240303')?voucher('20240305','v2'):voucher('20240229','v1')));
    return new Response(envelope(''));
  });
  const manifest=await capture({...config,scope},{name:'Example',externalId:'company-1',marker:'["1","2"]'},directory,()=>{});
  assert.equal(manifest.consistency,'stable');
  assert.equal(manifest.collections.find(c=>c.name==='VOUCHER').count,2);
  const rows=JSON.parse(fs.readFileSync(path.join(directory,'0.json'),'utf8')).records.filter(r=>r.collection==='VOUCHER');
  assert.deepEqual(rows.map(r=>[r.ordinal,r.sourceId]),[[0,'v1'],[1,'v2']]);
});
test('full export skips empty centuries between populated date buckets',async t=>{
  const requests=[],rows=[];
  t.mock.method(global,'fetch',async(url,{body})=>{
    requests.push(body);
    if(requests.length>3)assert.fail('Empty date gap requested');
    if(body.includes('<FETCH>Date</FETCH>'))return new Response(envelope('<VOUCHER><DATE>99991231</DATE></VOUCHER><VOUCHER><DATE>19010101</DATE></VOUCHER>'));
    return new Response(envelope(body.includes('19010101')?voucher('19010101','old'):voucher('99991231','future')));
  });
  await source.extract(config,'VOUCHER','Example',row=>rows.push(source.field(row,'GUID')));
  assert.deepEqual(rows,['old','future']);assert.equal(requests.length,3);
  assert.match(requests[0],/>19010101<\/SVFROMDATE>/);
  assert.match(requests[1],/>19010107<\/SVTODATE>/);
  assert.match(requests[2],/>99991231<\/SVTODATE>/);
});
test('full capture refuses a manifest when detail count differs from date discovery',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-window-count-test-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  t.mock.method(global,'fetch',async(url,{body})=>{
    if(body.includes('<TYPE>Company</TYPE>'))return new Response(envelope('<COMPANY><GUID>company-1</GUID></COMPANY>'));
    if(body.includes('<FETCH>Date</FETCH>'))return new Response(envelope('<VOUCHER><DATE>20240225</DATE></VOUCHER><VOUCHER><DATE>20240225</DATE></VOUCHER>'));
    if(body.includes('<TYPE>Voucher</TYPE>'))return new Response(envelope(voucher('20240225')));
    return new Response(envelope(''));
  });
  await assert.rejects(capture(config,{name:'Example',externalId:'company-1'},directory,()=>{}),/VOUCHER_COUNT_MISMATCH/);
  assert.equal(fs.existsSync(path.join(directory,'manifest.json')),false);
});
