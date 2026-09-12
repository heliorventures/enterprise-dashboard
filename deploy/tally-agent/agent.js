const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const tally = require('./tally');
const {ensureTally} = require('./startup');
const {saveJson,writer,deliver} = require('./outbox');

async function run(configFile, dryRun=false) {
  const base=path.dirname(path.resolve(configFile));
  const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  if((config.importMode ?? 'source')==='source') return require('./source-agent').run(configFile,dryRun);
  if(config.importMode!=='dashboard') throw new Error('importMode must be source or dashboard');
  const api=new URL(config.apiUrl), source=new URL(config.tallyUrl);
  if (api.protocol!=='https:' || api.username || api.password || api.search || api.hash || api.pathname!=='/') throw new Error('apiUrl must be an HTTPS origin without credentials');
  if (!['http:','https:'].includes(source.protocol) || source.username || source.password) throw new Error('Invalid tallyUrl');
  config.apiUrl=api.origin;
  config.requestTimeoutMs ??= 300000;
  if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs<1000 || config.requestTimeoutMs>1800000) throw new Error('Invalid requestTimeoutMs');
  const state=path.resolve(base,config.stateDirectory || 'state');
  const logs=path.join(state,'logs'), outbox=path.join(state,'outbox');
  fs.mkdirSync(logs,{recursive:true,mode:0o700}); fs.mkdirSync(outbox,{recursive:true,mode:0o700});
  const runId=randomUUID(), started=Date.now();
  const logFile=path.join(logs,`${new Date().toISOString().replace(/[:.]/g,'-')}-${runId}.jsonl`);
  const log = fields => {
    const row={at:new Date().toISOString(),runId,...fields};
    fs.appendFileSync(logFile,JSON.stringify(row)+'\n',{mode:0o600});
    console.log(JSON.stringify(row));
  };
  let succeeded=0, failed=0, ledgerTotal=0, voucherTotal=0;
  config.exportLog=log;
  config.exportPhase='dashboard_export';
  log({event:'run_started',dryRun});
  const seen=new Set();
  try {
    const retention=config.logRetentionDays ?? 30;
    if (!Number.isInteger(retention) || retention<1) throw new Error('Invalid logRetentionDays');
    for (const file of fs.readdirSync(logs)) {
      if (/^[\dTZ-]+-[a-f0-9-]+\.jsonl$/.test(file) && fs.statSync(path.join(logs,file)).mtimeMs < Date.now()-retention*86400000) fs.unlinkSync(path.join(logs,file));
    }
    const token=dryRun ? '' : config.tokenEnvironmentVariable
      ? (process.env[config.tokenEnvironmentVariable] || '').trim()
      : fs.readFileSync(path.resolve(base,config.tokenFile || 'token.txt'),'utf8').trim();
    if (!dryRun && (token.length<32 || /[\r\n]/.test(token))) throw new Error('Token file must contain the TALLY_INGEST_TOKEN');
    async function send(directory, manifest, resumed=false) {
      const start=Date.now();
      log({event:'company_upload_started',company:manifest.company.name,batchId:manifest.batchId,resumed,
        ledgers:manifest.ledgerCount,vouchers:manifest.voucherCount,chunks:manifest.chunkCount,payloadBytes:manifest.bytes});
      try {
        const stats=await deliver(config,token,directory,manifest,log);
        log({event:'company_success',company:manifest.company.name,batchId:manifest.batchId,ledgers:manifest.ledgerCount,
          vouchers:manifest.voucherCount,chunks:manifest.chunkCount,payloadBytes:manifest.bytes,durationMs:Date.now()-start,...stats});
        // Delete only this completed, agent-created UUID directory. Pending data is retained.
        fs.rmSync(directory,{recursive:true});
        succeeded++; ledgerTotal+=manifest.ledgerCount; voucherTotal+=manifest.voucherCount;
      } catch (error) {
        failed++;
        log({event:'company_failure',company:manifest.company.name,batchId:manifest.batchId,stage:'upload',
          error:error.message,durationMs:Date.now()-start,ledgers:manifest.ledgerCount,vouchers:manifest.voucherCount,
          retries:error.retries || 0,requestBytes:error.requestBytes || 0,chunksAcknowledged:error.chunksAcknowledged || 0});
      }
    }
    // Deliver durable pending batches even when Tally is currently unavailable.
    if (!dryRun) for (const id of fs.readdirSync(outbox).sort()) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      const directory=path.join(outbox,id), ready=path.join(directory,'manifest.json');
      if (!fs.existsSync(ready)) { fs.rmSync(directory,{recursive:true}); continue; }
      const manifest=JSON.parse(fs.readFileSync(ready,'utf8'));
      seen.add(manifest.company.externalId);
      await send(directory,manifest,true);
    }
    await ensureTally(config,base,log);
    const companies=[];
    await tally.extract(config,'COMPANY',null,row => companies.push({
      name:tally.required(row.NAME,200,'company name'), externalId:tally.required(row.GUID,200,'company GUID'),
      marker:JSON.stringify([row.LASTALTERID || '',row.LASTVCHID || ''])
    }));
    if (!companies.length) throw new Error('No companies exposed by Tally; load companies and check XML access');
    if (new Set(companies.map(c=>c.externalId)).size!==companies.length) throw new Error('Duplicate company GUIDs in discovery');
    log({event:'companies_discovered',count:companies.length});
    for (const company of companies) {
      if (seen.has(company.externalId)) { log({event:'company_skipped',company:company.name,reason:'Pending batch processed this run'}); continue; }
      const start=Date.now(), batchId=randomUUID();
      const directory=path.join(dryRun ? path.join(state,'preview') : outbox,batchId);
      const store=writer(directory);
      let ledgers=0,vouchers=0,excludedVouchers=0;
      log({event:'company_extraction_started',company:company.name,batchId});
      try {
        const capturedAt=new Date().toISOString();
        const ledgerBytes=await tally.extract(config,'LEDGER',company.name,row => {store.add('ledgers',tally.ledger(row)); ledgers++;});
        const voucherBytes=await tally.extract(config,'VOUCHER',company.name,row => {
          const record=tally.voucher(row); if (record) {store.add('vouchers',record); vouchers++;} else excludedVouchers++;
        });
        if ((!ledgers || !vouchers) && config.allowEmptyCompanies!==true) throw new Error('Empty ledgers/vouchers blocked; inspect a dry run before enabling allowEmptyCompanies');
        const after=[];
        await tally.extract(config,'COMPANY',null,row => { if (row.GUID===company.externalId) after.push(row); });
        if (after.length!==1 || after[0].NAME!==company.name || JSON.stringify([after[0].LASTALTERID || '',after[0].LASTVCHID || ''])!==company.marker) throw new Error('Company changed during extraction; retry when Tally is quiet');
        const stats=store.finish();
        const manifest={batchId,capturedAt,fullSnapshot:true,company:{name:company.name,externalId:company.externalId},...stats};
        // Commit marker is written only after BOTH exports finish and validate.
        saveJson(path.join(directory,'manifest.json'),manifest);
        log({event:'company_extracted',company:company.name,batchId,ledgers,vouchers,excludedVouchers,
          sourceBytes:ledgerBytes+voucherBytes,payloadBytes:stats.bytes,chunks:stats.chunkCount,durationMs:Date.now()-start,
          changeMarkersAvailable:company.marker!=='["",""]'});
        if (dryRun) { succeeded++; ledgerTotal+=ledgers; voucherTotal+=vouchers; log({event:'company_preview',company:company.name,directory}); }
        else await send(directory,manifest);
      } catch (error) {
        failed++;
        log({event:'company_failure',company:company.name,batchId,stage:'extraction',error:error.message,
          ledgers,vouchers,excludedVouchers,durationMs:Date.now()-start});
        // Uncommitted extraction cannot ever be submitted as a complete snapshot.
        if (!fs.existsSync(path.join(directory,'manifest.json'))) fs.rmSync(directory,{recursive:true});
      }
    }
  } catch (error) { failed++; log({event:'run_failure',error:error.message}); }
  finally { log({event:'run_finished',succeeded,failed,ledgers:ledgerTotal,vouchers:voucherTotal,dryRun,durationMs:Date.now()-started}); }
  return failed ? 1 : 0;
}
if (require.main===module) {
  if (process.env.FINANCE_AGENT_LOCKED!=='1') { console.error('Run through run-sync.ps1 to hold the overlap lock.'); process.exitCode=1; }
  else run(process.argv[2] || path.join(__dirname,'config.json'),process.argv.includes('--dry-run'))
    .then(code => {process.exitCode=code;}).catch(() => {console.error('Agent configuration/startup failed. Check paths and configuration.');process.exitCode=1;});
}
module.exports={run};
