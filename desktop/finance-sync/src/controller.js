const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {validateSelection,pendingSummary,readHistory,saveHistory}=require('./state');
const {publicEvent}=require('./events');
const {scopeFor}=require('./period');
class SyncController extends EventEmitter {
  constructor({config,stateDirectory,workerFactory}) {
    super();this.config=config;this.stateDirectory=stateDirectory;this.workerFactory=workerFactory;
    this.phase='idle';this.companies=[];this.results=[];this.events=[];this.worker=null;this.message='No connection has been made. Click Sync now when Tally is ready.';
    this.history=readHistory(stateDirectory);this.startedAt=null;this.current=null;this.discoveryVersion=0;
  }
  snapshot() {
    return {phase:this.phase,busy:!!this.worker,message:this.message,companies:this.companies,results:this.results,current:this.current,
      discoveryVersion:this.discoveryVersion,startedAt:this.startedAt,scope:this.scope||null,testBuild:this.config.testBuild===true,
      pending:pendingSummary(this.stateDirectory),history:this.history.map(({at,phase,results})=>({at,phase,results})).slice(-10).reverse(),
      lastSuccessfulSync:[...this.history].reverse().find(h=>h.phase==='complete')?.at||null};
  }
  changed(){this.emit('state',this.snapshot());}
  start(mode='full') {
    if(this.config.testBuild)throw new Error('This is a test build. Use Check connection only.');
    if(this.worker)throw new Error('An operation is already in progress.');
    this.scope=scopeFor(mode);this.check(true);
  }
  check(autoSync=false) {
    if(this.worker)throw new Error('An operation is already in progress.');
    this.autoSync=autoSync;this.events=[];
    this.results=[];this.current=null;this.startedAt=null;
    this.companies=[];this.phase='checking';this.message='Checking Tally for accessible companies…';
    this.launch('check');
  }
  sync(ids,mode) {
    if(this.config.testBuild)throw new Error('This is a test build. Ask your administrator for a configured installer to sync data.');
    if(this.worker)throw new Error('An operation is already in progress.');
    if(this.phase!=='ready')throw new Error('Check the Tally connection again before starting another sync.');
    const selectedCompanyIds=validateSelection(ids,this.companies);
    if(mode!==undefined)this.scope=scopeFor(mode);
    this.results=selectedCompanyIds.map(id=>({externalId:id,company:this.companies.find(c=>c.externalId===id).name,status:'waiting'}));
    this.events=[];this.current=null;this.runFailureMessage=null;this.startedAt=new Date().toISOString();this.phase='syncing';this.message='Checking selected companies before synchronization…';
    this.launch('sync',selectedCompanyIds);
  }
  launch(type,selectedCompanyIds) {
    this.cancelRequested=false;this.completed=false;this.operation=type;
    let worker;
    try {
      const logs=path.join(this.stateDirectory,'logs');fs.mkdirSync(logs,{recursive:true});
      this.journal=path.join(logs,`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.jsonl`);
      this.writeJournal({event:'operation_started',operation:type,scope:this.scope||{kind:'full'}});
      worker=this.workerFactory();this.worker=worker;
    }
    catch {this.phase='error';this.message='The sync engine could not start. Reinstall Finance Sync or contact your administrator.';this.changed();return;}
    worker.on('message',data=>{if(this.worker===worker)this.receive(data);});
    worker.on('exit',()=>{
      if(this.worker!==worker)return;
      clearTimeout(this.stopTimer);this.worker=null;
      if(this.cancelRequested){this.autoSync=false;this.phase='stopped';this.message='Our sync process stopped. Tally may still be finishing an export it already accepted.';}
      if(!this.completed){this.phase=this.cancelRequested?'stopped':'error';this.message=this.cancelRequested?'Sync stopped. Saved uploads are retained for retry.':'The sync engine stopped unexpectedly. Check again to retry; saved uploads are retained.';}
      this.writeJournal({event:'worker_exited',phase:this.phase});
      if(type==='check'&&this.autoSync&&this.completed&&this.phase==='ready'&&!this.cancelRequested){this.autoSync=false;this.sync(this.companies.map(c=>c.externalId));return;}
      if(type==='sync'||this.phase==='error'||this.phase==='stopped') {
        for(const row of this.results)if(row.status==='waiting'||row.status==='working')row.status=this.cancelRequested?'stopped':'failed';
        try {this.history=saveHistory(this.stateDirectory,{at:new Date().toISOString(),phase:this.phase,results:this.results,events:this.events});}
        catch {this.message+=' Unable to save local history. Contact your administrator.';}
      }
      this.changed();
    });
    this.changed();
    worker.postMessage({type,config:{...this.config,scope:this.scope},stateDirectory:this.stateDirectory,selectedCompanyIds});
  }
  receive(data) {
    this.writeJournal(data.type==='event'?data.event:data.type==='failure'?{event:'operation_failed',message:data.message}: {event:`worker_${data.type}`});
    if(data.type==='ready') {
      this.completed=true;this.companies=data.companies;this.discoveryVersion++;this.phase='ready';
      this.message=`${this.companies.length} ${this.companies.length===1?'company is':'companies are'} available. Uncheck any company you want to skip.`;
    } else if(data.type==='failure') {
      this.completed=true;this.phase=this.cancelRequested?'stopped':'error';this.message=data.message;
      if(data.diagnostic)this.events.push(data.diagnostic);
    } else if(data.type==='event') {
      const event=publicEvent(data.event);
      // The worker has already mapped errors to user-safe messages.
      if(typeof data.event.message==='string')event.message=data.event.message;
      this.events.push(event);if(this.events.length>500)this.events.shift();
      this.current=event;
      const row=this.results.find(r=>event.companyExternalId?r.externalId===event.companyExternalId:r.company===event.company);
      if(row) {
        if(event.event==='source_snapshot_saved')Object.assign(row,{status:!row.uploadFailure&&(event.coverageStatus==='complete'||event.periodUpdate)&&event.reportingStatus==='validated'?'complete':'attention',coverageStatus:event.coverageStatus,reportingStatus:event.reportingStatus,periodUpdate:event.periodUpdate,records:event.records});
        else if(['source_upload_failed','source_capture_failed'].includes(event.event))Object.assign(row,{status:'failed',uploadFailure:true,message:event.message});
        else if(event.event==='source_collection_failed'){row.partial=true;row.message=event.message;}
        else if(event.event!=='source_company_skipped'&&row.status==='waiting')row.status='working';
      }
      if(event.event==='run_failure'){this.runFailureMessage=event.message;this.message=event.message;}
      if(event.event==='run_cancelled')this.cancelRequested=true;
    } else if(data.type==='done') {
      this.completed=true;
      this.phase=this.cancelRequested?'stopped':data.code===0&&this.results.length&&this.results.every(r=>r.status==='complete')?'complete':'attention';
      this.message=this.phase==='complete'?'All selected companies were uploaded and dashboard processing was validated.':this.phase==='stopped'?'Sync stopped. Completed captures are retained for retry.':data.code===2?'Another sync is already using this data folder. Wait for it to finish.':this.runFailureMessage||'Sync finished with items that need attention. Review each company below.';
    }
    if(['ready','failure','done'].includes(data.type))this.worker?.postMessage({type:'shutdown'});
    this.changed();
  }
  cancel() {
    if(!this.worker)return;
    this.autoSync=false;
    if(this.cancelRequested){this.writeJournal({event:'force_stop_requested'});this.worker.kill();return;}
    this.cancelRequested=true;this.phase='stopping';this.message='Stopping safely. Saved uploads will be kept for retry…';
    this.worker.postMessage({type:'cancel'});
    this.writeJournal({event:'stop_requested'});
    clearTimeout(this.stopTimer);this.stopTimer=setTimeout(()=>this.worker?.kill(),2000);this.stopTimer.unref?.();this.changed();
  }
  writeJournal(event) {
    if(!this.journal)return;
    try {fs.appendFileSync(this.journal,JSON.stringify({at:new Date().toISOString(),...event})+'\n');}
    catch { /* Preserve Stop availability even if storage becomes unavailable. */ }
  }
  diagnostics(){return {application:'Helior Finance Sync',at:new Date().toISOString(),phase:this.phase,pending:pendingSummary(this.stateDirectory),events:this.events.length?this.events:this.history.at(-1)?.events||[]};}
}
module.exports={SyncController};
