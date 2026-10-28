const fs=require('node:fs');
const path=require('node:path');
const {DEFAULT_SCHEDULE,validateSchedule,inWindow,nextRunAt}=require('./schedule');
const DATA_FAILURE_LIMIT=3;
function readJson(file,fallback) {try {return JSON.parse(fs.readFileSync(file,'utf8'));} catch {return fallback;}}
function writeJson(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(file+'.tmp',file);
}
// Each scheduled company is a separate engine run, so one failure never blocks the rest of the queue.
class Scheduler {
  constructor({controller,stateDirectory,now=()=>new Date(),timers={setInterval,clearInterval},applyLoginItem=()=>{}}) {
    Object.assign(this,{controller,now,timers,applyLoginItem,queue:null,current:null,timer:null});
    this.settingsFile=path.join(stateDirectory,'schedule.json');this.statusFile=path.join(stateDirectory,'schedule-state.json');
    try {this.settings=validateSchedule({...DEFAULT_SCHEDULE,...readJson(this.settingsFile,{})});}
    catch {this.settings={...DEFAULT_SCHEDULE,enabled:false};}
    const status=readJson(this.statusFile,{});
    this.status={lastRunAt:typeof status?.lastRunAt==='string'?status.lastRunAt:null,
      companies:status?.companies&&typeof status.companies==='object'&&!Array.isArray(status.companies)?status.companies:{}};
    controller.schedule=this;
    controller.on('finished',result=>this.finished(result));
  }
  get running() {return !!this.queue||!!this.current;}
  start() {
    try {this.applyLoginItem(this.settings.enabled);} catch { /* Sign-in startup is optional; the schedule still runs while open. */ }
    this.timer=this.timers.setInterval(()=>this.tick(),30000);this.tick();
  }
  stop() {this.timers.clearInterval(this.timer);this.timer=null;this.queue=null;}
  save(input) {
    const settings=validateSchedule(input);
    writeJson(this.settingsFile,settings);this.settings=settings;
    try {this.applyLoginItem(settings.enabled);} catch { /* Sign-in startup is optional; the schedule still runs while open. */ }
    this.controller.changed();this.tick();
    return this.snapshot();
  }
  resume(externalId) {
    const entry=this.status.companies[externalId];
    if(entry){Object.assign(entry,{paused:false,dataFailures:0});this.persist();}
    this.controller.changed();
    return this.snapshot();
  }
  cancelQueue() {
    if(!this.queue)return false;
    this.queue=null;return true;
  }
  tick() {
    const settings=this.settings,controller=this.controller;
    if(!settings.enabled||this.running||controller.worker||controller.config.testBuild)return;
    const now=this.now();
    if(!inWindow(settings,now))return;
    if(this.status.lastRunAt&&now-Date.parse(this.status.lastRunAt)<settings.frequencyMinutes*60000)return;
    this.status.lastRunAt=now.toISOString();this.persist();
    this.queue=settings.companies.filter(company=>!this.status.companies[company.externalId]?.paused);
    this.next();
  }
  next() {
    while(this.queue?.length) {
      const company=this.queue.shift();this.current=company;
      try {this.controller.syncScheduled(company,this.settings.period);if(this.controller.worker)return;}
      catch { /* Recorded below as an application failure for this company only. */ }
      this.record(company,{phase:'error',failureKind:'data',message:'The scheduled sync could not start for this company.'});
    }
    this.queue=null;this.current=null;this.controller.changed();
  }
  finished(result) {
    if(result.origin!=='schedule'||!this.current)return;
    const company=this.current;this.current=null;
    if(result.phase==='stopped'){this.queue=null;this.controller.changed();return;}
    this.record(company,result);
    this.next();
  }
  record(company,{phase,failureKind,message}) {
    const at=this.now().toISOString(),entry=this.status.companies[company.externalId]||{dataFailures:0,paused:false};
    const text=typeof message==='string'?message.slice(0,500):undefined;
    if(phase==='complete')Object.assign(entry,{dataFailures:0,paused:false,last:{at,status:'complete'}});
    else if(failureKind==='temporary')entry.last={at,status:'retry',message:text};
    else {entry.dataFailures=(entry.dataFailures||0)+1;entry.paused=entry.dataFailures>=DATA_FAILURE_LIMIT;entry.last={at,status:entry.paused?'paused':'failed',message:text};}
    entry.name=company.name;this.status.companies[company.externalId]=entry;this.persist();
  }
  persist() {
    try {writeJson(this.statusFile,this.status);}
    catch { /* Keep scheduling when local status cannot be saved. */ }
  }
  snapshot() {
    return {settings:this.settings,running:this.running,current:this.current?.name||null,lastRunAt:this.status.lastRunAt,
      nextRunAt:this.running?null:nextRunAt(this.settings,this.status.lastRunAt,this.now())?.toISOString()||null,
      dataFailureLimit:DATA_FAILURE_LIMIT,
      companies:this.settings.companies.map(company=>{
        const entry=this.status.companies[company.externalId]||{};
        return {externalId:company.externalId,name:company.name,paused:entry.paused===true,dataFailures:entry.dataFailures||0,last:entry.last||null};
      })};
  }
}
module.exports={Scheduler,DATA_FAILURE_LIMIT};
