const {test}=require('node:test');
const assert=require('node:assert/strict');
const source=require('../source-export');
const tally=require('../tally');
const {codes}=require('../export-diagnostics');
const envelope=rows=>`<ENVELOPE>\n<BODY><DATA><COLLECTION>${rows}</COLLECTION></DATA></BODY></ENVELOPE>`;
async function scenario(fetcher,work) {
  const original=global.fetch,events=[];
  global.fetch=fetcher;
  try {await work({tallyUrl:'http://localhost:9000/private?token=do-not-log',requestTimeoutMs:1000,exportLog:e=>events.push(e)},events);}
  finally {global.fetch=original;}
}
test('connection failures report nested causes and actionable endpoint without credentials or query',async()=>{
  await scenario(async()=>{throw new TypeError('fetch failed',{cause:Object.assign(new Error('sensitive-secret'),{code:'ECONNREFUSED'})});},async(config,events)=>{
    await assert.rejects(()=>source.extract(config,'GROUP','Company',()=>{}),/fetch failed/);
    const e=events.find(e=>e.event==='tally_export_failed');
    assert.equal(e.stage,'connect');assert.equal(e.endpoint,'http://localhost:9000');
    assert.ok(e.errorCodes.includes('ECONNREFUSED'));assert.match(e.action,/Open Tally/);
    assert.equal(e.bytesReceived,0);assert.equal(e.recordsReceived,0);
    assert.ok(!JSON.stringify(events).includes('sensitive-secret'));assert.ok(!JSON.stringify(events).includes('do-not-log'));
  });
  assert.ok(codes(new AggregateError([Object.assign(new Error(),{code:'ENOTFOUND'})])).includes('ENOTFOUND'));
});
test('numeric XML reference failure reports the exact location and parser category, not record contents',async()=>{
  await scenario(async()=>new Response(envelope('<GROUP NAME="PRIVATE_LEDGER"><PARENT>&#0; Private Amount 123.45</PARENT></GROUP>'),{headers:{'Content-Type':'application/xml; charset=utf-8'}}),async(config,events)=>{
    await assert.rejects(()=>source.extract(config,'GROUP','Company',()=>{}),/valid XML/);
    const e=events.find(e=>e.event==='tally_export_failed');
    assert.equal(e.stage,'parse');assert.equal(e.httpStatus,200);assert.ok(e.bytesReceived>0);
    assert.ok(e.errorCodes.includes('XML_INVALID_CHARACTER_REFERENCE'));
    assert.equal(e.xmlCharacterReference,'&#0;');
    assert.equal(e.xmlPath,'/ENVELOPE/BODY/DATA/COLLECTION/GROUP/PARENT');
    assert.equal(e.xmlLine,2);assert.ok(e.xmlColumn>0);assert.equal(e.recordsReceived,0);
    assert.ok(!JSON.stringify(events).includes('PRIVATE_LEDGER'));assert.ok(!JSON.stringify(events).includes('123.45'));
    assert.equal(events.find(e=>e.event==='tally_export_response').charset,'utf-8');
  });
});
test('truncated responses report completed records; successful source text remains untouched',async()=>{
  await scenario(async()=>new Response(envelope('<LEDGER><CLOSINGBALANCE/></LEDGER>').slice(0,-5)),async(config,events)=>{
    await assert.rejects(()=>source.extract(config,'LEDGER','Company',()=>{}),/valid XML/);
    const e=events.find(e=>e.event==='tally_export_failed');assert.equal(e.recordsReceived,1);assert.equal(e.recordsProcessed,1);
    assert.ok(e.errorCodes.includes('XML_TRUNCATED'));
  });
  await scenario(async()=>new Response(envelope('<LEDGER><CLOSINGBALANCE> USD 1.234 Cr </CLOSINGBALANCE></LEDGER>')),async(config,events)=>{
    const rows=[];await source.extract(config,'LEDGER','Company',row=>rows.push(row));
    assert.equal(source.field(rows[0],'CLOSINGBALANCE'),' USD 1.234 Cr ');
    assert.equal(events.find(e=>e.event==='tally_export_finished').recordsProcessed,1);
  });
});
test('discovery uses diagnostics and differentiates HTTP, decode, and record processing failures',async()=>{
  await scenario(async()=>new Response('not logged',{status:403}),async(config,events)=>{
    await assert.rejects(()=>tally.extract(config,'COMPANY',null,()=>{}),/HTTP 403/);
    assert.equal(events.find(e=>e.event==='tally_export_failed').httpStatus,403);
  });
  await scenario(async()=>new Response(new Uint8Array([0xff,0xfe])),async(config,events)=>{
    await assert.rejects(()=>source.extract(config,'GROUP','Company',()=>{}));
    assert.equal(events.find(e=>e.event==='tally_export_failed').stage,'decode');
  });
  await scenario(async()=>new Response(envelope('<COMPANY NAME="Example"><GUID>g</GUID></COMPANY>')),async(config,events)=>{
    await assert.rejects(()=>tally.extract(config,'COMPANY',null,()=>{throw Object.assign(new Error('write failed'),{code:'ENOSPC'});}),/write failed/);
    const e=events.find(e=>e.event==='tally_export_failed');assert.equal(e.stage,'record_handler');assert.equal(e.recordsReceived,1);assert.equal(e.recordsProcessed,0);
  });
});
