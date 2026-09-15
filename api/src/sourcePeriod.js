const {randomUUID}=require('node:crypto');
const fail=(message,status=409,code)=>{throw Object.assign(new Error(message),{status,...(code?{code}:{})});};
function scope(value) {
  const valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  if(!value||value.kind!=='period'||!valid(value.from)||!valid(value.to)||value.from>value.to)fail('Invalid period dates',400);
  return {kind:'period',from:value.from,to:value.to};
}
function field(node,name) {
  const children=node.content.filter(n=>typeof n==='object'&&n.tag.toUpperCase()===name);
  if(children.length===1&&children[0].content.every(v=>typeof v==='string'))return children[0].content.join('');
  if(children.length)return null;
  return Object.entries(node.attributes).find(([key])=>key.toUpperCase()===name)?.[1];
}
function voucher(row,period) {
  const guid=field(row.payload,'GUID');
  if(!guid||guid!==guid.trim()||row.sourceId!==guid)fail('Period updates require a unique voucher GUID. Run a full sync and review missing identities.');
  if(period) {
    const raw=field(row.payload,'DATE');
    const date=typeof raw==='string'&&/^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`:raw;
    scope({kind:'period',from:date,to:date});
    if(date<period.from||date>period.to)fail('Voucher date is outside the selected period');
  }
}
function voucherDate(row) {
  const raw=field(row.payload,'DATE');
  const date=typeof raw==='string'&&/^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`:raw;
  scope({kind:'period',from:date,to:date});return date;
}
function historyCoverage(base,period) {
  if(base&&(base.manifest.historyCoverage?.kind==='full'||!base.manifest.historyCoverage))return {kind:'full'};
  const ranges=[...(base?.manifest.historyCoverage?.periods||[]),{from:period.from,to:period.to}].sort((a,b)=>a.from.localeCompare(b.from));
  const periods=[];
  for(const range of ranges){const prior=periods.at(-1);if(prior&&Date.parse(range.from)<=Date.parse(prior.to)+86400000)prior.to=prior.to>range.to?prior.to:range.to;else periods.push({...range});}
  return {kind:'periods',periods};
}
async function baseline(client,externalId,capturedAt,allowFirst=false) {
  if(allowFirst){
    // Failed/staged archives do not become the replacement baseline. Publication
    // checks this baseline again under the import lock to reject racing changes.
    const published=(await client.query(`SELECT s.batch_id,s.captured_at,s.manifest FROM finance_snapshots f
      JOIN "Companies" c ON c."CompanyID"=f.company_id JOIN tally_source_snapshots s ON s.batch_id=f.batch_id
      WHERE c."ExternalID"=$1`,[externalId])).rows[0]||null;
    if(published&&capturedAt&&Date.parse(capturedAt)<=new Date(published.captured_at).getTime())fail('Period capture is stale. Run a fresh sync after the latest Finance update.',409,'PERIOD_CAPTURE_STALE');
    return published;
  }
  const row=(await client.query(`SELECT s.batch_id,s.captured_at,s.manifest,f.batch_id AS published
    FROM tally_source_latest l JOIN tally_source_snapshots s ON s.batch_id=l.batch_id
    LEFT JOIN "Companies" c ON c."ExternalID"=s.company_external_id
    LEFT JOIN finance_snapshots f ON f.company_id=c."CompanyID"
    WHERE s.company_external_id=$1`,[externalId])).rows[0];
  if(!row&&allowFirst)return null;
  if(!row||row.published!==row.batch_id)fail(allowFirst?'Resolve the pending Finance processing before replacing another period.':'A successful full sync is required first. Resolve any pending Finance processing before a period sync.');
  if(capturedAt&&Date.parse(capturedAt)<=new Date(row.captured_at).getTime())fail('Period capture is stale. Run a fresh sync after the latest Finance update.',409,'PERIOD_CAPTURE_STALE');
  return row;
}
async function merge(client,m) {
  const replace=m.periodMode==='replace';
  const base=await baseline(client,m.company.externalId,m.capturedAt,replace);
  await client.query('CREATE TEMP TABLE period_retained_ordinals(ordinal integer PRIMARY KEY) ON COMMIT DROP');
  // Read in bounded pages: validate source identity before trusting an SQL merge.
  for(const id of [base?.batch_id,m.batchId].filter(Boolean)) {
    let ordinal=-1;
    for(;;) {
      const rows=(await client.query(`SELECT ordinal,source_id AS "sourceId",payload FROM tally_source_records
        WHERE batch_id=$1 AND collection='VOUCHER' AND ordinal>$2 ORDER BY ordinal LIMIT 500`,[id,ordinal])).rows;
      if(!rows.length)break;
      for(const row of rows)voucher(row,id===m.batchId?m.scope:null);
      if(replace&&id===base?.batch_id){
        const retained=rows.filter(row=>{const date=voucherDate(row);return date<m.scope.from||date>m.scope.to;}).map(row=>row.ordinal);
        if(retained.length)await client.query('INSERT INTO period_retained_ordinals SELECT unnest($1::int[])',[retained]);
      }
      ordinal=rows.at(-1).ordinal;
    }
    if((await client.query(`SELECT 1 FROM tally_source_records WHERE batch_id=$1 AND collection='VOUCHER'
      GROUP BY source_id HAVING count(*)>1 LIMIT 1`,[id])).rowCount)fail('Duplicate voucher GUIDs prevent a safe period update');
  }
  const batchId=randomUUID();
  const derived={...m,batchId,scope:undefined,kind:'cumulative',baselineBatchId:base?.batch_id||null,periodBatchId:m.batchId,period:m.scope,
    fullBaselineBatchId:base?.manifest.fullBaselineBatchId||(base&&!base.manifest.historyCoverage?base.batch_id:null),historyCoverage:historyCoverage(base,m.scope),coverageStatus:'complete'};
  await client.query(`INSERT INTO tally_source_snapshots(batch_id,company_external_id,company_name,captured_at,schema_version,coverage_status,manifest)
    VALUES($1,$2,$3,$4,1,'complete',$5)`,[batchId,m.company.externalId,m.company.name,m.capturedAt,JSON.stringify(derived)]);
  // Current masters use full-date context. Replacement removes missing vouchers
  // only in the selected dates; legacy period clients retain preserve semantics.
  await client.query(`INSERT INTO tally_source_records(batch_id,collection,ordinal,source_id,payload)
    SELECT $1,collection,(row_number() OVER(PARTITION BY collection ORDER BY origin,ordinal)-1)::int,source_id,payload
    FROM (
      SELECT collection,ordinal,source_id,payload,1 AS origin FROM tally_source_records WHERE batch_id=$2
      UNION ALL
      SELECT b.collection,b.ordinal,b.source_id,b.payload,0 FROM tally_source_records b
      WHERE b.batch_id=$3 AND b.collection='VOUCHER'
      AND (NOT $4::boolean OR b.ordinal IN (SELECT ordinal FROM period_retained_ordinals)) AND NOT EXISTS(
        SELECT 1 FROM tally_source_records n WHERE n.batch_id=$2 AND n.collection='VOUCHER' AND n.source_id=b.source_id)
    ) records`,[batchId,m.batchId,base?.batch_id||null,replace]);
  const counts=(await client.query('SELECT collection,count(*)::int AS count FROM tally_source_records WHERE batch_id=$1 GROUP BY collection',[batchId])).rows;
  derived.collections=m.collections.map(c=>({...c,count:counts.find(r=>r.collection===c.name)?.count||0}));
  derived.recordCount=derived.collections.reduce((sum,c)=>sum+c.count,0);
  // A derived archive is not an uploaded chunk set.
  delete derived.chunkCount;
  await client.query('UPDATE tally_source_snapshots SET manifest=$2 WHERE batch_id=$1',[batchId,JSON.stringify(derived)]);
  return batchId;
}
module.exports={scope,voucher,baseline,merge};
