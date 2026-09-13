// Local artifact verification: no real Tally connection or API writes.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {execFile}=require('node:child_process');
const assert=require('node:assert/strict');
const {xml}=require('./fixture-runner');
const fixture=require('./fixtures/version-1.json');
const {CATALOG,field}=require('./source-export');
async function main() {
  const root=path.resolve(process.argv[2]);
  const failureCase=process.argv.includes('--failure-case');
  assert.ok(root.includes('verification copy'), 'Use an extracted disposable verification copy');
  assert.equal(fs.readFileSync(path.join(root,'token.txt'),'utf8'),'');
  assert.ok(!fs.existsSync(path.join(root,'fixtures')));
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const part of req) body+=part;
    const discovery=body.includes('<ID>FinanceAgent</ID>');
    const type=discovery?'COMPANY':Object.keys(CATALOG).find(k=>body.includes(`<TYPE>${CATALOG[k]}</TYPE>`));
    try {
      if(failureCase&&type==='GROUP') {
        res.end('<ENVELOPE><BODY><DATA><COLLECTION><GROUP><PARENT>&#0;</PARENT></GROUP></COLLECTION></DATA></BODY></ENVELOPE>');return;
      }
      // Exercise the actual packaged parser with counters and typed scalars,
      // including NAME repeated as both record attribute and child element.
      const response=(['COMPANY','LEDGER','VOUCHER'].includes(type)?xml(fixture,type):'<ENVELOPE><BODY><DATA><COLLECTION/></DATA></BODY></ENVELOPE>')
        .replace('<BODY>','<HEADER><VERSION><COMPANY>1</COMPANY><LEDGER>5</LEDGER><VOUCHER>2</VOUCHER></VERSION></HEADER><BODY>')
        .replace(/<(COMPANY|LEDGER) NAME="([^"]*)">/g,'<$1 NAME="$2"><NAME TYPE="String">$2</NAME>')
        .replace(/<(GUID|PARENT|CLOSINGBALANCE|DATE|VOUCHERTYPENAME|VOUCHERNUMBER|AMOUNT|NARRATION)>/g,'<$1 TYPE="String">');
      // Include Tally's explicit empty representation for a zero ledger amount.
      res.end(type==='LEDGER' ? response.replace(/<CLOSINGBALANCE TYPE="String">[^<]*<\/CLOSINGBALANCE>/,'<CLOSINGBALANCE TYPE="Amount"/><GSTAPPLICABLE>&#4; Not Applicable</GSTAPPLICABLE>')
        :type==='VOUCHER'?response.replace(/<AMOUNT TYPE="String">[^<]*<\/AMOUNT>/,'<AMOUNT TYPE="Amount">USD 1,23,456.789 Cr</AMOUNT><CLASSNAME>\u0005Class\u0005</CLASSNAME>'):response);
    } catch {res.writeHead(400).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
    assert.equal(config.importMode,'source');
    config.tallyUrl=`http://127.0.0.1:${server.address().port}`;
    fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(config));
    const command=path.join(process.env.SystemRoot,'System32','cmd.exe');
    const env={...process.env,PATH:path.join(process.env.SystemRoot,'System32')};
    const output=await new Promise((resolve,reject)=>execFile(command,['/d','/c','Run-Sync.cmd','--dry-run'],
      {cwd:root,env,windowsHide:true,timeout:30000},(error,stdout,stderr)=>error&&!(failureCase&&error.code===1) ? reject(error) : resolve(stdout)));
    const events=output.trim().split(/\r?\n/).map(line=>JSON.parse(line));
    const summary=events.find(row=>row.event==='run_finished');
    assert.equal(summary.succeeded,failureCase?0:1);assert.equal(summary.failed,failureCase?1:0);
    assert.equal(summary.records,8);assert.equal(summary.mode,'source');assert.equal(summary.dryRun,true);
    assert.ok(events.some(row=>row.event==='tally_export_response'&&row.httpStatus===200));
    assert.ok(events.some(row=>row.event==='tally_export_finished'&&row.phase==='source_capture'&&row.collection==='LEDGER'&&row.recordsReceived===5));
    if(failureCase) {
      assert.equal(summary.failedCollections.length,1);
      const failure=events.find(row=>row.event==='tally_export_failed');
      assert.equal(failure.collection,'GROUP');assert.equal(failure.xmlCharacterReference,'&#0;');
      assert.ok(failure.errorCodes.includes('XML_INVALID_CHARACTER_REFERENCE'));
      assert.equal(failure.xmlPath,'/ENVELOPE/BODY/DATA/COLLECTION/GROUP/PARENT');
    } else assert.deepEqual(summary.failedCollections,[]);
    const preview=path.join(root,'state','source-preview');
    const batches=fs.readdirSync(preview);
    assert.equal(batches.length,1);
    const chunk=JSON.parse(fs.readFileSync(path.join(preview,batches[0],'0.json'),'utf8'));
    assert.equal(field(chunk.records.find(r=>r.collection==='LEDGER').payload,'CLOSINGBALANCE'),'');
    assert.equal(field(chunk.records.find(r=>r.collection==='LEDGER').payload,'GSTAPPLICABLE'),'\u0004 Not Applicable');
    assert.equal(field(chunk.records.find(r=>r.collection==='VOUCHER').payload,'CLASSNAME'),'\u0005Class\u0005');
    assert.equal(field(chunk.records.find(r=>r.collection==='VOUCHER').payload,'AMOUNT'),'USD 1,23,456.789 Cr');
    const manifest=JSON.parse(fs.readFileSync(path.join(preview,batches[0],'manifest.json'),'utf8'));
    assert.equal(manifest.collections.length,13);assert.equal(manifest.collections.filter(c=>c.status==='failed').length,failureCase?1:0);
    console.log('PASS: extracted Run-Sync.cmd, path with spaces, no Node on PATH, 13 source collections, unconverted source values, logs, no API writes.');
  } finally {await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
