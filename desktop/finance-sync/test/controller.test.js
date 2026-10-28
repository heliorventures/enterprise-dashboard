const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {SyncController}=require('../src/controller');
function setup() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-controller-'));
  const workers=[];
  const controller=new SyncController({stateDirectory:directory,config:{token:'secret'},workerFactory:()=>{
    const worker=new EventEmitter();worker.postMessage=data=>worker.sent=data;worker.kill=()=>worker.emit('exit',1);workers.push(worker);return worker;
  }});
  return {controller,workers,close:()=>fs.rmSync(directory,{recursive:true})};
}
function ready(c,workers) {c.check();const w=workers.at(-1);w.emit('message',{type:'ready',companies:[{externalId:'a',name:'Alpha'},{externalId:'b',name:'Beta'}]});w.emit('exit',0);}

test('Force stop kills only the active worker and period dates are passed through IPC',()=>{
  const {controller:c,workers,close}=setup();
  try {ready(c,workers);c.sync(['a'],'today');assert.equal(workers.at(-1).sent.config.scope.kind,'period');c.cancel();assert.equal(c.phase,'stopping');c.cancel();assert.equal(c.phase,'stopped');assert.equal(c.worker,null);}
  finally {close();}
});
test('manual start discovers companies then starts exactly one sequential sync worker',()=>{
  const {controller:c,workers,close}=setup();
  try {
    assert.equal(workers.length,0);
    c.start();assert.equal(workers.length,1);
    workers[0].emit('message',{type:'ready',companies:[{externalId:'a',name:'Alpha'}]});
    assert.equal(workers.length,1);
    workers[0].emit('exit',0);
    assert.equal(workers.length,2);assert.deepEqual(workers[1].sent.selectedCompanyIds,['a']);
  } finally {close();}
});
test('Stop during discovery prevents the automatic continuation of a user-started sync',()=>{
  const {controller:c,workers,close}=setup();
  try {c.start();c.cancel();workers[0].emit('message',{type:'ready',companies:[{externalId:'a',name:'Alpha'}]});workers[0].emit('exit',0);assert.equal(workers.length,1);assert.equal(c.snapshot().phase,'stopped');}
  finally {close();}
});
test('controller prevents overlapping work and rejects selection outside its latest discovery',()=>{
  const {controller:c,workers,close}=setup();
  try {
    c.check();assert.throws(()=>c.check(),/progress/i);
    workers[0].emit('message',{type:'ready',companies:[{externalId:'a',name:'Alpha'}]});workers[0].emit('exit',0);
    assert.throws(()=>c.sync(['forged']),/company/i);assert.throws(()=>c.sync([]));
    c.sync(['a']);assert.equal(workers[1].sent.selectedCompanyIds[0],'a');assert.throws(()=>c.sync(['a']),/progress/i);
    assert.ok(!JSON.stringify(c.snapshot()).includes('secret'));
  } finally {close();}
});
test('archive saved with reporting failure is an attention result and never a successful sync time',()=>{
  const {controller:c,workers,close}=setup();
  try {
    ready(c,workers);c.sync(['a']);const w=workers.at(-1);
    w.emit('message',{type:'event',event:{event:'source_snapshot_saved',company:'Alpha',coverageStatus:'complete',reportingStatus:'error',records:9}});
    w.emit('message',{type:'event',event:{event:'run_finished',succeeded:1,failed:0}});
    w.emit('message',{type:'done',code:0});w.emit('exit',0);
    assert.equal(c.snapshot().phase,'attention');assert.equal(c.snapshot().lastSuccessfulSync,null);
    assert.equal(c.snapshot().results[0].reportingStatus,'error');
  } finally {close();}
});
test('successful sync persists history and each subsequent check returns all available companies',()=>{
  const {controller:c,workers,close}=setup();
  try {
    ready(c,workers);c.sync(['b']);const w=workers.at(-1);
    w.emit('message',{type:'event',event:{event:'source_snapshot_saved',company:'Beta',coverageStatus:'complete',reportingStatus:'validated',records:9}});
    w.emit('message',{type:'done',code:0});w.emit('exit',0);
    assert.equal(c.snapshot().phase,'complete');assert.ok(c.snapshot().lastSuccessfulSync);
    assert.equal(JSON.parse(fs.readFileSync(path.join(c.stateDirectory,'history.json'))).length,1);
    ready(c,workers);assert.equal(c.snapshot().companies.length,2);
  } finally {close();}
});
test('worker crash invalidates readiness and cancellation never reports full success',()=>{
  const {controller:c,workers,close}=setup();
  try {
    ready(c,workers);c.sync(['a']);c.cancel();assert.equal(workers.at(-1).sent.type,'cancel');
    workers.at(-1).emit('exit',1);
    assert.equal(c.snapshot().phase,'stopped');assert.equal(c.snapshot().lastSuccessfulSync,null);
    assert.throws(()=>c.sync(['a']),/check/i);
  } finally {close();}
});
test('test installers cannot capture or upload accounting data',()=>{
  const {controller:c,workers,close}=setup();
  try {c.config.testBuild=true;ready(c,workers);assert.throws(()=>c.sync(['a']),/test build/i);assert.equal(workers.length,1);}
  finally {close();}
});
test('a later successful batch cannot hide an earlier failed pending upload for the same company',()=>{
  const {controller:c,workers,close}=setup();
  try {
    ready(c,workers);c.sync(['a']);const w=workers.at(-1);
    w.emit('message',{type:'event',event:{event:'source_upload_failed',company:'Alpha',message:'An older capture conflicts with the server.'}});
    w.emit('message',{type:'event',event:{event:'source_snapshot_saved',company:'Alpha',coverageStatus:'complete',reportingStatus:'validated',records:9}});
    w.emit('message',{type:'done',code:1});w.emit('exit',0);
    assert.equal(c.snapshot().results[0].status,'attention');
    assert.match(c.snapshot().results[0].message,/older capture/);
  } finally {close();}
});
test('a run-level readiness error remains visible after the worker reports completion',()=>{
  const {controller:c,workers,close}=setup();
  try {
    ready(c,workers);c.sync(['a']);const w=workers.at(-1);
    w.emit('message',{type:'event',event:{event:'run_failure',message:'A selected company is no longer available. Load it in Tally, then check again.'}});
    w.emit('message',{type:'done',code:1});w.emit('exit',0);
    assert.match(c.snapshot().message,/selected company is no longer available/);
  } finally {close();}
});

const {Scheduler}=require('../src/scheduler');
const {validateSchedule,inWindow,nextRunAt}=require('../src/schedule');
const weekdays={enabled:true,period:'today',startTime:'11:00',endTime:'17:00',days:[1,2,3,4,5],frequencyMinutes:10,companies:[{externalId:'a',name:'Alpha'}]};
test('schedule windows follow configured days and times, including overnight windows',()=>{
  assert.equal(inWindow(weekdays,new Date(2026,9,27,12,0)),true);
  assert.equal(inWindow(weekdays,new Date(2026,9,27,17,0)),false);
  assert.equal(inWindow(weekdays,new Date(2026,9,31,12,0)),false);
  const overnight={...weekdays,startTime:'23:00',endTime:'05:00',days:[5]};
  assert.equal(inWindow(overnight,new Date(2026,9,30,23,30)),true);
  assert.equal(inWindow(overnight,new Date(2026,9,31,2,0)),true);
  assert.equal(inWindow(overnight,new Date(2026,9,31,23,30)),false);
  assert.deepEqual(nextRunAt(weekdays,new Date(2026,9,30,16,55).toISOString(),new Date(2026,9,30,17,5)),new Date(2026,10,2,11,0));
});
test('schedule settings reject unsupported periods, frequencies, times and empty selections',()=>{
  for(const change of [{period:'full'},{frequencyMinutes:7},{startTime:'11:00',endTime:'11:00'},{startTime:'25:00'},{companies:[]},{days:[]},{days:[1,1]}])
    assert.throws(()=>validateSchedule({...weekdays,...change}));
  assert.deepEqual(validateSchedule({...weekdays,enabled:false,companies:[],days:[]}).companies,[]);
});
function scheduled(companies) {
  const context=setup();let clock=new Date(2026,9,27,12,0);
  const scheduler=new Scheduler({controller:context.controller,stateDirectory:context.controller.stateDirectory,now:()=>clock,timers:{setInterval:()=>1,clearInterval:()=>{}}});
  return {...context,scheduler,advance:minutes=>{clock=new Date(clock.getTime()+minutes*60000);},
    save:()=>scheduler.save({...weekdays,startTime:'00:00',endTime:'23:59',days:[0,1,2,3,4,5,6],companies})};
}
function finish(worker,outcome) {
  const id=worker.sent.selectedCompanyIds[0];
  if(outcome==='saved')worker.emit('message',{type:'event',event:{event:'source_snapshot_saved',companyExternalId:id,coverageStatus:'complete',reportingStatus:'validated',periodUpdate:true,records:1}});
  else worker.emit('message',{type:'event',event:{event:'source_capture_failed',companyExternalId:id,error:outcome,diagnostic:{errorCodes:[outcome]}}});
  worker.emit('message',{type:'done',code:outcome==='saved'?0:1});worker.emit('exit',0);
}
test('scheduled companies run separately; failures move on and only data failures pause a company',()=>{
  const {workers,scheduler,advance,save,close}=scheduled([{externalId:'a',name:'Alpha'},{externalId:'b',name:'Beta'}]);
  try {
    save();
    assert.deepEqual(workers[0].sent.selectedCompanyIds,['a']);assert.equal(workers[0].sent.config.scope.kind,'period');
    finish(workers[0],'BATCH_LEDGER_ID_REQUIRED');
    assert.deepEqual(workers[1].sent.selectedCompanyIds,['b']);finish(workers[1],'saved');
    assert.equal(scheduler.running,false);
    scheduler.tick();assert.equal(workers.length,2);
    advance(10);scheduler.tick();finish(workers[2],'BATCH_LEDGER_ID_REQUIRED');finish(workers[3],'ECONNRESET');
    let b=scheduler.snapshot().companies[1];assert.equal(b.last.status,'retry');assert.equal(b.dataFailures,0);
    advance(10);scheduler.tick();finish(workers[4],'BATCH_LEDGER_ID_REQUIRED');finish(workers[5],'saved');
    assert.equal(scheduler.snapshot().companies[0].paused,true);
    advance(10);scheduler.tick();
    assert.equal(workers.length,7);assert.deepEqual(workers[6].sent.selectedCompanyIds,['b']);finish(workers[6],'saved');
    assert.equal(scheduler.resume('a').companies[0].paused,false);
  } finally {close();}
});
test('Stop during a scheduled run cancels the remaining queue and blocks overlapping manual work',()=>{
  const {controller:c,workers,scheduler,save,close}=scheduled([{externalId:'a',name:'Alpha'},{externalId:'b',name:'Beta'}]);
  try {
    save();
    assert.equal(c.snapshot().busy,true);assert.equal(c.snapshot().schedule.current,'Alpha');
    assert.throws(()=>c.check(),/progress|scheduled/i);
    c.cancel();workers[0].emit('exit',1);
    assert.equal(workers.length,1);assert.equal(scheduler.running,false);assert.equal(c.snapshot().phase,'stopped');
  } finally {close();}
});
