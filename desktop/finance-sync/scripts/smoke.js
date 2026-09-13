// Runs the actual window, preload, controller and worker against synthetic Tally.
// The window remains hidden and no production API is contacted.
const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const artifacts=path.resolve(__dirname,'../test-artifacts');
fs.mkdirSync(artifacts,{recursive:true});
const runtime=fs.mkdtempSync(path.join(artifacts,'smoke-'));
app.setPath('userData',runtime);app.disableHardwareAcceleration();
const packaged=process.argv.includes('--packaged');
const sourceRoot=packaged?path.resolve(__dirname,'../release/win-unpacked/resources/app.asar'):path.resolve(__dirname,'..');
const {createDesktop}=require(path.join(sourceRoot,'src/desktop.js'));
const xml='<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="Solvian Consulting"><NAME>Solvian Consulting</NAME><GUID>solvian-guid</GUID></COMPANY><COMPANY NAME="Northstar Trading"><NAME>Northstar Trading</NAME><GUID>northstar-guid</GUID></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>';
let empty=false,hold=false;
const server=http.createServer((req,res)=>{
  req.resume();req.on('end',()=>{
    const reply=()=>{if(!res.destroyed){res.writeHead(200,{'Content-Type':'application/xml'});res.end(empty?'<ENVELOPE><BODY><DATA><COLLECTION/></DATA></BODY></ENVELOPE>':xml);}};
    if(hold){const timer=setTimeout(reply,15000);res.on('close',()=>clearTimeout(timer));}else reply();
  });
});
function waitFor(controller,predicate) {
  if(predicate(controller.snapshot()))return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{controller.off('state',check);reject(new Error('Desktop state timed out'));},20000);
    const check=state=>{if(predicate(state)){clearTimeout(timeout);controller.off('state',check);resolve();}};
    controller.on('state',check);
  });
}
let desktop;
app.whenReady().then(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  desktop=await createDesktop({show:false,stateDirectory:path.join(runtime,'state'),config:{apiUrl:'https://finance-sync-test.invalid',token:'TEST-ONLY-NOT-A-REAL-INGESTION-TOKEN-000000',tallyUrl:`http://127.0.0.1:${server.address().port}`,requestTimeoutMs:1000,testBuild:false}});
  const {window,controller}=desktop;
  const errors=[];window.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
  const js=script=>window.webContents.executeJavaScript(script);
  await waitFor(controller,s=>s.phase==='ready'&&!s.busy);
  assert.equal(await js("document.querySelectorAll('#companies input:checked').length"),2);
  assert.equal(await js("typeof require"),'undefined');
  assert.equal(await js("typeof process"),'undefined');
  assert.equal(await js("document.getElementById('sync').disabled"),false);
  const screenshot=await window.webContents.capturePage();fs.writeFileSync(path.join(artifacts,packaged?'packaged-ready.png':'ready.png'),screenshot.toPNG());
  await js("document.getElementById('select-all').click()");
  assert.equal(await js("document.getElementById('sync').disabled"),true);
  const forged=await js("window.financeSync.sync(['not-discovered'])");assert.equal(forged.ok,false);
  await js("document.querySelector('#companies input').click()");
  assert.equal(await js("document.getElementById('selected-count').textContent"),'1 selected');
  hold=true;
  await js("document.getElementById('sync').click()");
  await waitFor(controller,s=>s.phase==='syncing'&&s.busy);
  assert.equal(await js("document.getElementById('sync').disabled"),true);
  await js("document.getElementById('stop').click()");
  await waitFor(controller,s=>s.phase==='stopped'&&!s.busy);
  assert.equal(controller.snapshot().lastSuccessfulSync,null);
  hold=false;empty=true;
  await js("document.getElementById('check').click()");
  await waitFor(controller,s=>s.phase==='error'&&!s.busy);
  assert.match(await js("document.getElementById('message').textContent"),/No company/);
  assert.equal(await js("document.getElementById('sync').disabled"),true);
  empty=false;
  await js("document.getElementById('check').click()");
  await waitFor(controller,s=>s.phase==='ready'&&!s.busy);
  assert.equal(await js("document.querySelectorAll('#companies input:checked').length"),2);
  assert.deepEqual(errors,[]);
  controller.config.testBuild=true;controller.changed();
  assert.equal(await js("document.getElementById('sync').disabled"),true);
  assert.equal((await js("window.financeSync.sync(['solvian-guid'])")).ok,false);
  console.log(`${packaged?'Packaged':'Source'} Electron smoke passed: worker readiness, isolated renderer, selection, overlap prevention, cancellation, empty-company error and reset.`);
  window.destroy();server.closeAllConnections();server.close();app.exit(0);
}).catch(error=>{console.error(error.stack);desktop?.window.destroy();server.closeAllConnections();server.close();app.exit(1);});
