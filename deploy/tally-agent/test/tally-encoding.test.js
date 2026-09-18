const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TallyUtf8Decoder}=require('../tally-encoding');
const source=require('../source-export');

test('standalone A0 becomes NBSP with original byte offsets, across every split',()=>{
  const bytes=Buffer.concat([Buffer.from('₹ café 😀 \u00a0 '),Buffer.from([0xa0]),Buffer.from(' end')]);
  for(let split=0;split<=bytes.length;split++){
    const decoder=new TallyUtf8Decoder();
    const text=decoder.decode(bytes.subarray(0,split),{stream:true})+decoder.decode(bytes.subarray(split),{stream:true})+decoder.decode();
    assert.equal(text,'₹ café 😀 \u00a0 \u00a0 end');
    assert.deepEqual(decoder.diagnostics(),{legacyNbspCount:1,legacyNbspByteOffsets:[bytes.length-5]});
  }
});
test('valid UTF-8 survives single-byte chunks including A0 continuation bytes',()=>{
  const expected='\u00a0ࠀ𐀀 café ₹ 😀';
  const decoder=new TallyUtf8Decoder();let text='';
  for(const byte of Buffer.from(expected))text+=decoder.decode(Uint8Array.of(byte),{stream:true});
  text+=decoder.decode();assert.equal(text,expected);assert.equal(decoder.diagnostics().legacyNbspCount,0);
});
test('unrelated malformed sequences and incomplete characters stay rejected at every split',()=>{
  for(const data of [[0xff],[0x80],[0xc0,0xa0],[0xe0,0x80,0xa0],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80],[0xc2],[0xe2,0xa0],[0xe2,0x41,0xa0]]){
    for(let split=0;split<=data.length;split++){
      const decoder=new TallyUtf8Decoder();
      assert.throws(()=>{decoder.decode(Uint8Array.from(data.slice(0,split)),{stream:true});decoder.decode(Uint8Array.from(data.slice(split)),{stream:true});decoder.decode();},{code:'ERR_ENCODING_INVALID_ENCODED_DATA'});
    }
  }
});
test('diagnostic offsets are bounded even with many legacy spaces',()=>{
  const decoder=new TallyUtf8Decoder();assert.equal(decoder.decode(Buffer.alloc(1000,0xa0)),'\u00a0'.repeat(1000));
  assert.equal(decoder.diagnostics().legacyNbspCount,1000);assert.equal(decoder.diagnostics().legacyNbspByteOffsets.length,8);
});
test('export preserves narration and reports correction without logging its contents',async t=>{
  const bytes=Buffer.concat([Buffer.from('<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER><GUID>x</GUID><NARRATION>PRIVATE'),Buffer.from([0xa0]),Buffer.from('NOTE</NARRATION></VOUCHER></COLLECTION></DATA></BODY></ENVELOPE>')]);
  t.mock.method(global,'fetch',async()=>new Response(bytes));const events=[],rows=[];
  await source.extract({tallyUrl:'http://localhost:9000',requestTimeoutMs:1000,exportLog:event=>events.push(event)},'VOUCHER','Example',row=>rows.push(row));
  assert.equal(source.field(rows[0],'NARRATION'),'PRIVATE\u00a0NOTE');
  assert.equal(events.find(event=>event.event==='tally_export_finished').encodingCompatibility.legacyNbspCount,1);
  assert.ok(!JSON.stringify(events).includes('PRIVATE'));
});
