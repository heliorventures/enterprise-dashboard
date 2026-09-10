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
  let retries=0, requestBytes=0, chunksAcknowledged=0;
  async function post(operation, value) {
    const body=JSON.stringify(value);
    for (let attempt=0; attempt<4; attempt++) {
      try {
        requestBytes+=Buffer.byteLength(body);
        const response=await fetcher(`${config.apiUrl}/api/ingest/tally/${operation}`, {
          method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
          body, redirect:'error', signal:AbortSignal.timeout(config.requestTimeoutMs) });
        if (response.status!==200) {
          const error=Object.assign(new Error(`API ${operation}: HTTP ${response.status}`),{retryable:response.status===429 || response.status>=500});
          await response.body?.cancel(); throw error;
        }
        const result=await response.json();
        if (result.ok!==true || result.batchId!==manifest.batchId) throw Object.assign(new Error('API acknowledgement is invalid'),{retryable:false});
        return result;
      } catch (error) {
        if (error.retryable===false || attempt===3) throw Object.assign(error,{retries,requestBytes,chunksAcknowledged});
        retries++;
        log({event:'retry',company:manifest.company.name,batchId:manifest.batchId,operation,attempt:attempt+1});
        await sleep(1000*2**attempt);
      }
    }
  }
  const begun = await post('begin',manifest);
  for (let index=0; !begun.completed && index<manifest.chunkCount; index++) {
    const payload=JSON.parse(fs.readFileSync(path.join(directory,`${index}.json`),'utf8'));
    await post('chunk',{batchId:manifest.batchId,index,...payload}); chunksAcknowledged++;
  }
  const result=await post('complete',{batchId:manifest.batchId});
  if (result.ledgerCount!==manifest.ledgerCount || result.voucherCount!==manifest.voucherCount) throw new Error('API committed counts differ from manifest');
  return {retries,requestBytes,chunksAcknowledged,duplicate:result.duplicate};
}
module.exports = {saveJson,writer,deliver};
