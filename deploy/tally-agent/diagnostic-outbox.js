const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {saveJson}=require('./outbox');
const {safeText}=require('./export-diagnostics');
const EVENTS=new Set(['tally_export_failed','source_collection_failed','source_consistency_failed','source_capture_failed','source_upload_failed','run_failure','run_cancelled','source_readiness_failed','source_readiness_warning']);
function exporterIdentity() {
  const hash=createHash('sha256');
  for(const file of ['source-agent.js','source-export.js','source-readiness.js','export-diagnostics.js','diagnostic-outbox.js','outbox.js','tally.js','scope.js'])hash.update(file).update(fs.readFileSync(path.join(__dirname,file)));
  return {version:require('./package.json').version,contract:'financial-source-v2',buildHash:hash.digest('hex')};
}
function diagnosticQueue(directory,config,log) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const exporter=exporterIdentity();
  return {
    add(event) {
      if(!EVENTS.has(event.event))return;
      const diagnostic=event.diagnostic||event;
      const details={};
      for(const name of ['requestId','requestHash','phase','stage','endpoint','httpStatus','bytesReceived','recordsReceived','recordsProcessed','discardedRecords','durationMs','xmlLine','xmlColumn','xmlPosition','xmlPath','xmlCharacterReference','contentType','charset','action','tallyMessage','from','to','errorCount','warningCount','serverDiagnosticId','operation','attempt']) {
        const value=diagnostic[name]??event[name];
        if(typeof value==='string')details[name]=safeText(value);
        else if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)details[name]=value;
      }
      details.errorCodes=(diagnostic.errorCodes||[]).filter(c=>typeof c==='string'&&/^[\w]{1,64}$/.test(c)).slice(0,20);
      if(event.issues)details.issues=event.issues.slice(0,20);
      const value={id:randomUUID(),occurredAt:event.at||new Date().toISOString(),runId:event.runId||null,
        batchId:event.batchId||null,company:event.companyExternalId?{externalId:event.companyExternalId,name:safeText(event.company||event.companyExternalId,200)}:null,
        collection:event.collection||null,event:event.event,severity:event.event==='source_readiness_warning'?'warning':'error',
        message:safeText(event.error||diagnostic.tallyMessage||details.action||event.event),details,exporter};
      saveJson(path.join(directory,value.id+'.json'),value);
    },
    async flush(token,fetcher=fetch) {
      // Separate durable queue: never recapture Tally to deliver an error.
      // A bounded group per flush; leave every unacknowledged event on disk.
      const files=fs.readdirSync(directory).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)).sort().slice(0,25);
      if(!files.length||!token)return;
      const signal=AbortSignal.timeout(Math.min(config.requestTimeoutMs||10000,10000));
      const quarantine=(file,reason)=>{
        const rejected=path.join(directory,'rejected');fs.mkdirSync(rejected,{recursive:true,mode:0o700});
        fs.renameSync(path.join(directory,file),path.join(rejected,file));
        log({event:'diagnostic_rejected',file,reason,action:'The original event is retained in diagnostics-outbox/rejected for investigation; other events continue.'});
      };
      try {
        const values=[];
        for(const file of files) {
          try {values.push({file,event:JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'))});}
          catch {quarantine(file,'Invalid local JSON');}
        }
        async function send(items) {
        if(!items.length)return;
        const events=items.map(i=>i.event);
        const response=await fetcher(config.apiUrl+'/api/ingest/tally/diagnostics',{method:'POST',redirect:'error',
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({events}),
          signal});
        if([400,409,413].includes(response.status)) {
          await response.body?.cancel();
          if(items.length===1){quarantine(items[0].file,`HTTP ${response.status}`);return;}
          const half=Math.ceil(items.length/2);await send(items.slice(0,half));await send(items.slice(half));return;
        }
        if(response.status!==200){await response.body?.cancel();throw new Error(`Diagnostics HTTP ${response.status}`);}
        const receipt=await response.json();
        if(receipt.ok!==true||!Array.isArray(receipt.ids)||events.some(e=>!receipt.ids.includes(e.id)))throw new Error('Diagnostics acknowledgement invalid');
        for(const {file} of items)fs.unlinkSync(path.join(directory,file));
        log({event:'diagnostics_saved',count:items.length});
        }
        await send(values);
      } catch(error) {log({event:'diagnostics_pending',count:files.length,error:safeText(error.message),action:'Failure details remain in the local diagnostics outbox and will be sent on the next connection.'});}
    },
  };
}
module.exports={diagnosticQueue,exporterIdentity};
