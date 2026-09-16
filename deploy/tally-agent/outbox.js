const fs = require('node:fs');
const path = require('node:path');
function saveJson(file, value) {
  const temporary = file + '.tmp';
  const fd = fs.openSync(temporary,'w',0o600);
  try { fs.writeFileSync(fd,JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary,file);
}
function writer(directory) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  let data = { ledgers:[], vouchers:[] }, rows=0, size=32, chunkCount=0, bytes=0, ledgerCount=0, voucherCount=0;
  const flush = () => {
    const serialized = JSON.stringify(data);
    bytes += Buffer.byteLength(serialized);
    if (bytes > 500*1024*1024 || chunkCount >= 10000) throw new Error('Company exceeds staged upload capacity');
    saveJson(path.join(directory, `${chunkCount++}.json`),data);
    data={ledgers:[],vouchers:[]}; rows=0; size=32;
  };
  return {
    add(kind,row) {
      const length = Buffer.byteLength(JSON.stringify(row))+1;
      if (length > 500*1024) throw new Error('A record exceeds chunk capacity');
      if (rows && (rows >= 500 || size+length > 500*1024)) flush();
      data[kind].push(row); rows++; size+=length;
      if (kind==='ledgers') ledgerCount++; else voucherCount++;
    },
    finish() { if (rows || !chunkCount) flush(); return {chunkCount,bytes,ledgerCount,voucherCount}; }
  };
}
async function deliver(config, token, directory, manifest, log, fetcher=fetch, sleep=ms=>new Promise(r=>setTimeout(r,ms))) {
  const sourceMode=manifest.profile==='company-business-v1';
  const endpoint=sourceMode ? manifest.periodMode==='replace'?'source-period-replace/':manifest.scope?'source-period/':'source/' : '';
  let retries=0, requestBytes=0, chunksAcknowledged=0;
  const attempts=config.uploadAttempts??4;
  if(!Number.isInteger(attempts)||attempts<1||attempts>4)throw new Error('Invalid upload attempt limit');
  async function post(operation, value) {
    const body=JSON.stringify(value);
    for (let attempt=0; attempt<attempts; attempt++) {
      config.signal?.throwIfAborted();
      try {
        requestBytes+=Buffer.byteLength(body);
        const response=await fetcher(`${config.apiUrl}/api/ingest/tally/${endpoint}${operation}`, {
          method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
          body, redirect:'error', signal:config.signal?AbortSignal.any([config.signal,AbortSignal.timeout(config.requestTimeoutMs)]):AbortSignal.timeout(config.requestTimeoutMs) });
        if (response.status!==200) {
          const detail=await response.json?.().catch(()=>null);
          if(manifest.scope&&response.status===409){
            if(detail?.code==='PERIOD_CAPTURE_STALE')throw Object.assign(new Error('PERIOD_CAPTURE_STALE'),{code:'PERIOD_CAPTURE_STALE',retryable:false});
          }
          const {safeText}=require('./export-diagnostics');
          const error=Object.assign(new Error(`API ${operation}: HTTP ${response.status}${typeof detail?.error==='string'?' - '+safeText(detail.error):''}`),
            {retryable:response.status===429 || response.status>=500,uploadDiagnostic:{operation,stage:'upload',httpStatus:response.status,attempt:attempt+1,
              ...(typeof detail?.diagnosticId==='string'?{serverDiagnosticId:detail.diagnosticId}:{})}});
          if(!response.bodyUsed)await response.body?.cancel(); throw error;
        }
        const result=await response.json();
        if (result.ok!==true || result.batchId!==manifest.batchId) throw Object.assign(new Error('API acknowledgement is invalid'),{retryable:false});
        return result;
      } catch (error) {
        config.signal?.throwIfAborted();
        if (error.retryable===false || attempt===attempts-1) throw Object.assign(error,{retries,requestBytes,chunksAcknowledged});
        retries++;
        log({event:'retry',company:manifest.company.name,batchId:manifest.batchId,operation,attempt:attempt+1});
        await sleep(1000*2**attempt);
      }
    }
  }
  const begun = await post('begin',manifest);
  log({event:'upload_started',company:manifest.company.name,batchId:manifest.batchId,chunkCount:manifest.chunkCount});
  for (let index=0; !begun.completed && index<manifest.chunkCount; index++) {
    const payload=JSON.parse(fs.readFileSync(path.join(directory,`${index}.json`),'utf8'));
    await post('chunk',{batchId:manifest.batchId,index,...payload}); chunksAcknowledged++;
    log({event:'upload_progress',company:manifest.company.name,batchId:manifest.batchId,chunksAcknowledged,chunkCount:manifest.chunkCount});
  }
  log({event:'upload_finalizing',company:manifest.company.name,batchId:manifest.batchId});
  const result=await post('complete',{batchId:manifest.batchId});
  if(sourceMode) {
    const expected=!manifest.scope&&manifest.collections.every(c=>c.status==='success')&&manifest.consistency!=='changed'?'complete':'partial';
    if(result.recordCount!==manifest.recordCount||result.coverageStatus!==expected) throw new Error('API committed source coverage differs from manifest');
  } else if (result.ledgerCount!==manifest.ledgerCount || result.voucherCount!==manifest.voucherCount) throw new Error('API committed counts differ from manifest');
  if(manifest.scope&&!result.reportingBatchId)throw new Error('Period acknowledgement is missing its cumulative reporting reference');
  if(manifest.periodMode==='replace'&&result.periodMode!=='replace')throw new Error('Period replacement acknowledgement is invalid');
  return {retries,requestBytes,chunksAcknowledged,duplicate:result.duplicate,...(sourceMode?{coverageStatus:result.coverageStatus,reportingStatus:result.reportingStatus || 'unverified',
    ...(result.unpack?.diagnosticId?{serverDiagnosticId:result.unpack.diagnosticId}:{}),
    ...(result.unpack?.error?{reportingError:require('./export-diagnostics').safeText(result.unpack.error)}:{}),...(manifest.scope?{periodUpdate:true}:{})}:{})};
}
module.exports = {saveJson,writer,deliver};
