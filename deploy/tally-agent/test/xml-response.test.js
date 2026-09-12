const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {parseXml,required,ledger,voucher}=require('../tally');
const {run}=require('../agent');

// Synthetic response shapes reproducing the server diagnostic, not a captured
// customer export. HEADER counters and typed scalar fields must not become rows.
const envelope=records=>`<ENVELOPE><HEADER><VERSION><COMPANY>5</COMPANY><LEDGER>8</LEDGER><VOUCHER>9</VOUCHER></VERSION><STATUS>1</STATUS></HEADER><BODY><DESC><COLLECTION><COMPANY NAME="Description"/></COLLECTION></DESC><DATA><COLLECTION>${records}</COLLECTION></DATA></BODY></ENVELOPE>`;
const company=(name,guid)=>`<COMPANY NAME="${name}" RESERVEDNAME=""><NAME TYPE="String">${name}</NAME><GUID TYPE="String">${guid}</GUID><BOOKSFROM TYPE="Date">20260401</BOOKSFROM></COMPANY>`;
function parse(type,xml) {
  const rows=[];
  const parser=parseXml(type,row=>rows.push(row));
  for(let i=0;i<xml.length;i+=3) parser.write(xml.slice(i,i+3));
  parser.close();
  return rows;
}

test('discovery ignores counters/descriptions and reads five typed company identities',()=>{
  const rows=parse('COMPANY',envelope(Array.from({length:5},(_,i)=>company(`Company ${i}`,`guid-${i}`)).join('')));
  assert.equal(rows.length,5);
  rows.forEach((row,i)=>{
    assert.equal(required(row.NAME,200,'company name'),`Company ${i}`);
    assert.equal(required(row.GUID,200,'company GUID'),`guid-${i}`);
    assert.equal(row.BOOKSFROM,'20260401');
  });
  assert.equal(parse('COMPANY',envelope('')).length,0);
  assert.throws(()=>parse('COMPANY','<ENVELOPE><BODY><DESC><COLLECTION/></DESC></BODY></ENVELOPE>'),/collection missing/);
});

test('scalar text survives type metadata and repeated accounting entries remain separate',()=>{
  const rows=parse('LEDGER',envelope('<LEDGER NAME="001"><NAME TYPE="String">001</NAME><PARENT TYPE="String">Cash</PARENT><CLOSINGBALANCE TYPE="Amount">-12.50</CLOSINGBALANCE></LEDGER>'));
  assert.deepEqual(ledger(rows[0]),{name:'001',group:'Cash',balance:'-12.50'});
  const entry=value=>`<ALLLEDGERENTRIES.LIST><AMOUNT TYPE="Amount">${value}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
  const vouchers=parse('VOUCHER',envelope(`<VOUCHER><DATE TYPE="Date">20260912</DATE><VOUCHERTYPENAME TYPE="String">Journal</VOUCHERTYPENAME>${entry('-5.00')}${entry('-5.00')}${entry('10.00')}</VOUCHER>`));
  assert.equal(vouchers[0]['ALLLEDGERENTRIES.LIST'].length,3);
  assert.equal(voucher(vouchers[0]).amount,'10.00');
  const repeated=parse('COMPANY',envelope('<COMPANY><NAME>A</NAME><NAME>A</NAME><GUID>x</GUID></COMPANY>'))[0];
  assert.deepEqual(repeated.NAME,['A','A']);
  assert.throws(()=>required(repeated.NAME,200,'company name'),/Invalid company name/);
});

test('invalid real records and conflicting identities are never silently skipped',()=>{
  assert.throws(()=>parse('COMPANY',envelope('<COMPANY NAME="A"><NAME TYPE="String">B</NAME><GUID>x</GUID></COMPANY>')),/Conflicting Tally NAME/);
  const rows=parse('COMPANY',envelope('<COMPANY/>'));
  assert.equal(rows.length,1);
  assert.throws(()=>required(rows[0].NAME,200,'company name'),/Invalid company name/);
  const missingGuid=parse('COMPANY',envelope('<COMPANY NAME="A"/>'))[0];
  assert.throws(()=>required(missingGuid.GUID,200,'company GUID'),/Invalid company GUID/);
});

test('explicit empty ledger closing balances are zero; absent or malformed amounts still fail',()=>{
  for(const field of ['<CLOSINGBALANCE/>','<CLOSINGBALANCE TYPE="Amount"></CLOSINGBALANCE>', '<CLOSINGBALANCE TYPE="Amount"> </CLOSINGBALANCE>']) {
    const row=parse('LEDGER',envelope(`<LEDGER NAME="Zero"><PARENT>Cash</PARENT>${field}</LEDGER>`))[0];
    assert.equal(ledger(row).balance,'0.00');
  }
  for(const field of ['', '<CLOSINGBALANCE>USD 12.00</CLOSINGBALANCE>', '<CLOSINGBALANCE/><CLOSINGBALANCE/>']) {
    const row=parse('LEDGER',envelope(`<LEDGER NAME="Invalid"><PARENT>Cash</PARENT>${field}</LEDGER>`))[0];
    assert.throws(()=>ledger(row),/Unsupported Tally amount format/);
  }
  for(const value of [undefined,null,{},[]]) {
    assert.throws(()=>ledger({NAME:'Invalid',PARENT:'Cash',CLOSINGBALANCE:value}),/Unsupported Tally amount format/);
  }
  assert.throws(()=>require('../tally').amount(''),/Unsupported Tally amount format/);
  assert.throws(()=>voucher({DATE:'20260912',VOUCHERTYPENAME:'Sales',AMOUNT:''}),/neither amount nor accounting entries/);
});

test('dry run scopes every ledger/voucher request by discovered name and rechecks identities',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-xml-response-'));
  const originalFetch=global.fetch, originalLog=console.log;
  const events=[],requests=[];
  const names=['Company &amp; One','Company Two'];
  let discoveries=0;
  console.log=line=>events.push(JSON.parse(line));
  global.fetch=async(url,options)=>{
    assert.equal(url,'http://localhost:9000'); // Dry run must never reach API.
    const body=options.body;
    if(body.includes('<TYPE>COMPANY</TYPE>')) {
      discoveries++;
      return new Response(envelope(names.map((name,i)=>company(name,`guid-${i}`)).join('')));
    }
    const selected=body.match(/<SVCURRENTCOMPANY>(.*?)<\/SVCURRENTCOMPANY>/)?.[1];
    assert.ok(names.includes(selected),'Export must explicitly select a discovered company');
    const type=body.includes('<TYPE>LEDGER</TYPE>') ? 'LEDGER' : 'VOUCHER';
    requests.push([selected,type]);
    return new Response(envelope(type==='LEDGER'
      ? '<LEDGER NAME="Cash"><NAME TYPE="String">Cash</NAME><PARENT TYPE="String">Cash</PARENT><CLOSINGBALANCE TYPE="Amount">10.00</CLOSINGBALANCE></LEDGER>'
      : '<VOUCHER><DATE TYPE="Date">20260912</DATE><VOUCHERTYPENAME TYPE="String">Sales</VOUCHERTYPENAME><AMOUNT TYPE="Amount">10.00</AMOUNT></VOUCHER>'));
  };
  try {
    const configFile=path.join(directory,'config.json');
    fs.writeFileSync(configFile,JSON.stringify({importMode:'dashboard',tallyUrl:'http://localhost:9000',apiUrl:'https://example.invalid',stateDirectory:'state',requestTimeoutMs:1000}));
    assert.equal(await run(configFile,true),0);
    assert.deepEqual(requests,names.flatMap(name=>[[name,'LEDGER'],[name,'VOUCHER']]));
    assert.equal(discoveries,3);
    const result=events.find(row=>row.event==='run_finished');
    assert.equal(result.failed,0); assert.equal(result.succeeded,2);
    assert.equal(result.ledgers,2); assert.equal(result.vouchers,2);
  } finally {
    global.fetch=originalFetch;console.log=originalLog;
    fs.rmSync(directory,{recursive:true});
  }
});
