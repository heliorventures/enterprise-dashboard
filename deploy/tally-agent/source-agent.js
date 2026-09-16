const fs=require('node:fs');
const path=require('node:path');
const readline=require('node:readline');
const {randomUUID}=require('node:crypto');
const source=require('./source-export');
const tally=require('./tally');
const {ensureTally}=require('./startup');
const {saveJson,deliver}=require('./outbox');
const {validateScope,calendarDate}=require('./scope');
const {readiness,reconciliation}=require('./source-readiness');
const {diagnosticQueue,exporterIdentity}=require('./diagnostic-outbox');
const {safeText,codes}=require('./export-diagnostics');

async function preflight(config,token,company) {
  const replacement=config.periodMode==='replace';
  const response=await fetch(`${config.apiUrl}/api/ingest/tally/${replacement?'source-period-replace':'source-period'}/preflight`,{
    method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
    body:JSON.stringify({companyExternalId:company.externalId}),
    signal:config.signal?AbortSignal.any([config.signal,AbortSignal.timeout(config.requestTimeoutMs)]):AbortSignal.timeout(config.requestTimeoutMs)});
  if(response.status!==200){const detail=await response.json().catch(()=>null);
    throw Object.assign(new Error(response.status===409?'PERIOD_BASELINE_REQUIRED':response.status===404?'PERIOD_API_UPGRADE_REQUIRED':`API preflight: HTTP ${response.status}`),
      {exportDiagnostic:{stage:'preflight',httpStatus:response.status,action:safeText(detail?.error||'Verify the server and baseline before retrying this period.'),...(detail?.diagnosticId?{serverDiagnosticId:detail.diagnosticId}:{})}});}
  const result=await response.json();
  if(result.ok!==true||result.companyExternalId!==company.externalId||(replacement?result.periodMode!=='replace':typeof result.baselineBatchId!=='string'))throw new Error('Invalid period preflight acknowledgement');
}

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
  const originalLog=log;
  log=fields=>originalLog({batchId:path.basename(directory),companyExternalId:company.externalId,...fields,company:fields.company||company.name});
  config={...config,exportLog:log};
  if(config.scope)config.scope=validateScope(config.scope);
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const capturedAt=new Date().toISOString(),collections=[];
  const reconcile=reconciliation(config.scope);
  let storedBytes=0;
  for(const collection of Object.keys(source.CATALOG)) {
    config.signal?.throwIfAborted();
    const file=path.join(directory,`${collection}.jsonl`);
    let count=0,sourceBytes=0;
    const check=readiness(collection);
    let buffered=[],bufferedBytes=0;
    const flush=()=>{if(buffered.length)fs.appendFileSync(file,buffered.join(''));buffered=[];bufferedBytes=0;};
    const collectionStarted=Date.now();
    log({event:'source_collection_started',company:company.name,collection});
    fs.writeFileSync(file,'',{mode:0o600});
    try {
      sourceBytes=await source.extract(config,collection,company.name,payload=>{
        // COMPANY collections may return every loaded company despite context.
        // Filter only company objects by GUID. Other records are requested using
        // SVCURRENTCOMPANY and retain their contents without interpretation.
        if(collection==='COMPANY'&&source.field(payload,'GUID')!==company.externalId) return;
        if(config.scope&&collection==='VOUCHER') {
          const raw=source.field(payload,'DATE'),guid=source.field(payload,'GUID');
          const date=typeof raw==='string'&&/^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`:raw;
          if(!calendarDate(date)||date<config.scope.from||date>config.scope.to)throw new Error('PERIOD_VOUCHER_DATE_INVALID');
          if(!guid||guid!==guid.trim())throw new Error('PERIOD_VOUCHER_GUID_REQUIRED');
        }
        const row={collection,ordinal:count,sourceId:identity(payload),payload};
        check.add(payload,count);
        reconcile.add(collection,payload,count);
        const line=JSON.stringify(row)+'\n';
        storedBytes+=Buffer.byteLength(line);
        if(storedBytes>500*1024**2||count>=5000000) throw new Error('Source snapshot exceeds capture limits');
        buffered.push(line);bufferedBytes+=Buffer.byteLength(line);if(bufferedBytes>=65536)flush();count++;
      });
      flush();
      if(collection==='COMPANY'&&count!==1) throw new Error('Selected source company was not returned exactly once');
      const health=check.result();
      collections.push({name:collection,status:'success',count,readiness:health});
      if(health.status!=='ready')log({event:health.errorCount?'source_readiness_failed':'source_readiness_warning',company:company.name,collection,
        error:`${health.errorCount} financial errors, ${health.warningCount} warnings. ${health.issues.map(i=>`${i.code} at #${i.ordinal}.${i.field}`).join('; ')}`,
        errorCount:health.errorCount,warningCount:health.warningCount,issues:health.issues});
      log({event:'source_collection_finished',company:company.name,collection,count,sourceBytes,durationMs:Date.now()-collectionStarted});
    } catch(error) {
      // Never label the prefix of a truncated/failed collection as complete.
      fs.unlinkSync(file);
      config.signal?.throwIfAborted();
      collections.push({name:collection,status:'failed',count:0,diagnostic:{...error.exportDiagnostic,
        errorCodes:codes(error),discardedRecords:count,action:error.exportDiagnostic?.action||safeText(error.message)}});
      log({event:'source_collection_failed',company:company.name,collection,error:error.message,
        discardedRecords:count,durationMs:Date.now()-collectionStarted,diagnostic:error.exportDiagnostic||null});
      if(config.stopOnFailure||config.voucherWindowDays!==undefined)throw error;
      if(storedBytes>500*1024**2) throw error;
    }
  }
  let consistency='unavailable';
  try {
    const after=[];
    await source.pause(config);
    await tally.extract({...config,exportPhase:'consistency_check'},'COMPANY',null,row=>{if(row.GUID===company.externalId) after.push(row);});
    if(after.length!==1||after[0].NAME!==company.name) consistency='changed';
    else if(JSON.stringify([after[0].LASTALTERID||'',after[0].LASTVCHID||''])!==company.marker) consistency='changed';
    else if(company.marker!=='["",""]') consistency='stable';
  } catch(error) {config.signal?.throwIfAborted();consistency='changed';log({event:'source_consistency_failed',company:company.name,error:error.message,diagnostic:error.exportDiagnostic||null});}
  log({event:'source_consistency_finished',company:company.name,consistency});
  if(consistency==='changed'&&(config.stopOnFailure||config.scope||config.voucherWindowDays!==undefined))throw new Error('Tally changed during the export. Try again when company data is stable.');
  const stats=await pack(directory,collections);
  const reconciliationResult=reconcile.result(collections.every(c=>c.status==='success')&&consistency!=='changed');
  if(reconciliationResult.warningCount)log({event:'source_readiness_warning',company:company.name,collection:'LEDGER',
    error:`Ledger reconciliation: ${reconciliationResult.warningCount} warnings. ${reconciliationResult.issues[0].message}`,...reconciliationResult});
  config.signal?.throwIfAborted();
  const manifest={batchId:path.basename(directory),capturedAt,company:{name:company.name,externalId:company.externalId},
    schemaVersion:1,profile:'company-business-v1',exporter:exporterIdentity(),collections,consistency,reconciliation:reconciliationResult,
    dateContext:{ledgers:{from:'1901-01-01',to:'9999-12-31'},vouchers:{from:config.scope?.from||'1901-01-01',to:config.scope?.to||'9999-12-31'}},
    ...stats,...(config.scope?{scope:config.scope,...(config.periodMode==='replace'?{periodMode:'replace'}:{})}:{})};
  saveJson(path.join(directory,'manifest.json'),manifest);
  // The durable transfer chunks now contain the full JSON records.
  for(const c of collections.filter(c=>c.status==='success')) fs.unlinkSync(path.join(directory,`${c.name}.jsonl`));
  return manifest;
}
async function discoverCompanies(config) {
  const companies=[];
  await source.pause(config);
  await tally.extract(config,'COMPANY',null,row=>companies.push({name:tally.required(row.NAME,200,'company name'),
    externalId:tally.required(row.GUID,200,'company GUID'),marker:JSON.stringify([row.LASTALTERID||'',row.LASTVCHID||''])}));
  if(!companies.length) throw Object.assign(new Error('No source companies exposed by Tally'),{code:'NO_COMPANIES'});
  if(new Set(companies.map(c=>c.externalId)).size!==companies.length) throw new Error('Duplicate source company GUIDs');
  return companies;
}
async function run(configFile,dryRun=false,options={}) {
  const base=path.dirname(path.resolve(configFile)),config={...(options.config||JSON.parse(fs.readFileSync(configFile,'utf8')))};
  if(options.selectedCompanyIds!==undefined&&(!Array.isArray(options.selectedCompanyIds)||!options.selectedCompanyIds.length||options.selectedCompanyIds.some(id=>typeof id!=='string'||!id))) throw new Error('Select at least one company; invalid selection');
  const selected=options.selectedCompanyIds===undefined?null:new Set(options.selectedCompanyIds);
  config.signal=options.signal;
  if(config.requestPauseMs!==undefined&&(!Number.isInteger(config.requestPauseMs)||config.requestPauseMs<0||config.requestPauseMs>60000))throw new Error('Invalid requestPauseMs');
  if(config.voucherWindowDays!==undefined&&(!Number.isInteger(config.voucherWindowDays)||config.voucherWindowDays<1||config.voucherWindowDays>7))throw new Error('Invalid voucherWindowDays');
  if(config.scope)config.scope=validateScope(config.scope);
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
  let queue;
  const log=fields=>{
    if(fields.event==='source_collection_failed')failedCollections.push({company:fields.company,collection:fields.collection,
      error:fields.error,errorCodes:fields.diagnostic?.errorCodes||[],requestId:fields.diagnostic?.requestId||null});
    const event={at:new Date().toISOString(),runId,...fields};
    if(queue)try {queue.add(event);}catch(error){
      // Disk failure must be visible; do not mask the original export failure.
      fs.appendFileSync(logFile,JSON.stringify({at:event.at,runId,event:'diagnostics_local_save_failed',error:safeText(error.message)})+'\n',{mode:0o600});
    }
    const line=JSON.stringify(event);fs.appendFileSync(logFile,line+'\n',{mode:0o600});
    if(!options.quiet)console.log(line);
    options.onEvent?.(event);
  };
  config.exportLog=log;
  if(!dryRun)queue=diagnosticQueue(path.join(state,'diagnostics-outbox'),config,log);
  let token='';
  let succeeded=0,failed=0,recordCount=0;
  log({event:'run_started',mode:'source',dryRun,scope:config.scope||{kind:'full'}});
  try {
    const retention=config.logRetentionDays??30;
    if(!Number.isInteger(retention)||retention<1) throw new Error('Invalid logRetentionDays');
    for(const file of fs.readdirSync(logs)) if(/^[\dTZ-]+-[a-f0-9-]+\.jsonl$/.test(file)&&fs.statSync(path.join(logs,file)).mtimeMs<Date.now()-retention*86400000) fs.unlinkSync(path.join(logs,file));
    config.signal?.throwIfAborted();
    token=dryRun ? '' : options.token!==undefined?options.token:config.tokenEnvironmentVariable ? (process.env[config.tokenEnvironmentVariable]||'').trim()
      : fs.readFileSync(path.resolve(base,config.tokenFile||'token.txt'),'utf8').trim();
    if(!dryRun&&(token.length<32||/[\r\n]/.test(token))) throw new Error('Token file must contain TALLY_INGEST_TOKEN');
    await queue?.flush(token);
    const seen=new Set();
    // Interactive runs must revalidate selected identities before any delivery.
    // CLI runs retain their established outbox-first behavior.
    let companies;
    if(selected) {
      companies=await discoverCompanies(config);
      if([...selected].some(id=>!companies.some(c=>c.externalId===id))) throw new Error('A selected company is no longer available. Load it in Tally and check again.');
    }
    async function send(directory,m) {
      try {
        const result=await deliver(config,token,directory,m,fields=>log({companyExternalId:m.company.externalId,...fields}));
        fs.rmSync(directory,{recursive:true});
        recordCount+=m.recordCount;
        const accepted=(result.coverageStatus==='complete'||result.periodUpdate)&&(!config.stopOnFailure||result.reportingStatus==='validated');
        if(accepted)succeeded++;else if(!config.stopOnFailure)failed++;
        log({event:'source_snapshot_saved',companyExternalId:m.company.externalId,company:m.company.name,batchId:m.batchId,records:m.recordCount,...result});
        if(config.stopOnFailure&&result.reportingStatus!=='validated')throw Object.assign(new Error('Finance processing was not validated. '+(result.reportingError||'Review the Finance sync results before continuing.')),
          {uploadDiagnostic:{stage:'reporting',serverDiagnosticId:result.serverDiagnosticId}});
      } catch(error) {
        config.signal?.throwIfAborted();
        if(error.code==='PERIOD_CAPTURE_STALE')saveJson(path.join(directory,'held.json'),{reason:error.code,at:new Date().toISOString()});
        failed++;error.failureRecorded=true;log({event:'source_upload_failed',companyExternalId:m.company.externalId,company:m.company.name,batchId:m.batchId,error:safeText(error.message),diagnostic:error.uploadDiagnostic||{errorCodes:codes(error)}});if(config.stopOnFailure)throw error;
      }
    }
    if(!dryRun) for(const id of fs.readdirSync(outbox).sort()) {
      config.signal?.throwIfAborted();
      if(!/^[a-f0-9-]{36}$/.test(id)) continue;
      const directory=path.join(outbox,id),file=path.join(directory,'manifest.json');
      if(!fs.existsSync(file)) {fs.rmSync(directory,{recursive:true});continue;}
      if(fs.existsSync(path.join(directory,'held.json')))continue;
      const m=JSON.parse(fs.readFileSync(file,'utf8'));
      if(selected&&!selected.has(m.company.externalId))continue;
      if(JSON.stringify(m.scope||null)!==JSON.stringify(config.scope||null))continue;
      if((m.periodMode||null)!==(config.scope?config.periodMode||null:null))continue;
      seen.add(m.company.externalId);
      log({event:'source_pending_retry',companyExternalId:m.company.externalId,company:m.company.name,batchId:m.batchId});
      await send(directory,m);
    }
    if(!companies) {await ensureTally(config,base,log);companies=await discoverCompanies(config);}
    log({event:'companies_discovered',count:companies.length});
    for(const company of companies) {
      config.signal?.throwIfAborted();
      if(selected&&!selected.has(company.externalId))continue;
      if(seen.has(company.externalId)) {log({event:'source_company_skipped',company:company.name,reason:'Pending capture retried this run'});continue;}
      const directory=path.join(dryRun?path.join(state,'source-preview'):outbox,randomUUID());
      try {
        if(config.scope&&!dryRun){log({event:'period_preflight',company:company.name,companyExternalId:company.externalId});await preflight(config,token,company);}
        const m=await capture(config,company,directory,fields=>log({companyExternalId:company.externalId,...fields}));
        if(dryRun) {
          const complete=m.collections.every(c=>c.status==='success')&&m.consistency!=='changed';
          const ready=m.collections.every(c=>!c.readiness?.errorCount);
          if(complete&&ready)succeeded++;else failed++;
          recordCount+=m.recordCount;
          log({event:'source_preview',company:company.name,directory,records:m.recordCount,coverageStatus:complete?'complete':'partial',readiness:ready?'ready':'blocked',consistency:m.consistency});
        } else await send(directory,m);
      } catch(error) {
        if(fs.existsSync(directory)&&!fs.existsSync(path.join(directory,'manifest.json'))) fs.rmSync(directory,{recursive:true});
        config.signal?.throwIfAborted();
        if(!error.failureRecorded){failed++;log({event:'source_capture_failed',companyExternalId:company.externalId,company:company.name,batchId:path.basename(directory),error:safeText(error.message),diagnostic:error.exportDiagnostic||{errorCodes:codes(error)}});error.failureRecorded=true;}
        if(config.stopOnFailure)throw error;
      }
      await queue?.flush(token);
    }
  } catch(error) {if(!error.failureRecorded)failed++;log({event:config.signal?.aborted?'run_cancelled':'run_failure',error:config.signal?.aborted?'Sync stopped. Completed captures remain available for retry.':error.message,diagnostic:error.exportDiagnostic||null});}
  finally {await queue?.flush(token);log({event:'run_finished',mode:'source',dryRun,cancelled:config.signal?.aborted===true,succeeded,failed,records:recordCount,failedCollections,durationMs:Date.now()-started});}
  return failed?1:0;
}
module.exports={run,capture,pack,discoverCompanies};
