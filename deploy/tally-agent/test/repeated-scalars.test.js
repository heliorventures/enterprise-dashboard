const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const source=require('../source-export');
const api=require('../../../api/src/sourceUnpack');
after(()=>require('../../../api/src/db').close());
const leaf=(tag,value)=>({tag,attributes:{TYPE:'String'},content:[value]});
for(const [label,field] of [['exporter',source.field],['reporting',api.field]]) {
  test(`${label} accepts agreeing repeated scalars without changing raw records`,()=>{
    for(const [name,value] of [['GUID','company-1'],['NAME','Example'],['DATE','20260918'],['AMOUNT','1,234.50'],['CLOSINGBALANCE','']]) {
      const row={tag:'COMPANY',attributes:{},content:[leaf(name,value),leaf(name,value)]};
      const original=JSON.stringify(row);assert.equal(field(row,name),value);assert.equal(JSON.stringify(row),original);
    }
  });
  test(`${label} rejects conflicting or structured repetitions instead of guessing`,()=>{
    assert.equal(field({attributes:{GUID:'a'},content:[leaf('GUID','a'),leaf('GUID','b')]},'GUID'),null);
    assert.equal(field({attributes:{GUID:'a'},content:[leaf('GUID','a'),{tag:'GUID',attributes:{},content:[leaf('VALUE','a')]}]},'GUID'),null);
    assert.equal(field({attributes:{},content:[leaf('AMOUNT','1'),leaf('AMOUNT','1.00')]},'AMOUNT'),null);
  });
}
test('full company capture matches one of five companies with repeated GUID and NAME fields',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-repeated-company-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const companies=Array.from({length:5},(_,i)=>`<COMPANY NAME="Company ${i}"><NAME>Company ${i}</NAME><NAME>Company ${i}</NAME><GUID>company-${i}</GUID><GUID>company-${i}</GUID></COMPANY>`).join('');
  const discovery=Array.from({length:5},(_,i)=>`<COMPANY NAME="Company ${i}"><NAME>Company ${i}</NAME><GUID>company-${i}</GUID></COMPANY>`).join('');
  t.mock.method(global,'fetch',async(url,{body})=>new Response(`<ENVELOPE><BODY><DATA><COLLECTION>${body.includes('<ID>FinanceAgent</ID>')?discovery:/<TYPE>Company<\/TYPE>/i.test(body)?companies:''}</COLLECTION></DATA></BODY></ENVELOPE>`));
  const manifest=await require('../source-agent').capture({tallyUrl:'http://localhost:9000',requestTimeoutMs:1000,voucherWindowDays:7},
    {name:'Company 2',externalId:'company-2',marker:'["",""]'},directory,()=>{});
  assert.equal(manifest.collections.find(c=>c.name==='COMPANY').count,1);
  const records=JSON.parse(fs.readFileSync(path.join(directory,'0.json'),'utf8')).records;
  assert.equal(records[0].sourceId,'company-2');assert.equal(records[0].payload.content.filter(n=>n.tag==='GUID').length,2);
});
