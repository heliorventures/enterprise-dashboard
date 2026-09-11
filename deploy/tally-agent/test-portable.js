// Local artifact verification: no real Tally connection or API writes.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {execFile}=require('node:child_process');
const assert=require('node:assert/strict');
const {xml}=require('./fixture-runner');
const fixture=require('./fixtures/version-1.json');
async function main() {
  const root=path.resolve(process.argv[2]);
  assert.ok(root.includes('verification copy'), 'Use an extracted disposable verification copy');
  assert.equal(fs.readFileSync(path.join(root,'token.txt'),'utf8'),'');
  assert.ok(!fs.existsSync(path.join(root,'fixtures')));
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const part of req) body+=part;
    const type=body.match(/<TYPE>(COMPANY|LEDGER|VOUCHER)<\/TYPE>/)?.[1];
    try {res.end(xml(fixture,type));} catch {res.writeHead(400).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
    config.tallyUrl=`http://127.0.0.1:${server.address().port}`;
    fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(config));
    const command=path.join(process.env.SystemRoot,'System32','cmd.exe');
    const env={...process.env,PATH:path.join(process.env.SystemRoot,'System32')};
    const output=await new Promise((resolve,reject)=>execFile(command,['/d','/c','Run-Sync.cmd','--dry-run'],
      {cwd:root,env,windowsHide:true,timeout:30000},(error,stdout,stderr)=>error ? reject(error) : resolve(stdout)));
    const events=output.trim().split(/\r?\n/).map(line=>JSON.parse(line));
    const summary=events.find(row=>row.event==='run_finished');
    assert.equal(summary.succeeded,1);assert.equal(summary.failed,0);
    assert.equal(summary.ledgers,5);assert.equal(summary.vouchers,2);assert.equal(summary.dryRun,true);
    console.log('PASS: extracted Run-Sync.cmd, path with spaces, no Node on PATH, full simulated extraction, logs, no API writes.');
  } finally {await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
