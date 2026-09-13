const path=require('node:path');
const {run,discoverCompanies}=require('../generated/agent/source-agent');
const {withLock}=require('../generated/agent/launcher');
const {publicEvent,explainError}=require('./events');
let controller;
process.parentPort.on('message',async({data})=>{
  if(data.type==='shutdown'){process.exit(0);return;}
  if(data.type==='cancel'){controller?.abort();return;}
  if(controller)return;
  controller=new AbortController();
  const {config,stateDirectory}=data;
  const send=value=>process.parentPort.postMessage(value);
  try {
    if(data.type==='check') {
      const companies=await discoverCompanies({...config,requestTimeoutMs:10000,signal:controller.signal});
      send({type:'ready',companies:companies.map(({name,externalId})=>({name,externalId}))});
    } else if(data.type==='sync') {
      const code=await withLock({stateDirectory},()=>run(path.join(stateDirectory,'desktop.json'),false,{
        config:{...config,stateDirectory,startup:{enabled:false}},token:config.token,selectedCompanyIds:data.selectedCompanyIds,
        signal:controller.signal,quiet:true,onEvent:event=>send({type:'event',event:publicEvent(event)})
      }));
      send({type:'done',code});
    }
  } catch(error) {
    send({type:'failure',message:controller.signal.aborted?'Operation stopped. Saved uploads are retained.':explainError(error),diagnostic:publicEvent({event:'run_failure',error:error.message,diagnostic:error.exportDiagnostic})});
  }
});
