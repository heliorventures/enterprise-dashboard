// Local XML simulator. Uses the real sender, outbox and deployed ingestion API.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./agent');
const {saveJson}=require('./outbox');
const {withLock}=require('./launcher');
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const element=(name,value)=>`<${name}>${esc(value)}</${name}>`;
function xml(fixture,type) {
  let content;
  if(type==='COMPANY') content=`<COMPANY NAME="${esc(fixture.company.name)}">${element('GUID',fixture.company.externalId)}</COMPANY>`;
  else if(type==='LEDGER') content=fixture.ledgers.map(row=>`<LEDGER NAME="${esc(row.name)}">${element('PARENT',row.group)}${element('CLOSINGBALANCE',row.balance)}</LEDGER>`).join('');
  else if(type==='VOUCHER') content=fixture.vouchers.map(row=>`<VOUCHER>${element('DATE',row.date)}${element('VOUCHERTYPENAME',row.type)}${element('VOUCHERNUMBER',row.number)}${element('AMOUNT',row.amount)}${element('NARRATION',row.narration)}</VOUCHER>`).join('');
  else throw new Error('Unsupported fixture collection');
  return `<ENVELOPE><BODY><DATA><COLLECTION>${content}</COLLECTION></DATA></BODY></ENVELOPE>`;
}
async function main() {
  const version=process.argv[2];
  if(!['1','2'].includes(version)) throw new Error('Choose fixture version 1 or 2');
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',`version-${version}.json`),'utf8'));
  const state=path.join(__dirname,'state','fixture-test');
  const pending=path.join(state,'outbox');
  const versionFile=path.join(state,'fixture-version.json');
  const hasPending=fs.existsSync(pending) && fs.readdirSync(pending).some(id=>fs.existsSync(path.join(pending,id,'manifest.json')));
  if(hasPending && (!fs.existsSync(versionFile) || JSON.parse(fs.readFileSync(versionFile,'utf8')).version!==version)) {
    throw new Error('An earlier fixture version is pending. Rerun run-fixture.ps1 with that version before changing versions.');
  }
  if(!process.argv.includes('--dry-run')) saveJson(versionFile,{version});
  const server=http.createServer(async(req,res)=>{
    let body='';
    for await(const piece of req) {body+=piece;if(body.length>20000) {res.writeHead(413).end();return;}}
    try {
      const type=body.match(/<TYPE>(COMPANY|LEDGER|VOUCHER)<\/TYPE>/)?.[1];
      res.writeHead(200,{'Content-Type':'application/xml; charset=utf-8'}).end(xml(fixture,type));
    } catch {res.writeHead(400).end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    const configFile=path.join(__dirname,'state','fixture-config.json');
    saveJson(configFile,{tallyUrl:`http://127.0.0.1:${server.address().port}`,apiUrl:process.argv[3] || 'https://finance.heliorsoft.com',
      tokenEnvironmentVariable:'FINANCE_FIXTURE_TOKEN',stateDirectory:state,requestTimeoutMs:300000,logRetentionDays:30});
    process.exitCode=await withLock(configFile,()=>run(configFile,process.argv.includes('--dry-run')));
  } finally {await new Promise(resolve=>server.close(resolve));}
}
if(require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={xml};
