// Executed by Electron, using the current packaged application and synthetic services.
const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const https=require('node:https');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {SyntheticTally}=require('./release-tally');
const {validateE2EReport}=require('./release-contract');
const root=path.resolve(__dirname,'../../..');
const output=path.resolve(process.env.RELEASE_TEST_DIR||'.');
const pgdata=path.resolve(process.env.RELEASE_TEST_PGDATA||'.');
const artifacts=path.resolve(__dirname,'../test-artifacts');
assert.ok(output.startsWith(artifacts+path.sep),'Use the release runner: isolated output is required');
assert.equal(pgdata,path.join(output,'pgdata'));
assert.equal(process.env.DB_HOST,'127.0.0.1');assert.equal(process.env.DB_NAME,'enterprise_dashboard_test');
assert.equal(process.env.DB_USER,'finance_release_test');assert.notEqual(process.env.DB_PORT,'5432');
assert.ok(fs.existsSync(path.join(pgdata,'PG_VERSION')));
process.chdir(output); // config.js dotenv must never read repository credentials.
process.env.TALLY_MODE='push';process.env.TALLY_INGEST_TOKEN='RELEASE-E2E-SYNTHETIC-TOKEN-000000000000';
process.env.DASHBOARD_USER='release-test';process.env.DASHBOARD_PASSWORD='release-test-only';
process.env.DASHBOARD_SESSION_SECRET='RELEASE-E2E-SESSION-000000000000000000';process.env.NODE_ENV='test';
app.setPath('userData',path.join(output,'electron-profile'));app.disableHardwareAcceleration();
// A test closes/reopens windows in one Electron host. Keep that host alive until
// evidence is flushed and service cleanup completes; normal app exit is unchanged.
app.on('window-all-closed',()=>{});
const packaged=path.resolve(__dirname,'../release/win-unpacked/resources/app.asar');
assert.ok(process.argv.includes('--packaged')&&fs.existsSync(packaged),'A verified package is required');
const {createDesktop}=require(path.join(packaged,'src/desktop.js'));
const report={version:require(path.join(packaged,'package.json')).version,startedAt:new Date().toISOString(),
  environment:'synthetic Tally; real loopback API and isolated PostgreSQL; packaged desktop modules',
  scenarios:[],resourceSamples:[],manualGates:['Windows installation and upgrade','Real Tally response compatibility and responsiveness','Dashboard browser acceptance']};
let desktop,db,apiServer,tally,sampleTimer;
const apiRequests=[];let apiFault=null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,timeoutMs=60000) {
  const deadline=performance.now()+timeoutMs;
  while(!predicate()){if(performance.now()>deadline)throw new Error('Timed out waiting for fault injection point');await sleep(25);}
}
function waitState(predicate,timeoutMs=120000) {
  const controller=desktop.controller;
  if(predicate(controller.snapshot()))return Promise.resolve(controller.snapshot());
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{controller.off('state',check);reject(new Error(`State timeout: ${JSON.stringify(controller.snapshot())}`));},timeoutMs);
    function check(state){if(predicate(state)){clearTimeout(timer);controller.off('state',check);resolve(state);}}
    controller.on('state',check);
  });
}
const js=script=>desktop.window.webContents.executeJavaScript(script);
const calendar=d=>`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
const iso=d=>`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6)}`;
const todayDate=new Date(),today=calendar(todayDate);
const previous=calendar(new Date(todayDate.getFullYear(),todayDate.getMonth()-1,15));
const first=calendar(new Date(todayDate.getFullYear(),todayDate.getMonth(),1));
const row=(id,date,amount)=>({id,date,amount});
const alpha={id:'release-alpha',name:'Release Alpha & Co',vouchers:[row('today',today,'100.25'),row('previous',previous,'20.10')]};
if(first!==today)alpha.vouchers.push(row('month-start',first,'25.35'));
const beta={id:'release-beta',name:'Release Beta',vouchers:[row('beta',today,'9.90')]};
// Fixed ledger snapshots are independent of period voucher totals. These are
// authoritative master balances, not balances calculated by the test from imports.
alpha.ledgers=[{name:'Sales',parent:'Sales Accounts',balance:'250.50'},{name:'Bank',parent:'Bank Accounts',balance:'-710.25'},{name:'Rent',parent:'Indirect Expenses',balance:'-40.25'}];
beta.ledgers=[{name:'Sales',parent:'Sales Accounts',balance:'99.99'},{name:'Bank',parent:'Bank Accounts',balance:'-310.10'}];
async function vouchers(company=alpha.id) {
  return (await db.query(`SELECT v."VoucherNumber" AS id,v."VoucherDate" AS date,v."Amount"::text AS amount,v."Source" AS source
    FROM "Vouchers" v JOIN "Companies" c USING("CompanyID") WHERE c."ExternalID"=$1 ORDER BY v."VoucherNumber"`,[company])).rows;
}
function expected(rows,manual=true) {
  return [...rows.map(v=>({id:v.id,date:iso(v.date),amount:Number(v.amount).toFixed(2),source:'tally'})),
    ...(manual?[{id:'manual',date:iso(today),amount:'7.77',source:'manual'}]:[])].sort((a,b)=>a.id.localeCompare(b.id));
}
async function checkRows(rows,company=alpha.id,manual=true) {assert.deepEqual(await vouchers(company),expected(rows,manual));}
async function run(mode='full',ids) {
  if(ids){
    await js("document.getElementById('check').click()");await waitState(s=>!s.busy&&s.phase==='ready');
    const result=await js(`window.financeSync.sync(${JSON.stringify(ids)},${JSON.stringify(mode)})`);assert.equal(result.ok,true);
  } else {
    await js(`document.getElementById('period').value=${JSON.stringify(mode)}`);
    await js("document.getElementById('sync').click()");
  }
  return waitState(s=>!s.busy&&!['idle','ready'].includes(s.phase));
}
async function successful(mode,ids) {const state=await run(mode,ids);assert.equal(state.phase,'complete',JSON.stringify(state));return state;}
async function scenario(name,work) {
  const started=performance.now(),requestStart=tally?.requests.length||0;
  const result={name,status:'running'};report.scenarios.push(result);
  try {await work(result);result.status='passed';}
  catch(error){result.status='failed';result.error=error.stack;throw error;}
  finally {result.durationMs=Math.round(performance.now()-started);result.tallyRequests=(tally?.requests.length||0)-requestStart;console.log(`${result.status}: ${name} (${result.durationMs} ms)`);}
}
async function unchangedFailure(kind,type='Group') {
  const before=await vouchers();const betaBefore=await vouchers(beta.id);
  tally.fault={kind,type};const state=await run('full');assert.equal(state.phase,'attention',JSON.stringify(state));
  assert.deepEqual(await vouchers(),before);assert.deepEqual(await vouchers(beta.id),betaBefore);
  const count=tally.requests.length;await sleep(1000);assert.equal(tally.requests.length,count,'No automatic retry after failure');
  assert.equal(tally.requests.at(-1).company,alpha.name,'Failed Alpha must not start Beta');tally.fault=null;
}
async function main() {
  db=require(path.join(root,'api/src/db'));
  const actual=(await db.query('SHOW data_directory')).rows[0].data_directory;
  assert.equal(path.resolve(actual).toLowerCase(),pgdata.toLowerCase(),'Database must belong to this test run');
  await db.migrate();
  await db.query('TRUNCATE tally_source_uploads,tally_source_snapshots,tally_ingestions,"Vouchers","Projects","Ledgers","Companies","SyncLog" RESTART IDENTITY CASCADE');
  const api=require(path.join(root,'api/src/server')).app;
  apiServer=https.createServer({key:fs.readFileSync(path.join(output,'test-api-key.pem')),cert:fs.readFileSync(path.join(output,'test-api-cert.pem'))},(req,res)=>{
    const observation={path:req.url,method:req.method,at:performance.now(),status:null,sha256:null};apiRequests.push(observation);
    const hash=createHash('sha256');req.on('data',chunk=>hash.update(chunk));req.on('end',()=>observation.sha256=hash.digest('hex'));
    res.once('finish',()=>observation.status=res.statusCode);
    if(apiFault?.kind==='chunk'&&req.url.endsWith('/chunk')){observation.injected='503';res.writeHead(503);req.resume();res.end('Synthetic API outage');return;}
    if(apiFault?.kind==='hold-chunk'&&req.url.endsWith('/chunk')){observation.injected='held-chunk';req.resume();return;}
    if(apiFault?.kind==='drop-complete'&&req.url.endsWith('/complete')){
      observation.injected='response-lost-after-commit';apiFault=null;
      res.end=()=>{observation.status=res.statusCode;res.destroy();return res;};
    }
    api(req,res);
  });
  await new Promise(resolve=>apiServer.listen(0,'127.0.0.1',resolve));
  const apiUrl=`https://127.0.0.1:${apiServer.address().port}`;
  tally=new SyntheticTally([alpha,beta]);const tallyUrl=await tally.listen();
  const stateDirectory=path.join(output,'desktop-state');
  const desktopConfig={apiUrl,tallyUrl,token:process.env.TALLY_INGEST_TOKEN,requestTimeoutMs:30000,testBuild:false};
  desktop=await createDesktop({show:false,stateDirectory,config:desktopConfig});
  sampleTimer=setInterval(()=>{
    const processes=app.getAppMetrics().map(p=>({type:p.type,name:p.name||null,pid:p.pid,cpuPercent:p.cpu.percentCPUUsage,workingSetKiB:p.memory.workingSetSize}));
    report.resourceSamples.push({elapsedMs:Math.round(performance.now()),processes});
  },500);
  await scenario('Passive startup and installed version',async()=>{
    await sleep(1500);assert.equal(tally.requests.length,0);assert.equal(apiRequests.length,0);
    assert.equal(await js("document.getElementById('app-version').textContent"),`v${report.version}`);
  });
  await scenario('First Today sync without full baseline, two sequential companies',async()=>{
    await successful('today');await checkRows([alpha.vouchers[0]],alpha.id,false);await checkRows(beta.vouchers,beta.id,false);
    const order=tally.requests.filter(r=>r.company).map(r=>r.company);const betaIndex=order.indexOf(beta.name);
    assert.ok(betaIndex>0);assert.ok(order.slice(betaIndex).every(c=>c===beta.name),'Companies cannot overlap or interleave');
    const coverage=(await db.query('SELECT coverage FROM finance_snapshots WHERE company_id=(SELECT "CompanyID" FROM "Companies" WHERE "ExternalID"=$1)',[alpha.id])).rows[0].coverage;
    assert.equal(coverage.history.kind,'periods');
    await db.query(`INSERT INTO "Vouchers"("CompanyID","VoucherDate","VoucherType","Amount","VoucherNumber","Source") SELECT "CompanyID",$2,'Sales',7.77,'manual','manual' FROM "Companies" WHERE "ExternalID"=$1`,[alpha.id,iso(today)]);
  });
  await scenario('Full sync restores complete history and preserves manual entries',async()=>{
    await successful('full');await checkRows(alpha.vouchers);await checkRows(beta.vouchers,beta.id,false);
  });
  await scenario('Month replacement changes exact amounts and preserves other company/history',async()=>{
    alpha.vouchers=alpha.vouchers.map(v=>v.id==='today'?{...v,amount:'150.55'}:v);
    await successful('current-month',[alpha.id]);await checkRows(alpha.vouchers);await checkRows(beta.vouchers,beta.id,false);
  });
  await scenario('Empty Today replacement deletes omitted vouchers only in that day',async()=>{
    alpha.vouchers=alpha.vouchers.filter(v=>v.date!==today);
    await successful('today',[alpha.id]);await checkRows(alpha.vouchers);await checkRows(beta.vouchers,beta.id,false);
  });
  await scenario('Last month replacement and a voucher moved into Today reconcile both dates',async()=>{
    alpha.vouchers=alpha.vouchers.map(v=>v.id==='previous'?{...v,date:today,amount:'33.33'}:v);
    await successful('last-month',[alpha.id]);
    await checkRows(alpha.vouchers.filter(v=>v.id!=='previous'));
    await successful('today',[alpha.id]);await checkRows(alpha.vouchers);
  });
  await scenario('Full replacement removes omitted history',async()=>{
    alpha.vouchers=[row('fresh',today,'50.50')];await successful('full',[alpha.id]);await checkRows(alpha.vouchers);
  });
  await scenario('Malformed voucher response preserves published data and stops next company',()=>unchangedFailure('malformed','Voucher'));
  await scenario('Disconnected Tally preserves data without automatic retry',()=>unchangedFailure('disconnect'));
  await scenario('Tally HTTP failure preserves data without automatic retry',()=>unchangedFailure('http'));
  await scenario('Slow Tally export times out without changing Finance',async()=>{
    desktop.controller.config.requestTimeoutMs=1200;
    try {await unchangedFailure('hold');}finally {desktop.controller.config.requestTimeoutMs=30000;tally.fault=null;}
  });
  await scenario('Stop aborts an in-flight export and sends no further requests',async result=>{
    const before=await vouchers();tally.fault={kind:'hold',type:'Group'};
    const requestStart=tally.requests.length;
    const operation=run('full');await until(()=>tally.requests.slice(requestStart).some(r=>r.type==='Group'));
    const start=performance.now();await js("document.getElementById('stop').click()");
    const state=await operation;assert.equal(state.phase,'stopped');result.stopLatencyMs=Math.round(performance.now()-start);
    assert.ok(result.stopLatencyMs<5000,'Stop must terminate our worker within a bounded deadline');
    const count=tally.requests.length;await sleep(1000);assert.equal(tally.requests.length,count);assert.deepEqual(await vouchers(),before);tally.fault=null;
  });
  await scenario('Failed upload retains data; manual retry resends the exact saved payload',async()=>{
    alpha.vouchers=[row('recovered',today,'71.25')];const before=await vouchers();apiFault={kind:'chunk'};
    const state=await run('full',[alpha.id]);assert.equal(state.phase,'attention');assert.deepEqual(await vouchers(),before);
    const failed=apiRequests.findLast(r=>r.injected==='503');assert.ok(failed.sha256);
    const count=apiRequests.length;await sleep(1000);assert.equal(apiRequests.length,count,'No automatic upload retry');
    apiFault=null;await successful('full',[alpha.id]);await checkRows(alpha.vouchers);
    assert.ok(apiRequests.slice(count).some(r=>r.path===failed.path&&r.sha256===failed.sha256&&r.status===200),'Retry must resend immutable saved chunk');
  });
  await scenario('Lost acknowledgement after commit remains idempotent on manual retry',async()=>{
    alpha.vouchers=[row('acknowledged',today,'82.35')];apiFault={kind:'drop-complete'};
    const state=await run('full',[alpha.id]);assert.equal(state.phase,'attention');await checkRows(alpha.vouchers);
    await successful('full',[alpha.id]);await checkRows(alpha.vouchers);
  });
  await scenario('Worker termination during upload survives app reopen and manual recovery',async()=>{
    const before=await vouchers();alpha.vouchers=[row('after-crash',today,'93.45')];apiFault={kind:'hold-chunk'};
    const start=apiRequests.length;const operation=run('full',[alpha.id]);
    await until(()=>apiRequests.slice(start).some(r=>r.injected==='held-chunk'));
    desktop.controller.worker.kill();const state=await operation;assert.equal(state.phase,'error');
    assert.deepEqual(await vouchers(),before);assert.ok(desktop.controller.snapshot().pending.count>0);
    apiFault=null;desktop.window.destroy();desktop=await createDesktop({show:false,stateDirectory,config:desktopConfig});
    const calls=apiRequests.length;await sleep(1000);assert.equal(apiRequests.length,calls);
    await successful('full',[alpha.id]);await checkRows(alpha.vouchers);
  });
  await scenario('Large synthetic export has exact count and decimal total',async result=>{
    const count=Number(process.env.RELEASE_TEST_VOUCHERS||10000);assert.ok(Number.isInteger(count)&&count>=1000&&count<=100000);
    alpha.vouchers=Array.from({length:count},(_,i)=>row(`load-${String(i).padStart(6,'0')}`,today,'1.23'));
    const from=apiRequests.length;await successful('full',[alpha.id]);
    const totals=(await db.query(`SELECT count(*)::int AS count,sum(v."Amount")::text AS amount FROM "Vouchers" v JOIN "Companies" c USING("CompanyID") WHERE c."ExternalID"=$1 AND v."Source"='tally'`,[alpha.id])).rows[0];
    assert.equal(totals.count,count);assert.equal(totals.amount,(count*123/100).toFixed(2));
    const postings=(await db.query(`SELECT count(*)::int AS count,sum(amount)::text AS net FROM finance_postings WHERE company_id=(SELECT "CompanyID" FROM "Companies" WHERE "ExternalID"=$1)`,[alpha.id])).rows[0];
    assert.equal(postings.count,count*2);assert.equal(Number(postings.net),0);
    const chunks=apiRequests.slice(from).filter(r=>r.path.endsWith('/chunk'));assert.ok(chunks.length>1);
    result.vouchers=count;result.chunks=chunks.length;result.expectedTotal=totals.amount;
  });
  await scenario('Authenticated dashboard exposes published coverage and company isolation',async()=>{
    assert.equal((await fetch(apiUrl+'/api/dashboard')).status,401);
    const login=await fetch(apiUrl+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'release-test',password:'release-test-only'})});
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const response=await fetch(apiUrl+'/api/dashboard',{headers:{cookie}});assert.equal(response.status,200);const dashboard=await response.json();
    assert.equal(dashboard.companyFinancials.length,2);
    assert.ok(dashboard.companyFinancials.every(c=>c.historyCoverage?.kind==='full'));
    const a=dashboard.companyFinancials.find(c=>c.name===alpha.name),b=dashboard.companyFinancials.find(c=>c.name===beta.name);
    assert.equal(a.revenue,250.50);assert.equal(a.expenses,40.25);assert.equal(a.profit,210.25);assert.equal(a.cashAndBank,710.25);assert.equal(a.ledgerCount,3);
    assert.equal(b.revenue,99.99);assert.equal(b.cashAndBank,310.10);assert.equal(b.ledgerCount,2);
    await checkRows(beta.vouchers,beta.id,false);
    fs.writeFileSync(path.join(output,'dashboard-response.json'),JSON.stringify(dashboard,null,2));
    const screenshot=await desktop.window.webContents.capturePage();fs.writeFileSync(path.join(output,'desktop-complete.png'),screenshot.toPNG());
  });
  await scenario('Reopening shows history and remains passive',async()=>{
    const calls=tally.requests.length,uploads=apiRequests.length;desktop.window.destroy();
    desktop=await createDesktop({show:false,stateDirectory,config:desktopConfig});await sleep(1500);
    assert.equal(tally.requests.length,calls);assert.equal(apiRequests.length,uploads);assert.ok(desktop.controller.snapshot().history.length>0);
    assert.ok(desktop.controller.snapshot().lastSuccessfulSync);
  });
  await scenario('Wire evidence proves serial requests, pacing and bounded voucher windows',async result=>{
    assert.equal(tally.maxActive,1);
    assert.ok(tally.requests.every(r=>r.requestKind==='Export'),'Tally requests must only export data');
    for(const r of tally.requests.filter(r=>r.company&&r.type!=='Voucher')){
      assert.equal(r.from,'19010101','Master collections retain full date context');assert.equal(r.to,'99991231');
    }
    const scoped=tally.requests.filter(r=>r.type==='Voucher'&&!r.dateOnly);
    for(const r of scoped){const days=(Date.parse(iso(r.to))-Date.parse(iso(r.from)))/86400000+1;assert.ok(days>=1&&days<=7);}
    // Exclude discovery/check requests: these intentionally have no company context.
    const gaps=tally.requests.slice(1).flatMap((r,i)=>r.company&&tally.requests[i].company&&tally.requests[i].finished!==null?[r.started-tally.requests[i].finished]:[]);
    assert.ok(gaps.length>0);assert.ok(Math.min(...gaps)>=450,'Configured 500 ms request pacing must be observable (50 ms clock allowance)');
    result.maxConcurrentTallyRequests=tally.maxActive;result.minimumObservedGapMs=Math.round(Math.min(...gaps));result.detailWindows=scoped.length;
  });
}
async function cleanup() {
  clearInterval(sampleTimer);
  if(desktop?.controller.worker){desktop.controller.cancel();desktop.controller.worker?.kill();}
  desktop?.window.destroy();
  await tally?.close();
  if(apiServer){apiServer.closeAllConnections();await new Promise(resolve=>apiServer.close(resolve));}
  await db?.close();
  report.finishedAt=new Date().toISOString();report.passed=!report.error&&report.scenarios.length>0&&report.scenarios.every(s=>s.status==='passed');
  try {validateE2EReport(report);}catch(error){report.passed=false;report.error||=error.message;}
  report.measurementNotes='500 ms sampled Electron process metrics; Browser process includes synthetic Tally and API. Utility process identifies the sync worker. Measurements are observations, not production performance thresholds.';
  fs.writeFileSync(path.join(output,'e2e-report.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(output,'tally-requests.json'),JSON.stringify(tally?.requests||[],null,2));
  fs.writeFileSync(path.join(output,'api-requests.json'),JSON.stringify(apiRequests,null,2));
}
app.whenReady().then(main).then(async()=>{await cleanup();app.exit(report.passed?0:1);}).catch(async error=>{
  report.error=error.stack;console.error(error.stack);try{await cleanup();}catch(e){console.error(e.stack);}app.exit(1);
});
