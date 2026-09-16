const {createHash}=require('node:crypto');
const db=require('./db');
const {validateSnapshot}=require('./ingest');
const period=require('./sourcePeriod');
const diagnostics=require('./sourceDiagnostics');
const COLLECTIONS=['COMPANY','GROUP','LEDGER','VOUCHERTYPE','CURRENCY','COSTCATEGORY','COSTCENTRE','STOCKGROUP','STOCKCATEGORY','STOCKITEM','UNIT','GODOWN','VOUCHER'];
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
// JSONB changes object key order, so hashes must be independent of key order.
function canonical(value) {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
function manifest(input,mode='full') {
  if(mode==='full'&&input?.scope!==undefined)fail('Use the period endpoint for a scoped capture');
  if(input?.periodMode!==undefined&&mode!=='period-replace')fail('Use the replacement endpoint for replacement mode');
  if(mode==='period-replace'&&input?.periodMode!=='replace')fail('Period replacement mode is required');
  const scope=['period','period-replace'].includes(mode)?period.scope(input?.scope):undefined;
  const {batchId,capturedAt,company}=validateSnapshot({...input,fullSnapshot:true,ledgers:[],vouchers:[]});
  if(input.schemaVersion!==1 || input.profile!=='company-business-v1') fail('Unsupported source archive version');
  if(!Number.isSafeInteger(input.chunkCount)||input.chunkCount<1||input.chunkCount>10000) fail('Invalid source chunkCount');
  if(!Array.isArray(input.collections)||input.collections.length!==COLLECTIONS.length) fail('Source coverage catalog required');
  const collections=COLLECTIONS.map(name=>{
    const matches=input.collections.filter(c=>c?.name===name);
    if(matches.length!==1) fail('Source coverage catalog mismatch');
    const c=matches[0];
    if(!['success','failed'].includes(c.status)||!Number.isSafeInteger(c.count)||c.count<0||c.count>5000000) fail('Invalid collection coverage');
    if(c.status==='failed'&&c.count!==0) fail('Failed collections cannot publish partial records');
    if(c.readiness&&c.readiness.records!==c.count)fail('Financial readiness record count mismatch');
    return {name,status:c.status,count:c.count,...(c.readiness?{readiness:diagnostics.readiness(c.readiness)}:{}),
      ...(c.diagnostic?{diagnostic:diagnostics.details(c.diagnostic)}:{})};
  });
  if(!['stable','unavailable','changed'].includes(input.consistency)) fail('Source consistency required');
  if(!Number.isSafeInteger(input.recordCount)||input.recordCount!==collections.reduce((n,c)=>n+c.count,0)) fail('Source count mismatch');
  const complete=collections.every(c=>c.status==='success')&&input.consistency!=='changed';
  if(scope&&!complete)fail('A period update requires complete collection coverage and unchanged source');
  const coverageStatus=complete&&!scope ? 'complete' : 'partial';
  if(collections.find(c=>c.name==='COMPANY').status==='success'&&collections.find(c=>c.name==='COMPANY').count!==1) fail('Exactly one company record required');
  let dateContext;
  if(input.dateContext){
    const readDates=key=>{const value=input.dateContext[key];return {from:period.scope({kind:'period',...value}).from,to:value.to};};
    dateContext={ledgers:readDates('ledgers'),vouchers:readDates('vouchers')};
    if(scope&&(dateContext.vouchers.from!==scope.from||dateContext.vouchers.to!==scope.to))fail('Voucher date context does not match capture scope');
  }
  return {batchId,capturedAt,company,schemaVersion:1,profile:input.profile,chunkCount:input.chunkCount,
    recordCount:input.recordCount,collections,consistency:input.consistency,coverageStatus,
    ...(input.exporter?{exporter:diagnostics.exporter(input.exporter)}:{}),
    ...(input.reconciliation?{reconciliation:diagnostics.readiness(input.reconciliation)}:{}),...(dateContext?{dateContext}:{}),
    ...(scope?{scope}:{}),...(mode==='period-replace'?{periodMode:'replace'}:{})};
}
function validateTree(node,depth=0,budget={nodes:0}) {
  if(++budget.nodes>100000||depth>64) fail('Source XML tree exceeds limits');
  if(typeof node==='string') {if(node.includes('\0')) fail('Invalid source text');return;}
  if(!node||Array.isArray(node)||typeof node!=='object'||typeof node.tag!=='string'||!node.tag||node.tag.length>200||node.tag.includes('\0')) fail('Invalid source XML node');
  if(!node.attributes||Array.isArray(node.attributes)||typeof node.attributes!=='object'||!Array.isArray(node.content)) fail('Invalid source XML structure');
  if(Object.keys(node).some(k=>!['tag','attributes','content'].includes(k))) fail('Unknown source node fields');
  for(const [key,value] of Object.entries(node.attributes)) if(!key||key.length>200||key.includes('\0')||typeof value!=='string'||value.includes('\0')) fail('Invalid source attribute');
  for(const child of node.content) validateTree(child,depth+1,budget);
}
async function locked(work) {
  return db.transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(74312003)');
    return work(client);
  });
}
async function begin(input,mode='full') {
  const m=manifest(input,mode);
  return locked(async client=>{
    await client.query("DELETE FROM tally_source_uploads WHERE result IS NULL AND updated_at < now()-interval '7 days'");
    const prior=(await client.query('SELECT manifest,result FROM tally_source_uploads WHERE batch_id=$1',[m.batchId])).rows[0];
    if(prior) {
      if(digest(prior.manifest)!==digest(m)) fail('Source manifest conflict',409);
      await client.query('UPDATE tally_source_uploads SET updated_at=now() WHERE batch_id=$1',[m.batchId]);
      return {ok:true,batchId:m.batchId,completed:!!prior.result};
    }
    const {count}=(await client.query('SELECT count(*)::int AS count FROM tally_source_uploads WHERE result IS NULL')).rows[0];
    if(count>=100) fail('Too many source uploads',429);
    if(m.scope)await period.baseline(client,m.company.externalId,m.capturedAt,m.periodMode==='replace');
    await client.query('INSERT INTO tally_source_uploads(batch_id,manifest) VALUES($1,$2)',[m.batchId,JSON.stringify(m)]);
    return {ok:true,batchId:m.batchId,completed:false};
  });
}
async function chunk(input,mode='full') {
  if(typeof input?.batchId!=='string'||!Number.isSafeInteger(input.index)||input.index<0||!Array.isArray(input.records)||input.records.length>500) fail('Invalid source chunk');
  const bytes=Buffer.byteLength(JSON.stringify(input.records));
  if(bytes>4*1024**2) fail('Source chunk exceeds 4 MiB',413);
  for(const row of input.records) {
    if(!row||!COLLECTIONS.includes(row.collection)||!Number.isSafeInteger(row.ordinal)||row.ordinal<0||row.ordinal>=5000000) fail('Invalid source record identity');
    if(row.sourceId!==null&&(typeof row.sourceId!=='string'||row.sourceId.length>2000||row.sourceId.includes('\0'))) fail('Invalid source ID');
    validateTree(row.payload);
    if(typeof row.payload==='string'||row.payload.tag.toUpperCase()!==row.collection) fail('Source record type mismatch');
  }
  const records=input.records.map(({collection,ordinal,sourceId,payload})=>({collection,ordinal,sourceId,payload}));
  const checksum=digest(records);
  return locked(async client=>{
    const upload=(await client.query('SELECT * FROM tally_source_uploads WHERE batch_id=$1 FOR UPDATE',[input.batchId])).rows[0];
    if(!upload) fail('Begin source upload first',409);
    if((upload.manifest.periodMode==='replace'?'period-replace':upload.manifest.scope?'period':'full')!==mode)fail('Source upload endpoint mismatch',409);
    if(input.index>=upload.manifest.chunkCount) fail('Source index outside manifest');
    // Completed receipts retain per-chunk hashes, rejecting changed retries.
    const prior=(await client.query('SELECT checksum FROM tally_source_chunks WHERE batch_id=$1 AND chunk_index=$2',[input.batchId,input.index])).rows[0];
    const oldHash=prior?.checksum||upload.result?.chunkChecksums?.[input.index];
    if(oldHash) {
      if(oldHash!==checksum) fail('Source chunk conflict',409);
      return {ok:true,batchId:input.batchId,index:input.index,duplicate:true};
    }
    if(upload.result) fail('Source receipt missing chunk',409);
    for(const row of records) {
      if(upload.manifest.scope&&row.collection==='VOUCHER')period.voucher(row,upload.manifest.scope);
      const coverage=upload.manifest.collections.find(c=>c.name===row.collection);
      if(coverage.status!=='success'||row.ordinal>=coverage.count) fail('Record outside declared source coverage');
    }
    if(Number(upload.bytes)+bytes>512*1024**2) fail('Source snapshot exceeds 512 MiB',413);
    const {total}=(await client.query('SELECT coalesce(sum(bytes),0) AS total FROM tally_source_uploads WHERE result IS NULL')).rows[0];
    if(Number(total)+bytes>2*1024**3) fail('Source staging capacity reached',429);
    await client.query('INSERT INTO tally_source_chunks VALUES($1,$2,$3,$4)',[input.batchId,input.index,checksum,JSON.stringify(records)]);
    await client.query('UPDATE tally_source_uploads SET bytes=bytes+$2,updated_at=now() WHERE batch_id=$1',[input.batchId,bytes]);
    return {ok:true,batchId:input.batchId,index:input.index};
  });
}
async function complete(input,mode='full') {
  if(typeof input?.batchId!=='string') fail('Source batchId required');
  return locked(async client=>{
    const upload=(await client.query('SELECT * FROM tally_source_uploads WHERE batch_id=$1 FOR UPDATE',[input.batchId])).rows[0];
    if(!upload) fail('Source upload not found',409);
    if((upload.manifest.periodMode==='replace'?'period-replace':upload.manifest.scope?'period':'full')!==mode)fail('Source upload endpoint mismatch',409);
    if(upload.result) {const {chunkChecksums,...receipt}=upload.result;return {...receipt,duplicate:true};}
    const chunks=(await client.query('SELECT chunk_index,checksum FROM tally_source_chunks WHERE batch_id=$1 ORDER BY chunk_index',[input.batchId])).rows;
    const m=upload.manifest;
    if(m.scope)await client.query('SELECT pg_advisory_xact_lock(74312002)');
    if(chunks.length!==m.chunkCount||chunks.some((c,i)=>c.chunk_index!==i)) fail('Source upload incomplete',409);
    await client.query('INSERT INTO tally_source_snapshots(batch_id,company_external_id,company_name,captured_at,schema_version,coverage_status,manifest) VALUES($1,$2,$3,$4,1,$5,$6)',
      [m.batchId,m.company.externalId,m.company.name,m.capturedAt,m.coverageStatus,JSON.stringify(m)]);
    const counts=Object.fromEntries(COLLECTIONS.map(c=>[c,0]));
    for(const c of chunks) {
      const {payload}=(await client.query('SELECT payload FROM tally_source_chunks WHERE batch_id=$1 AND chunk_index=$2',[m.batchId,c.chunk_index])).rows[0];
      for(const record of payload) {
        counts[record.collection]++;
        if(record.collection==='COMPANY') {
          const fields=record.payload.content.filter(n=>typeof n==='object'&&n.tag.toUpperCase()==='GUID');
          const attribute=Object.entries(record.payload.attributes).find(([key])=>key.toUpperCase()==='GUID')?.[1];
          const guid=fields.length===1&&fields[0].content.every(v=>typeof v==='string')?fields[0].content.join(''):fields.length?null:attribute;
          if(guid!==m.company.externalId) fail('Source company does not match transfer identity',409);
        }
      }
      // Primary key rejects duplicated ordinals. Count + bounded ordinals proves
      // every declared record is present, without materializing a full snapshot.
      await client.query(`INSERT INTO tally_source_records(batch_id,collection,ordinal,source_id,payload)
        SELECT $1, r->>'collection',(r->>'ordinal')::int,r->>'sourceId',r->'payload' FROM jsonb_array_elements($2::jsonb) r`,[m.batchId,JSON.stringify(payload)]);
    }
    if(m.collections.some(c=>counts[c.name]!==c.count)) fail('Source record counts do not match manifest',409);
    const result={ok:true,batchId:m.batchId,recordCount:m.recordCount,coverageStatus:m.coverageStatus,duplicate:false};
    if(m.scope)result.reportingBatchId=await period.merge(client,m);
    if(m.periodMode)result.periodMode=m.periodMode;
    await client.query('UPDATE tally_source_uploads SET result=$2,bytes=0,updated_at=now() WHERE batch_id=$1',[m.batchId,JSON.stringify({...result,chunkChecksums:chunks.map(c=>c.checksum)})]);
    await client.query('DELETE FROM tally_source_chunks WHERE batch_id=$1',[m.batchId]);
    return result;
  });
}
module.exports={COLLECTIONS,manifest,validateTree,begin,chunk,complete};
