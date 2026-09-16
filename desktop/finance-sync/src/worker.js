const path=require('node:path');
const {run,discoverCompanies}=require('../generated/agent/source-agent');
const {withLock}=require('../generated/agent/launcher');
const {publicEvent,explainError}=require('./events');
const {diagnosticQueue}=require('../generated/agent/diagnostic-outbox');
const {randomUUID}=require('node:crypto');
let controller;
process.parentPort.on('message',async({data})=>{
  if(data.type==='shutdown'){process.exit(0);return;}
  if(data.type==='cancel'){controller?.abort();return;}
  if(controller)return;
  controller=new AbortController();
  const {config,stateDirectory}=data;
  const send=value=>process.parentPort.postMessage(value);
  let checkQueue;
  let terminal;
  const runId=randomUUID();
  try {
    if(data.type==='check') {
      checkQueue=diagnosticQueue(path.join(stateDirectory,'diagnostics-outbox'),config,event=>send({type:'event',event:publicEvent(event)}));
      await checkQueue.flush(config.token);
      const companies=await discoverCompanies({...config,requestTimeoutMs:10000,signal:controller.signal,exportLog:event=>{
        checkQueue.add({...event,runId});send({type:'event',event:publicEvent(event)});
      }});
      terminal={type:'ready',companies:companies.map(({name,externalId})=>({name,externalId}))};
    } else if(data.type==='sync') {
      const code=await withLock({stateDirectory},()=>run(path.join(stateDirectory,'desktop.json'),false,{
        config:{...config,stateDirectory,startup:{enabled:false},uploadAttempts:1,stopOnFailure:true,requestPauseMs:500,voucherWindowDays:7,periodMode:config.scope?'replace':undefined},token:config.token,selectedCompanyIds:data.selectedCompanyIds,
        signal:controller.signal,quiet:true,onEvent:event=>send({type:'event',event:publicEvent(event)})
      }));
      terminal={type:'done',code};
    }
  } catch(error) {
    checkQueue?.add({event:'run_failure',runId,error:error.message,diagnostic:error.exportDiagnostic});
    terminal={type:'failure',message:controller.signal.aborted?'Operation stopped. Saved uploads are retained.':explainError(error),diagnostic:publicEvent({event:'run_failure',error:error.message,diagnostic:error.exportDiagnostic})};
  } finally {
    // The controller shuts this worker down as soon as a terminal message arrives.
    try {await checkQueue?.flush(config.token);}finally {if(terminal)send(terminal);}
  }
});
