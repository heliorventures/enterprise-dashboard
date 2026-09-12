const { test } = require('node:test');
const assert = require('node:assert/strict');
const { amount, date, parseXml } = require('../tally');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {writer,deliver}=require('../outbox');
const {run}=require('../agent');
test('amounts preserve decimal precision and reject ambiguous currency', () => {
  assert.equal(amount('-9,999,999,999,999,999.99'), '-9999999999999999.99');
  assert.equal(amount('12000.00'), '12000.00');
  assert.throws(() => amount('USD 12.50'));
  assert.throws(() => amount(''));
  assert.throws(() => amount('1.001'));
  assert.throws(() => date('20260230'));
});
test('one-run sender retains a failed batch and resumes it without extracting a replacement', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-run-test-'));
  const originalFetch=global.fetch, originalLog=console.log;
  const messages=[];
  console.log=value=>messages.push(value);
  let failUpload=true, extractions=0;
  const response = records => new Response(`<ENVELOPE><BODY><DATA><COLLECTION>${records}</COLLECTION></DATA></BODY></ENVELOPE>`);
  global.fetch=async(url,options)=>{
    if(String(url).startsWith('http://localhost:9000')) {
      if(options.body.includes('<TYPE>COMPANY</TYPE>')) return response('<COMPANY NAME="Example"><NAME>Example</NAME><GUID>company-guid</GUID></COMPANY>');
      if(options.body.includes('<TYPE>LEDGER</TYPE>')) {extractions++;return response('<LEDGER NAME="Cash"><PARENT>Cash</PARENT><CLOSINGBALANCE>10.00</CLOSINGBALANCE></LEDGER>');}
      return response('<VOUCHER><DATE>20260901</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><AMOUNT>10.00</AMOUNT></VOUCHER>');
    }
    const body=JSON.parse(options.body);
    if(failUpload) return {status:401};
    return {status:200,json:async()=>({ok:true,batchId:body.batchId,ledgerCount:1,voucherCount:1})};
  };
  try {
    fs.writeFileSync(path.join(directory,'config.json'),JSON.stringify({importMode:'dashboard',tallyUrl:'http://localhost:9000',apiUrl:'https://finance.example',tokenFile:'token.txt',stateDirectory:'state',requestTimeoutMs:1000}));
    fs.writeFileSync(path.join(directory,'token.txt'),'test-token-not-for-logs-1234567890123456789');
    assert.equal(await run(path.join(directory,'config.json')),1);
    const outbox=path.join(directory,'state','outbox');
    assert.equal(fs.readdirSync(outbox).length,1);
    failUpload=false;
    assert.equal(await run(path.join(directory,'config.json')),0);
    assert.equal(extractions,1);
    assert.equal(fs.readdirSync(outbox).length,0);
    assert.ok(messages.some(line=>JSON.parse(line).event==='company_success'));
    assert.ok(!messages.join('').includes('test-token-not-for-logs'));
    assert.equal(fs.readdirSync(path.join(directory,'state','logs')).length,2);
  } finally {global.fetch=originalFetch;console.log=originalLog;fs.rmSync(directory,{recursive:true});}
});
test('chunking bounds requests and uncertain delivery retries identical bytes', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-agent-test-'));
  try {
    const store=writer(directory);
    for(let i=0;i<1201;i++) store.add('ledgers',{name:`Ledger ${i}`,group:'Cash',balance:'1.00'});
    const stats=store.finish();
    assert.equal(stats.chunkCount,3); assert.equal(stats.ledgerCount,1201);
    const manifest={batchId:'retry-test',company:{name:'Test'},...stats};
    const bodies=[]; let dropped=false;
    const fetcher=async (url,options) => {
      const body=JSON.parse(options.body);
      assert.ok(Buffer.byteLength(options.body)<1024*1024);
      if(url.endsWith('/chunk') && body.index===0) {
        bodies.push(options.body);
        if(!dropped) {dropped=true;throw new Error('simulated lost acknowledgement');}
      }
      return {status:200,json:async()=>({ok:true,batchId:manifest.batchId,ledgerCount:1201,voucherCount:0})};
    };
    const delivered=await deliver({apiUrl:'https://example.invalid',requestTimeoutMs:1000},'fake-token',directory,manifest,()=>{},fetcher,async()=>{});
    assert.equal(delivered.retries,1); assert.equal(bodies[0],bodies[1]);
    assert.equal(delivered.chunksAcknowledged,3);
    let calls=0;
    await assert.rejects(()=>deliver({apiUrl:'https://example.invalid',requestTimeoutMs:1000},'fake-token',directory,manifest,()=>{},async()=>{calls++;return {status:409};},async()=>{}),/409/);
    assert.equal(calls,1);
    assert.ok(fs.existsSync(path.join(directory,'0.json')));
  } finally {fs.rmSync(directory,{recursive:true});}
});
test('XML streaming preserves strings and rejects truncated/error responses', () => {
  const rows = [];
  const xml = '<ENVELOPE><BODY><DATA><COLLECTION><LEDGER NAME="001"><PARENT>Cash</PARENT><CLOSINGBALANCE>12000.00</CLOSINGBALANCE></LEDGER></COLLECTION></DATA></BODY></ENVELOPE>';
  const parser = parseXml('LEDGER', row => rows.push(row));
  for (let n=0; n<xml.length; n+=7) parser.write(xml.slice(n,n+7));
  parser.close();
  assert.equal(rows[0].NAME, '001');
  assert.equal(rows[0].CLOSINGBALANCE, '12000.00');
  assert.throws(() => parseXml('LEDGER', () => {}).write('<ENVELOPE>').close());
  assert.throws(() => parseXml('LEDGER', () => {}).write('<ENVELOPE><LINEERROR>Bad company</LINEERROR></ENVELOPE>').close());
  assert.throws(() => parseXml('LEDGER', () => {}).write('<html>wrong service</html>').close());
});
