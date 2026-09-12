const fs=require('node:fs');
const path=require('node:path');
const readline=require('node:readline');
const {randomUUID}=require('node:crypto');
const source=require('./source-export');
const tally=require('./tally');
const {ensureTally}=require('./startup');
const {saveJson,deliver}=require('./outbox');

async function pack(directory,collections) {
  let records=[],bytes=0,chunkCount=0,recordCount=0;
  const flush=()=>{
    const payload={records};bytes+=Buffer.byteLength(JSON.stringify(payload));
    if(bytes>500*1024**2||chunkCount>=10000) throw new Error('Source snapshot exceeds transfer limits');
    saveJson(path.join(directory,`${chunkCount++}.json`),payload);records=[];
  };
  let size=0;
  for(const coverage of collections.filter(c=>c.status==='success')) {
    const stream=fs.createReadStream(path.join(directory,`${coverage.name}.jsonl`),{encoding:'utf8'});
    const lines=readline.createInterface({input:stream,crlfDelay:Infinity});
    try {
      for await(const line of lines) {
        const row=JSON.parse(line),length=Buffer.byteLength(line);
        if(length>3*1024**2) throw new Error('Source record exceeds transfer limit');
        if(records.length&&(records.length>=500||size+length>3*1024**2)) {flush();size=0;}
        records.push(row);size+=length;recordCount++;
      }
    } finally {lines.close();stream.destroy();}
  }
  if(records.length||!chunkCount) flush();
  return {bytes,chunkCount,recordCount};
}
function identity(row) {
  const guid=source.field(row,'GUID'),master=source.field(row,'MASTERID');
  const value=guid||master;
  return typeof value==='string'&&value.length<=2000 ? value : null;
}
async function capture(config,company,directory,log) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const capturedAt=new Date().toISOString(),collections=[];
  let storedBytes=0;
  for(const collection of Object.keys(source.CATALOG)) {
    const file=path.join(directory,`${collection}.jsonl`);
    let count=0,sourceBytes=0;
    const collectionStarted=Date.now();
    log({event:'source_collection_started',company:company.name,collection});
    fs.writeFileSync(file,'',{mode:0o600});
    try {
      sourceBytes=await source.extract(config,collection,company.name,payload=>{
        // COMPANY collections may return every loaded company despite context.
        // Filter only company objects by GUID. Other records are requested using
        // SVCURRENTCOMPANY and retain their contents without interpretation.
        if(collection==='COMPANY'&&source.field(payload,'GUID')!==company.externalId) return;
        const row={collection,ordinal:count,sourceId:identity(payload),payload};
        const line=JSON.stringify(row)+'\n';
        storedBytes+=Buffer.byteLength(line);
        if(storedBytes>500*1024**2||count>=5000000) throw new Error('Source snapshot exceeds capture limits');
        fs.appendFileSync(file,line);count++;
      });
      if(collection==='COMPANY'&&count!==1) throw new Error('Selected source company was not returned exactly once');
      collections.push({name:collection,status:'success',count});
      log({event:'source_collection_finished',company:company.name,collection,count,sourceBytes,durationMs:Date.now()-collectionStarted});
    } catch(error) {
      // Never label the prefix of a truncated/failed collection as complete.
      fs.unlinkSync(file);
      collections.push({name:collection,status:'failed',count:0});
      log({event:'source_collection_failed',company:company.name,collection,error:error.message,
        discardedRecords:count,durationMs:Date.now()-collectionStarted,diagnostic:error.exportDiagnostic||null});
      if(storedBytes>500*1024**2) throw error;
    }
  }
  let consistency='unavailable';
  try {
    const after=[];
    await tally.extract({...config,exportPhase:'consistency_check'},'COMPANY',null,row=>{if(row.GUID===company.externalId) after.push(row);});
    if(after.length!==1||after[0].NAME!==company.name) consistency='changed';
    else if(JSON.stringify([after[0].LASTALTERID||'',after[0].LASTVCHID||''])!==company.marker) consistency='changed';
    else if(company.marker!=='["",""]') consistency='stable';
  } catch(error) {consistency='changed';log({event:'source_consistency_failed',company:company.name,error:error.message,diagnostic:error.exportDiagnostic||null});}
  log({event:'source_consistency_finished',company:company.name,consistency});
  const stats=await pack(directory,collections);
  const manifest={batchId:path.basename(directory),capturedAt,company:{name:company.name,externalId:company.externalId},
    schemaVersion:1,profile:'company-business-v1',collections,consistency,...stats};
  saveJson(path.join(directory,'manifest.json'),manifest);
  // The durable transfer chunks now contain the full JSON records.
  for(const c of collections.filter(c=>c.status==='success')) fs.unlinkSync(path.join(directory,`${c.name}.jsonl`));
  return manifest;
}
async function run(configFile,dryRun=false) {
  const base=path.dirname(path.resolve(configFile)),config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  const api=new URL(config.apiUrl),url=new URL(config.tallyUrl);
  if(api.protocol!=='https:'||api.username||api.password||api.search||api.hash||api.pathname!=='/') throw new Error('apiUrl must be an HTTPS origin without credentials');
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password) throw new Error('Invalid tallyUrl');
  config.apiUrl=api.origin;config.requestTimeoutMs??=300000;
  if(!Number.isInteger(config.requestTimeoutMs)||config.requestTimeoutMs<1000||config.requestTimeoutMs>1800000) throw new Error('Invalid requestTimeoutMs');
  const state=path.resolve(base,config.stateDirectory||'state'),outbox=path.join(state,'source-outbox'),logs=path.join(state,'logs');
  fs.mkdirSync(outbox,{recursive:true,mode:0o700});fs.mkdirSync(logs,{recursive:true,mode:0o700});
  const runId=randomUUID(),started=Date.now();
  const logFile=path.join(logs,`${new Date().toISOString().replace(/[:.]/g,'-')}-${runId}.jsonl`);
  const failedCollections=[];
  const log=fields=>{
    if(fields.event==='source_collection_failed')failedCollections.push({company:fields.company,collection:fields.collection,
      error:fields.error,errorCodes:fields.diagnostic?.errorCodes||[],requestId:fields.diagnostic?.requestId||null});
    const line=JSON.stringify({at:new Date().toISOString(),runId,...fields});fs.appendFileSync(logFile,line+'\n',{mode:0o600});console.log(line);
  };
  config.exportLog=log;
  let succeeded=0,failed=0,recordCount=0;
  log({event:'run_started',mode:'source',dryRun});
  try {
    const retention=config.logRetentionDays??30;
    if(!Number.isInteger(retention)||retention<1) throw new Error('Invalid logRetentionDays');
    for(const file of fs.readdirSync(logs)) if(/^[\dTZ-]+-[a-f0-9-]+\.jsonl$/.test(file)&&fs.statSync(path.join(logs,file)).mtimeMs<Date.now()-retention*86400000) fs.unlinkSync(path.join(logs,file));
    const token=dryRun ? '' : config.tokenEnvironmentVariable ? (process.env[config.tokenEnvironmentVariable]||'').trim()
      : fs.readFileSync(path.resolve(base,config.tokenFile||'token.txt'),'utf8').trim();
    if(!dryRun&&(token.length<32||/[\r\n]/.test(token))) throw new Error('Token file must contain TALLY_INGEST_TOKEN');
    const seen=new Set();
    async function send(directory,m) {
      try {
        const result=await deliver(config,token,directory,m,log);
        fs.rmSync(directory,{recursive:true});
        recordCount+=m.recordCount;
        if(result.coverageStatus==='complete') succeeded++;else failed++;
        log({event:'source_snapshot_saved',company:m.company.name,batchId:m.batchId,records:m.recordCount,...result});
      } catch(error) {failed++;log({event:'source_upload_failed',company:m.company.name,batchId:m.batchId,error:error.message});}
    }
    if(!dryRun) for(const id of fs.readdirSync(outbox).sort()) {
      if(!/^[a-f0-9-]{36}$/.test(id)) continue;
      const directory=path.join(outbox,id),file=path.join(directory,'manifest.json');
      if(!fs.existsSync(file)) {fs.rmSync(directory,{recursive:true});continue;}
      const m=JSON.parse(fs.readFileSync(file,'utf8'));seen.add(m.company.externalId);await send(directory,m);
    }
    await ensureTally(config,base,log);
    const companies=[];
    await tally.extract(config,'COMPANY',null,row=>companies.push({name:tally.required(row.NAME,200,'company name'),
      externalId:tally.required(row.GUID,200,'company GUID'),marker:JSON.stringify([row.LASTALTERID||'',row.LASTVCHID||''])}));
    if(!companies.length) throw new Error('No source companies exposed by Tally');
    if(new Set(companies.map(c=>c.externalId)).size!==companies.length) throw new Error('Duplicate source company GUIDs');
    log({event:'companies_discovered',count:companies.length});
    for(const company of companies) {
      if(seen.has(company.externalId)) {log({event:'source_company_skipped',company:company.name,reason:'Pending capture retried this run'});continue;}
      const directory=path.join(dryRun?path.join(state,'source-preview'):outbox,randomUUID());
      try {
        const m=await capture(config,company,directory,log);
        if(dryRun) {
          const complete=m.collections.every(c=>c.status==='success')&&m.consistency!=='changed';
          if(complete)succeeded++;else failed++;
          recordCount+=m.recordCount;
          log({event:'source_preview',company:company.name,directory,records:m.recordCount,coverageStatus:complete?'complete':'partial',consistency:m.consistency});
        } else await send(directory,m);
      } catch(error) {
        failed++;log({event:'source_capture_failed',company:company.name,error:error.message});
        if(fs.existsSync(directory)&&!fs.existsSync(path.join(directory,'manifest.json'))) fs.rmSync(directory,{recursive:true});
      }
    }
  } catch(error) {failed++;log({event:'run_failure',error:error.message,diagnostic:error.exportDiagnostic||null});}
  finally {log({event:'run_finished',mode:'source',dryRun,succeeded,failed,records:recordCount,failedCollections,durationMs:Date.now()-started});}
  return failed?1:0;
}
module.exports={run,capture,pack};
