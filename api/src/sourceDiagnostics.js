const {createHash,randomUUID}=require('node:crypto');
const db=require('./db');
const {companyFilter,paging}=require('./filters');
const bad=()=>{throw Object.assign(new Error('Invalid diagnostic payload'),{status:400});};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
function redact(value) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"<>]+/gi,'[redacted credentials]')
    .replace(/(["'](?:token|password|secret|authorization|api[_-]?key)["']\s*:\s*)(["'])(.*?)\2/gi,'$1"[redacted]"')
    .replace(/<(token|password|secret|authorization|api[_-]?key)\b[^>]*>[\s\S]*?<\/\1>/gi,'<$1>[redacted]</$1>')
    .replace(/https?:\/\/[^\s<>"']+/gi,text=>{try{return new URL(text).origin;}catch{return '[redacted URL]';}})
    .replace(/\b(token|password|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,'$1=[redacted]');
}
function text(value,max=2000,required=false) {
  if(value==null&&!required)return null;
  if(typeof value!=='string'||value.length>max||(required&&!value))bad();
  return redact(value);
}
function exporter(value) {
  if(value==null)return null;
  if(!value||typeof value!=='object'||!/^[a-f0-9]{64}$/.test(value.buildHash))bad();
  return {version:text(value.version,80,true),contract:text(value.contract,80,true),buildHash:value.buildHash};
}
function readiness(value) {
  if(value==null)return undefined;
  if(!['ready','warning','blocked'].includes(value.status))bad();
  const result={status:value.status};
  for(const key of ['records','errorCount','warningCount']){
    if(!Number.isSafeInteger(value[key])||value[key]<0||value[key]>100000000)bad();result[key]=value[key];
  }
  result.issues=issueSamples(value.issues);
  if((result.errorCount>0)!==(result.status==='blocked')||(!result.errorCount&&result.warningCount>0)!==(result.status==='warning')||result.issues.length>result.errorCount+result.warningCount)bad();
  return result;
}
function issueSamples(value) {
  if(!Array.isArray(value)||value.length>20)bad();
  return value.map(i=>{
    if(!i||!Number.isSafeInteger(i.ordinal)||i.ordinal<0||!['warning','error'].includes(i.severity))bad();
    return {ordinal:i.ordinal,field:text(i.field,200,true),code:text(i.code,100,true),message:text(i.message,500,true),severity:i.severity};
  });
}
function details(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))bad();
  const result={};
  for(const key of ['requestId','requestHash','phase','stage','endpoint','xmlPath','xmlCharacterReference','contentType','charset','action','tallyMessage','from','to','serverDiagnosticId','operation','sqlState','constraint','table','stackLocation']) {
    if(value[key]!=null)result[key]=text(value[key]);
  }
  for(const key of ['httpStatus','bytesReceived','recordsReceived','recordsProcessed','discardedRecords','durationMs','xmlLine','xmlColumn','xmlPosition','errorCount','warningCount','attempt','chunkIndex']) {
    if(value[key]!=null){if(!Number.isSafeInteger(value[key])||value[key]<0)bad();result[key]=value[key];}
  }
  if(value.errorCodes!==undefined){if(!Array.isArray(value.errorCodes)||value.errorCodes.length>20||value.errorCodes.some(v=>typeof v!=='string'||!/^\w{1,64}$/.test(v)))bad();result.errorCodes=value.errorCodes;}
  if(value.issues!==undefined)result.issues=issueSamples(value.issues);
  return result;
}
function validateEvent(value) {
  if(!value||!uuid(value.id)||(value.runId!=null&&!uuid(value.runId))||typeof value.occurredAt!=='string'||!Number.isFinite(Date.parse(value.occurredAt)))bad();
  const severity=value.severity||'error';if(!['error','warning'].includes(severity))bad();
  return {id:value.id,occurredAt:new Date(value.occurredAt).toISOString(),runId:value.runId||null,
    batchId:text(value.batchId,200),company:value.company?{externalId:text(value.company.externalId,200,true),name:text(value.company.name,200,true)}:null,
    collection:text(value.collection,80),event:text(value.event,100,true),severity,message:text(value.message,2000,true),details:details(value.details),exporter:exporter(value.exporter)};
}
function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
async function save(input,origin='sender') {
  if(!Array.isArray(input?.events)||!input.events.length||input.events.length>25)bad();
  const events=input.events.map(validateEvent);
  return db.transaction(async client=>{
    for(const e of events) {
      const checksum=createHash('sha256').update(canonical(e)).digest('hex');
      const inserted=await client.query(`INSERT INTO tally_diagnostics(id,occurred_at,run_id,batch_id,company_external_id,company_name,collection,event,severity,message,details,exporter,origin,checksum)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO NOTHING RETURNING id`,
        [e.id,e.occurredAt,e.runId,e.batchId,e.company?.externalId||null,e.company?.name||null,e.collection,e.event,e.severity,e.message,JSON.stringify(e.details),e.exporter?JSON.stringify(e.exporter):null,origin,checksum]);
      if(!inserted.rowCount){const prior=(await client.query('SELECT checksum,origin FROM tally_diagnostics WHERE id=$1',[e.id])).rows[0];
        if(prior.checksum!==checksum||prior.origin!==origin)throw Object.assign(new Error('Diagnostic identity conflict'),{status:409});}
    }
    return {ok:true,ids:events.map(e=>e.id)};
  });
}
async function recordApiFailure(error,{operation,body}) {
  const id=randomUUID();
  const detail={operation,stage:'api',errorCodes:[String(error.code||error.name||'Error').replace(/\W/g,'').slice(0,64)],
    stackLocation:String(error.stack||'').split('\n').slice(1).filter(line=>/^\s+at /.test(line)).slice(0,8).join('\n').slice(0,1800),
    ...(Number.isSafeInteger(body?.index)&&body.index>=0?{chunkIndex:body.index}:{}),
    ...(error.code?{sqlState:String(error.code).slice(0,80)}:{}),
    ...(error.constraint?{constraint:String(error.constraint).slice(0,200)}:{}),
    ...(error.table?{table:String(error.table).slice(0,200)}:{})};
  // Database DETAIL can contain actual row values. Persist structure and stack
  // location separately from private rows, query parameters or request bodies.
  const e={id,occurredAt:new Date().toISOString(),batchId:typeof body?.batchId==='string'?body.batchId.slice(0,200):null,
    event:'api_source_failed',message:redact(error.status?String(error.message):`Source ${operation} failed (${error.code||error.name||'Error'})`).slice(0,2000),details:detail};
  if(e.batchId){
    const snapshot=(await db.query('SELECT company_external_id,company_name FROM tally_source_snapshots WHERE batch_id=$1',[e.batchId])).rows[0];
    if(snapshot)e.company={externalId:snapshot.company_external_id,name:snapshot.company_name};
    else {const upload=(await db.query('SELECT manifest FROM tally_source_uploads WHERE batch_id=$1',[e.batchId])).rows[0];if(upload)e.company=upload.manifest.company;}
  }
  else if(typeof body?.companyExternalId==='string'&&body.companyExternalId.length<=200)e.company={externalId:body.companyExternalId,name:body.companyExternalId};
  await save({events:[e]},'api');return id;
}
async function list(query={}) {
  const id=companyFilter(query.company),{size,current,offset}=paging(query.page||1,Math.min(Number(query.pageSize||25),100));
  const batch=text(query.batch||null,200);
  const where=`FROM tally_diagnostics d LEFT JOIN "Companies" c ON c."ExternalID"=d.company_external_id WHERE ($1=0 OR c."CompanyID"=$1) AND ($2::text IS NULL OR d.batch_id=$2)`;
  const total=(await db.query(`SELECT count(*)::int count ${where}`,[id,batch])).rows[0].count;
  const rows=await db.query(`SELECT d.id,d.occurred_at,d.received_at,d.run_id,d.batch_id,d.company_name,d.company_external_id,d.collection,d.event,d.severity,d.message,d.details,d.exporter,d.origin ${where} ORDER BY d.received_at DESC,d.id DESC LIMIT $3 OFFSET $4`,[id,batch,size,offset]);
  return {items:rows.rows,total,page:current,pageSize:size};
}
module.exports={validateEvent,save,list,recordApiFailure,exporter,readiness,details};
