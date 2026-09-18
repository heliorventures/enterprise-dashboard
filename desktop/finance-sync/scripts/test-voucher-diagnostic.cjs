// Local-only diagnostic verification. No Tally or Finance connections.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const zlib=require('node:zlib');
const {spawn}=require('node:child_process');
const source=require('../../../deploy/tally-agent/source-export');
async function main(){
  const root=fs.mkdtempSync(path.join(__dirname,'../test-artifacts/encoding-diagnostic-'));
  const cases=[Buffer.from('<X>Rupee ₹ and café</X>'),Buffer.concat([Buffer.from('<X>'),Buffer.from([0xed,0xa0,0x80]),Buffer.from('</X>')])];
  let calls=0;
  const server=http.createServer((req,res)=>{
    const parts=[];req.on('data',part=>parts.push(part));req.on('end',()=>{
      assert.equal(Buffer.concat(parts).toString(),source.request('VOUCHER','SOLVIAN CONSULTANCY LLP',{kind:'period',from:'2026-06-16',to:'2026-06-22'}));
      const bytes=zlib.gzipSync(cases[calls++]);
      res.writeHead(200,{'Content-Type':'text/xml; charset=utf-8','Content-Encoding':'gzip'});
      res.write(bytes.subarray(0,11));setTimeout(()=>res.end(bytes.subarray(11)),10);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    for(let index=0;index<cases.length;index++){
      const output=path.join(root,String(index));let log='';
      const code=await new Promise((resolve,reject)=>{
        const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'diagnose-voucher-encoding.ps1'),'-TallyUrl',`http://127.0.0.1:${server.address().port}`,'-OutputDirectory',output],{windowsHide:true});
        child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);child.on('error',reject);child.on('exit',resolve);
      });
      assert.equal(code,0,log);
      const report=JSON.parse(fs.readFileSync(path.join(output,'encoding-report.json'),'utf8').replace(/^\uFEFF/,''));
      assert.equal(report.responseComplete,true);assert.equal(report.utf8Valid,index===0);
      assert.deepEqual(fs.readFileSync(path.join(output,'response.bin')),cases[index]);
      assert.equal(report.requestHash,'413d0175013a514534a4451cfd515e7ee7d29f0f41306714f953294239782743');
      if(index===1)assert.equal(report.invalidByteOffset,3);
    }
    assert.equal(calls,2);console.log('PASS: exact production request; compressed raw bytes retained; valid UTF-8 accepted; invalid byte offset located.');
  }finally{server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
