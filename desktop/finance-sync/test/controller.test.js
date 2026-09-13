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
