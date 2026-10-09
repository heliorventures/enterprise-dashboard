const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { analyzeWorkbook, classifyRow } = require('../excel/parser');
const { loadMaps, resolveMaps, saveDetectedMaps } = require('../mapping/engine');
const { netOutstanding, ageingEntries } = require('../transform/normalize');
const tally = require('../tally/provider');
const { reconcileAccounts } = require('../reconciliation/engine');
const audit = require('../audit');
const { stage, shouldPublish } = require('./publication');
const decimal = require('../transform/decimal');

async function rulesFor() {
  const result = await db.query(`SELECT key, value FROM intel_rules WHERE company_id IS NULL`);
  return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
}

async function ensureCompany({ companyId }) {
  if (!companyId || companyId === 'all') {
    throw Object.assign(new Error('Select the company this Excel file belongs to'), { status: 400 });
  }
  const tallyId = Number(companyId);
  if (!Number.isInteger(tallyId) || tallyId <= 0) {
    throw Object.assign(new Error('Select the company this Excel file belongs to'), { status: 400 });
  }
  const tallyCompany = await db.query(
    `SELECT "CompanyID" AS id, "CompanyName" AS name
     FROM "Companies"
     WHERE "CompanyID"=$1 AND COALESCE("IsActive", true) = true`,
    [tallyId]
  );
  if (!tallyCompany.rowCount) {
    throw Object.assign(new Error('Unknown company'), { status: 400 });
  }
  const existing = await db.query(
    'SELECT * FROM intel_companies WHERE tally_company_id=$1 AND active=true',
    [tallyId]
  );
  if (existing.rowCount) {
    const current = existing.rows[0];
    if (current.name !== tallyCompany.rows[0].name) {
      await db.query('UPDATE intel_companies SET name=$2 WHERE id=$1', [current.id, tallyCompany.rows[0].name]);
      return { ...current, name: tallyCompany.rows[0].name };
    }
    return current;
  }
  const inserted = await db.query(
    `INSERT INTO intel_companies (name, tally_company_id, active)
     VALUES ($1,$2,true)
     RETURNING *`,
    [tallyCompany.rows[0].name, tallyId]
  );
  return inserted.rows[0];
}

async function excelSource() {
  const result = await db.query(`SELECT * FROM intel_source_systems WHERE type='EXCEL' ORDER BY name LIMIT 1`);
  return result.rows[0];
}

async function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}



async function markProgress(batchId, percent, message) {
  if (!batchId) return;
  await db.query(
    `UPDATE intel_import_batches SET progress_percent=$2, progress_message=$3 WHERE id=$1`,
    [batchId, percent, message],
  );
}

async function requiredFields() {
  const result = await db.query(
    `SELECT field_key, label FROM intel_field_catalog WHERE required=true ORDER BY field_key`,
  );
  return result.rows;
}

async function upload({ buffer, fileName, companyId, uploadedBy }) {
  const fileHash = await hashBuffer(buffer);
  const existing = await db.query(
    `SELECT id, file_name, uploaded_at, status FROM intel_import_files WHERE file_hash=$1 ORDER BY uploaded_at DESC LIMIT 1`,
    [fileHash]
  );
  const source = await excelSource();
  const company = await ensureCompany({ companyId });
  const analysis = await analyzeWorkbook(buffer);
  const maps = await loadMaps(db, { sourceSystemId: source?.id, companyId: company.id });
  analysis.columns = resolveMaps(maps, analysis.columns);
  const detectedName = analysis.entity.company || '';
  const companyMismatch = Boolean(
    detectedName
    && tally.normalizeName(detectedName)
    && tally.normalizeName(detectedName) !== tally.normalizeName(company.name)
  );
  const dir = path.join(config.storageDir, 'imports');
  await fs.mkdir(dir, { recursive: true });
  const storedName = `${fileHash.slice(0, 16)}-${fileName.replace(/[^\w.\-]+/g, '_')}`;
  const storedPath = path.join(dir, storedName);
  await fs.writeFile(storedPath, buffer);
  const file = await db.query(
    `INSERT INTO intel_import_files (
        company_id, source_system_id, file_name, stored_path, file_hash, file_size, uploaded_by, status,
        reporting_period_from, reporting_period_to, detected_title, detected_company, analysis
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ANALYZED',$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      company.id, source?.id || null, fileName, storedPath, fileHash, buffer.length, uploadedBy,
      analysis.period.from, analysis.period.to, analysis.title, analysis.entity.company,
      {
        sheet: analysis.sheet,
        structure: analysis.structure,
        columns: analysis.columns,
        counts: analysis.counts,
        entity: analysis.entity,
        period: analysis.period,
        title: analysis.title,
        selectedCompany: { id: company.id, name: company.name, tallyCompanyId: company.tally_company_id },
        companyMismatch,
        duplicateOf: existing.rows[0] || null,
      },
    ]
  );
  await saveDetectedMaps(db, analysis.columns.filter((col) => col.target), { sourceSystemId: source?.id, companyId: company.id });
  await audit.record({
    username: uploadedBy, action: 'UPLOAD', entity: 'import_file', entityId: file.rows[0].id,
    newValue: { fileName, fileHash, duplicate: Boolean(existing.rowCount) },
  });
  return {
    file: file.rows[0],
    duplicate: existing.rows[0] || null,
    selectedCompany: { id: company.id, name: company.name, tallyCompanyId: company.tally_company_id },
    companyMismatch,
    analysis: {
      title: analysis.title,
      company: analysis.entity,
      period: analysis.period,
      sheet: analysis.sheet,
      structure: analysis.structure,
      columns: analysis.columns,
      counts: analysis.counts,
      preview: analysis.preview,
    },
  };
}

function summaryPayload(file) {
  const analysis = file.analysis || {};
  return {
    id: file.id,
    fileName: file.file_name,
    status: file.status,
    companyId: file.company_id,
    detectedCompany: file.detected_company,
    detectedTitle: file.detected_title,
    period: { from: file.reporting_period_from, to: file.reporting_period_to },
    uploadedAt: file.uploaded_at,
    duplicate: analysis.duplicateOf || null,
    counts: analysis.counts,
    columns: analysis.columns,
    structure: analysis.structure,
    entity: analysis.entity,
    sheet: analysis.sheet,
  };
}

async function getFile(id) {
  const result = await db.query(
    `SELECT f.*, c.name AS company_name, s.name AS source_name
     FROM intel_import_files f
     LEFT JOIN intel_companies c ON c.id=f.company_id
     LEFT JOIN intel_source_systems s ON s.id=f.source_system_id
     WHERE f.id=$1`,
    [id]
  );
  if (!result.rowCount) throw Object.assign(new Error('Import not found'), { status: 404 });
  return result.rows[0];
}

async function preview(id) {
  const file = await getFile(id);
  const buffer = await fs.readFile(file.stored_path);
  const analysis = await analyzeWorkbook(buffer);
  const maps = await loadMaps(db, { sourceSystemId: file.source_system_id, companyId: file.company_id });
  analysis.columns = resolveMaps(maps, analysis.columns);
  return {
    file: summaryPayload(file),
    columns: analysis.columns,
    preview: analysis.preview,
    counts: analysis.counts,
  };
}

async function prepare(file, database = db) {
  const analysis = await analyzeWorkbook(await fs.readFile(file.stored_path));
  const maps = await loadMaps(database, {sourceSystemId:file.source_system_id, companyId:file.company_id});
  const columns = resolveMaps(maps, analysis.columns);
  let categoryPath=[],lastType=null;
  analysis.rows = analysis.rows.map(row=>{
    const rowType=classifyRow(row.raw,columns);
    if (rowType==='GROUP') {
      const name=String(row.raw[columns.find(column=>column.target==='account_name')?.canonical] || row.raw.Particulars || '').trim();
      categoryPath=lastType==='GROUP'?[...categoryPath,name]:[name];
    }
    if (rowType!=='IGNORED') lastType=rowType;
    return {...row,rowType,categoryPath:['DETAIL','GROUP'].includes(rowType)?[...categoryPath]:[]};
  });
  analysis.counts={...analysis.counts,dataRows:analysis.rows.filter(row=>row.rowType==='DETAIL').length,groupRows:analysis.rows.filter(row=>row.rowType==='GROUP').length};
  const ruleRows = await database.query('SELECT key,value FROM intel_rules WHERE company_id IS NULL OR company_id=$1 ORDER BY company_id NULLS FIRST', [file.company_id]);
  const rules = Object.fromEntries(ruleRows.rows.map(row => [row.key,row.value]));
  const required = (await database.query('SELECT field_key,label FROM intel_field_catalog WHERE required=true')).rows;
  return {analysis, columns, rules, ...stage(analysis, columns, required, rules)};
}

async function validateOnly(id) {
  return db.transaction(async client => {
    const file = (await client.query('SELECT * FROM intel_import_files WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if (!file) throw Object.assign(new Error('Import not found'),{status:404});
    if (file.status === 'PROCESSING') throw Object.assign(new Error('Import is processing'),{status:409});
    const prepared = await prepare(file,client);
    await client.query(`UPDATE intel_import_files SET status=CASE WHEN status='COMPLETED' THEN status ELSE 'VALIDATED' END,analysis=$2 WHERE id=$1`,
      [id,{...file.analysis,columns:prepared.columns,validation:prepared.validation}]);
    return prepared.validation;
  });
}

async function claim(id, {username,reprocess=false,reference: frozenReference,inputs: frozenInputs}={}, database=db) {
  return database.transaction(async client => {
    const owner=(await client.query('SELECT company_id FROM intel_import_files WHERE id=$1',[id])).rows[0];
    if (!owner) throw Object.assign(new Error('Import not found'),{status:404});
    await client.query('SELECT pg_advisory_xact_lock(61009,hashtext($1))',[owner.company_id]);
    const file = (await client.query('SELECT * FROM intel_import_files WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if (!file) throw Object.assign(new Error('Import not found'),{status:404});
    const active = (await client.query(`SELECT * FROM intel_import_batches WHERE import_file_id=$1 AND status='PROCESSING' ORDER BY generation DESC LIMIT 1`,[id])).rows[0];
    if (active && Date.now()-new Date(active.heartbeat_at || active.started_at).getTime()<120000) return {existing:true,batch:active};
    if (active) await client.query(`UPDATE intel_import_batches SET status='FAILED',error_message='Interrupted import recovered',completed_at=now() WHERE id=$1`,[active.id]);
    const previous = (await client.query(`SELECT * FROM intel_import_batches WHERE import_file_id=$1 AND status='COMPLETED' ORDER BY generation DESC LIMIT 1`,[id])).rows[0];
    if (previous && !reprocess) {
      await client.query(`UPDATE intel_import_files SET selected_batch_id=$2,status='COMPLETED' WHERE id=$1`,[id,previous.id]);
      return {existing:true,batch:previous};
    }
    const prepared = frozenInputs || await prepare(file,client);
    if (!prepared.validation.canProcess) throw Object.assign(new Error('Validation failed; correct required fields, duplicate accounts and invalid values before processing'),{status:400});
    const reference = frozenReference || await tally.snapshot((await client.query('SELECT tally_company_id FROM intel_companies WHERE id=$1',[file.company_id])).rows[0]?.tally_company_id,client);
    const accountMaps = (await client.query('SELECT * FROM intel_account_maps WHERE company_id=$1',[file.company_id])).rows;
    const token = randomUUID();
    const frozen = {columns:prepared.columns,rules:prepared.rules,validation:prepared.validation,totals:prepared.totals,
      staged:prepared.staged,analysis:prepared.analysis,reference,accountMaps,mappingVersion:frozenInputs?.mappingVersion ?? file.mapping_version,username};
    const batch = (await client.query(`INSERT INTO intel_import_batches(import_file_id,company_id,generation,status,started_at,heartbeat_at,lease_token,reporting_date,tally_batch_id,tally_balance_date,frozen_inputs,progress_percent,progress_message)
      SELECT $1,$2,COALESCE(max(generation),0)+1,'PROCESSING',now(),now(),$3,$4,$5,$6,$7,5,'Preparing publication'
      FROM intel_import_batches WHERE import_file_id=$1 RETURNING *`,
      [id,file.company_id,token,file.reporting_period_to,reference.batchId,reference.balanceDate,frozen])).rows[0];
    await client.query(`UPDATE intel_import_files SET status='PROCESSING',analysis=$2,selected_batch_id=$3 WHERE id=$1`,[id,{...file.analysis,validation:prepared.validation,columns:prepared.columns},batch.id]);
    return {file,batch,token};
  });
}

async function processFile(id, options = {}) {
  const reserved = options.reserved || await claim(id,options);
  if (reserved.existing) return getResults(id);
  const {file,batch,token} = reserved;
  const batchId = batch.id;
  try {
  await db.transaction(client => publishGeneration(client,reserved));
  return getResults(id);
  } catch(error) {
    await db.transaction(async client => {
      await client.query('SELECT id FROM intel_import_files WHERE id=$1 FOR UPDATE',[id]);
      const failed = await client.query(`UPDATE intel_import_batches SET status='FAILED',error_message=$3,progress_message=$3,completed_at=now() WHERE id=$1 AND lease_token=$2 AND status='PROCESSING' RETURNING id`,[batchId,token,error.message]);
      if (failed.rowCount) await client.query(`UPDATE intel_import_files SET status='FAILED' WHERE id=$1`,[id]);
    });
    throw error;
  }
}

async function publishGeneration(client,reserved) {
  const {file,batch,token}=reserved;
  const id=file.id,batchId=batch.id;
  await client.query('SELECT pg_advisory_xact_lock(61009,hashtext($1))',[file.company_id]);
  await client.query('SELECT id FROM intel_import_files WHERE id=$1 FOR UPDATE',[id]);
  const owned = await client.query(`SELECT id FROM intel_import_batches WHERE id=$1 AND lease_token=$2 AND status='PROCESSING' FOR UPDATE`,[batchId,token]);
  if (!owned.rowCount) throw Object.assign(new Error('Import claim is no longer active'),{status:409});
  await client.query('SELECT id FROM intel_companies WHERE id=$1 FOR UPDATE',[file.company_id]);
  const previousPublication = (await client.query('SELECT * FROM intel_company_publications WHERE company_id=$1',[file.company_id])).rows[0];
  const publishEligible = !previousPublication || shouldPublish(previousPublication.reporting_date,file.reporting_period_to);
  const {staged,columns,rules:rulebook,analysis,totals,reference,accountMaps} = batch.frozen_inputs;
  const successful = staged.filter(item => item.row.rowType==='DETAIL').length;
  const warning = staged.filter(item => item.status==='WARNING').length;
  const failed = 0;
  const username = batch.frozen_inputs.username;
  const transactionalProgress = async (batchId,percent,message) => client.query('UPDATE intel_import_batches SET progress_percent=$2,progress_message=$3,heartbeat_at=now() WHERE id=$1 AND lease_token=$4',[batchId,percent,message,token]);
  const insertedRows = await client.query(
    `INSERT INTO intel_import_rows (import_batch_id, source_row_number, worksheet, row_type, raw_data, mapped_data, category_path, validation_status, errors)
     SELECT $1, x.source_row_number, x.worksheet, x.row_type, x.raw_data, x.mapped_data, x.category_path, x.validation_status, x.errors
     FROM jsonb_to_recordset($2::jsonb) AS x(
       source_row_number integer, worksheet text, row_type text, raw_data jsonb, mapped_data jsonb, category_path text[], validation_status text, errors jsonb
     )
     RETURNING id, source_row_number, row_type, validation_status`,
    [batchId, JSON.stringify(staged.map((item) => ({
      source_row_number: item.row.sourceRowNumber,
      worksheet: item.row.worksheet,
      row_type: item.row.rowType,
      raw_data: item.row.raw,
      mapped_data: item.mapped,
      category_path: item.row.categoryPath,
      validation_status: item.status,
      errors: item.errors,
    })))]
  );
  const idByRow = new Map(insertedRows.rows.map((row) => [row.source_row_number, row.id]));
  const details = staged
    .filter((item) => item.row.rowType === 'DETAIL' && item.status !== 'ERROR')
    .map((item) => ({ ...item, importRowId: idByRow.get(item.row.sourceRowNumber) }));

  const companyId = file.company_id;
  const reportingDate = file.reporting_period_to;
  if (details.length) {
    await transactionalProgress(batchId, 52, 'Saving accounts');
    const accounts = await client.query(
      `INSERT INTO intel_accounts (company_id, account_name, account_type, level_1_category, level_2_category, category_path, gst_number, pan_number, msme_number, credit_days)
       SELECT $1, x.account_name, x.account_type, x.level_1_category, x.level_2_category, x.category_path, x.gst_number, x.pan_number, x.msme_number, x.credit_days
       FROM jsonb_to_recordset($2::jsonb) AS x(
         account_name text, account_type text, level_1_category text, level_2_category text, category_path text[],
         gst_number text, pan_number text, msme_number text, credit_days numeric
       )
       ON CONFLICT (company_id, account_name) DO UPDATE SET
         gst_number=CASE WHEN $3 THEN EXCLUDED.gst_number ELSE intel_accounts.gst_number END,
         pan_number=CASE WHEN $3 THEN EXCLUDED.pan_number ELSE intel_accounts.pan_number END,
         msme_number=CASE WHEN $3 THEN EXCLUDED.msme_number ELSE intel_accounts.msme_number END,
         credit_days=CASE WHEN $3 THEN EXCLUDED.credit_days ELSE intel_accounts.credit_days END,
         account_type=CASE WHEN $3 THEN EXCLUDED.account_type ELSE intel_accounts.account_type END,
         level_1_category=CASE WHEN $3 THEN EXCLUDED.level_1_category ELSE intel_accounts.level_1_category END,
         level_2_category=CASE WHEN $3 THEN EXCLUDED.level_2_category ELSE intel_accounts.level_2_category END,
         category_path=CASE WHEN $3 THEN EXCLUDED.category_path ELSE intel_accounts.category_path END
       RETURNING *`,
      [companyId, JSON.stringify(Object.values(details.reduce((acc, item) => {
        const pathNames = item.row.categoryPath || [];
        acc[item.mapped.account_name] = {
          account_name: item.mapped.account_name,
          account_type: pathNames[0] || null,
          level_1_category: pathNames[0] || null,
          level_2_category: pathNames.length > 1 ? pathNames[pathNames.length - 1] : null,
          category_path: pathNames,
          gst_number: item.mapped.gst_number || null,
          pan_number: item.mapped.pan_number || null,
          msme_number: item.mapped.msme_number || null,
          credit_days: item.mapped.credit_days ?? null,
        };
        return acc;
      }, {}))), publishEligible]
    );
    const accountByName = new Map(accounts.rows.map((row) => [row.account_name, row]));
    await transactionalProgress(batchId, 64, 'Saving outstanding balances');
    const outstandingRows = await client.query(
      `INSERT INTO intel_outstanding (
          company_id, account_id, import_batch_id, import_row_id, reporting_date,
          bill_amount, paid_amount, pending_bill_debit, pending_bill_credit,
          last_payment_requisition_amount, last_payment_amount, last_payment_date, last_date, extra
       )
       SELECT $1, x.account_id, $2, x.import_row_id, $3, x.bill_amount, x.paid_amount, x.pending_bill_debit, x.pending_bill_credit,
              x.last_payment_requisition_amount, x.last_payment_amount, x.last_payment_date, x.last_date, x.extra
       FROM jsonb_to_recordset($4::jsonb) AS x(
         account_id uuid, import_row_id uuid, bill_amount numeric, paid_amount numeric, pending_bill_debit numeric, pending_bill_credit numeric,
         last_payment_requisition_amount numeric, last_payment_amount numeric, last_payment_date date, last_date date, extra jsonb
       )
       RETURNING *`,
      [companyId, batchId, reportingDate, JSON.stringify(details.map((item) => ({
        account_id: accountByName.get(item.mapped.account_name)?.id,
        import_row_id: item.importRowId,
        bill_amount: item.mapped.bill_amount || 0,
        paid_amount: item.mapped.paid_amount || 0,
        pending_bill_debit: item.mapped.pending_bill_debit || 0,
        pending_bill_credit: item.mapped.pending_bill_credit || 0,
        last_payment_requisition_amount: item.mapped.last_payment_requisition_amount ?? null,
        last_payment_amount: item.mapped.last_payment_amount ?? null,
        last_payment_date: item.mapped.last_payment_date || null,
        last_date: item.mapped.last_date || null,
        extra: item.mapped.extra || {},
      })))]
    );
    const outstandingByRow = new Map(outstandingRows.rows.map((row) => [row.import_row_id, row]));
    const ageingPayload = [];
    for (const item of details) {
      const outstanding = outstandingByRow.get(item.importRowId);
      item.outstandingId = outstanding?.id;
      item.account = accountByName.get(item.mapped.account_name);
      for (const bucket of ageingEntries(item.mapped, columns)) {
        ageingPayload.push({ outstanding_id: outstanding?.id, ...bucket });
      }
    }
    if (ageingPayload.length) {
      await transactionalProgress(batchId, 74, 'Saving ageing buckets');
      await client.query(
        `INSERT INTO intel_ageing (outstanding_id, ageing_bucket, bucket_from, bucket_to, bucket_label, debit_amount, credit_amount)
         SELECT x.outstanding_id, x.ageing_bucket, x.bucket_from, x.bucket_to, x.bucket_label, x.debit_amount, x.credit_amount
         FROM jsonb_to_recordset($1::jsonb) AS x(
           outstanding_id uuid, ageing_bucket text, bucket_from date, bucket_to date, bucket_label text, debit_amount numeric, credit_amount numeric
         )`,
        [JSON.stringify(ageingPayload)]
      );
    }
  }

  const {sourceDebit,sourceCredit,calcDebit,calcCredit,totalStatus} = totals;
  if (totalStatus==='SOURCE_TOTAL_MISMATCH') await client.query(`INSERT INTO intel_exceptions(company_id,import_batch_id,type,severity,title,detail) VALUES($1,$2,'SOURCE_TOTAL_MISMATCH','HIGH','Source total does not match detail totals',$3)`,[companyId,batchId,totals]);
  const reconInput = details.map(item => ({outstanding_id:item.outstandingId,account_id:item.account.id,company_id:companyId,
    account_name:item.mapped.account_name,pan_number:item.mapped.pan_number,gst_number:item.mapped.gst_number,
    source_amount:netOutstanding(item.mapped,rulebook.net_outstanding_formula?.expression)}));
  const context = {reportingDate:file.reporting_period_to,balanceDate:reference.balanceDate,batchId:reference.batchId,maps:accountMaps};
  const reconciled = reconcileAccounts(reconInput,reference.ledgers,rulebook,context);
  for (const row of [...reconciled.matched,...reconciled.missingInSource]) {
    const inserted = (await client.query(`INSERT INTO intel_reconciliations(outstanding_id,company_id,import_batch_id,tally_ledger_id,tally_ledger_name,tally_amount,source_amount,difference,difference_pct,match_method,match_score,matching_fields,status,reporting_date,tally_batch_id,tally_balance_date,comparison_available)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [row.outstandingId,companyId,batchId,row.tallyLedgerId,row.tallyLedgerName,row.tallyAmount,row.sourceAmount,row.difference,row.differencePct,row.matchMethod,row.matchScore,row.matchingFields,row.status,row.reportingDate,row.tallyBatchId,row.balanceDate,row.comparisonAvailable])).rows[0];
    if (row.status!=='MATCHED') await client.query(`INSERT INTO intel_exceptions(company_id,outstanding_id,reconciliation_id,import_batch_id,type,severity,title,detail)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[companyId,row.outstandingId,inserted.id,batchId,row.status,
      row.difference!=null && decimal.abs(row.difference)>=decimal.cents(rulebook.critical_difference?.amount ?? 100000)?'HIGH':'MEDIUM',row.status.replaceAll('_',' '),inserted]);
  }
  await client.query(`UPDATE intel_import_batches SET status='COMPLETED',total_rows=$13,successful_rows=$2,warning_rows=$3,failed_rows=$4,group_rows=$5,detail_rows=$6,
    source_total_status=$7,source_total_debit=$8,source_total_credit=$9,calculated_total_debit=$10,calculated_total_credit=$11,
    progress_percent=100,progress_message='Completed',completed_at=now(),heartbeat_at=now() WHERE id=$1 AND lease_token=$12`,
    [batchId,successful,warning,failed,analysis.counts.groupRows,analysis.counts.dataRows,totalStatus,sourceDebit,sourceCredit,calcDebit,calcCredit,token,analysis.rows.length]);
  if (publishEligible) await client.query(`INSERT INTO intel_company_publications(company_id,import_batch_id,reporting_date) VALUES($1,$2,$3)
    ON CONFLICT(company_id) DO UPDATE SET import_batch_id=EXCLUDED.import_batch_id,reporting_date=EXCLUDED.reporting_date,published_at=now()`,[companyId,batchId,file.reporting_period_to]);
  await client.query(`UPDATE intel_import_files SET status='COMPLETED' WHERE id=$1`,[id]);
  await client.query(`INSERT INTO intel_audit(username,action,entity,entity_id,new_value) VALUES($1,'PROCESS','import_file',$2,$3)`,[username,id,{batchId,generation:batch.generation,totalStatus}]);
}

async function recoverAbandoned(id) {
  return db.transaction(async client=>{
    // A publishing worker holds this file lock. Polling must never reclaim it.
    const file=(await client.query('SELECT id FROM intel_import_files WHERE id=$1 AND status=\'PROCESSING\' FOR UPDATE SKIP LOCKED',[id])).rows[0];
    if (!file) return;
    const expired=await client.query(`UPDATE intel_import_batches SET status='FAILED',completed_at=now(),error_message='Interrupted import recovered',progress_message='Interrupted import recovered'
      WHERE import_file_id=$1 AND status='PROCESSING' AND COALESCE(heartbeat_at,started_at)<now()-interval '2 minutes' RETURNING id`,[id]);
    if (expired.rowCount) await client.query(`UPDATE intel_import_files SET status='FAILED' WHERE id=$1`,[id]);
  });
}

function defaultPercent(status) {
  if (status === 'COMPLETED') return 100;
  if (status === 'PROCESSING') return 5;
  if (status === 'VALIDATED') return 60;
  if (status === 'ANALYZED') return 30;
  if (status === 'FAILED') return 100;
  return 0;
}

async function getProgress(id) {
  await recoverAbandoned(id);
  return db.readSnapshot(()=>readProgress(id));
}

async function readProgress(id) {
  const file = await getFile(id);
  const batch = await latestBatch(id);
  const validation = file.analysis?.validation || null;
  const processing = file.status === 'PROCESSING';
  const activeBatch = processing && batch?.status !== 'PROCESSING' ? null : batch;
  const percent = processing && !activeBatch
    ? 5
    : Number.isFinite(Number(activeBatch?.progress_percent))
      ? Number(activeBatch.progress_percent)
      : defaultPercent(file.status);
  let reconciliation = [];
  if (activeBatch && file.status === 'COMPLETED') {
    const recon = await db.query(
      `SELECT status, count(*)::int AS count, COALESCE(sum(difference),0) AS difference
       FROM intel_reconciliations
       WHERE company_id=$2 AND import_batch_id=$1
       GROUP BY status`,
      [activeBatch.id, file.company_id],
    );
    reconciliation = recon.rows;
  }
  return {
    fileId: file.id,
    fileName: file.file_name,
    status: file.status,
    batchStatus: processing ? (activeBatch?.status || 'PROCESSING') : (batch?.status || null),
    percent,
    message: activeBatch?.progress_message
      || (processing ? 'Starting import…' : batch?.progress_message || ''),
    error: file.status === 'FAILED' ? (batch?.error_message || null) : null,
    running: batch?.status === 'PROCESSING' && Date.now()-new Date(batch.heartbeat_at || batch.started_at).getTime()<120000,
    validation,
    canProcess: Boolean(validation?.canProcess),
    batch: activeBatch || (processing ? null : batch),
    reconciliation,
    selectedCompany: file.analysis?.selectedCompany || { id: file.company_id, name: file.company_name },
  };
}

async function startProcess(id, options = {}) {
  const reserved = await claim(id,options);
  if (!reserved.existing) setImmediate(() => processFile(id,{...options,reserved}).catch(error => console.error('Excel import process failed:',error.code || error.message)));
  return getProgress(id);
}

async function latestBatch(fileId) {
  const result = await db.query(
    `SELECT b.* FROM intel_import_batches b JOIN intel_import_files f ON f.selected_batch_id=b.id WHERE f.id=$1`,
    [fileId]
  );
  return result.rows[0] || null;
}

async function getResults(id) {
  return db.readSnapshot(async()=>{
  const file = await getFile(id);
  const batch = await latestBatch(id);
  const recon = batch
    ? await db.query(
      `SELECT status, count(*)::int AS count, COALESCE(sum(difference),0) AS difference
       FROM intel_reconciliations
       WHERE company_id=$2 AND import_batch_id=$1
       GROUP BY status`,
      [batch.id, file.company_id]
    )
    : { rows: [] };
  return { file: summaryPayload(file), companyName: file.company_name, batch, reconciliation: recon.rows };
  });
}

async function listImports() {
  const result = await db.query(`
    SELECT f.id, f.file_name, f.status, f.uploaded_at, f.detected_company, c.name AS company_name, s.name AS source_name,
           b.total_rows, b.successful_rows, b.failed_rows, b.warning_rows, b.detail_rows, b.source_total_status,
           b.progress_percent, b.progress_message
    FROM intel_import_files f
    LEFT JOIN intel_companies c ON c.id=f.company_id
    LEFT JOIN intel_source_systems s ON s.id=f.source_system_id
    LEFT JOIN LATERAL (
      SELECT * FROM intel_import_batches b WHERE b.id=f.selected_batch_id
    ) b ON true
    ORDER BY f.uploaded_at DESC
  `);
  return result.rows;
}

async function rowErrors(id) {
  const batch = await latestBatch(id);
  if (!batch) return [];
  const result = await db.query(
    `SELECT source_row_number, row_type, validation_status, errors, mapped_data
     FROM intel_import_rows WHERE import_batch_id=$1 AND (validation_status IN ('ERROR','WARNING') OR errors <> '[]'::jsonb)
     ORDER BY source_row_number`,
    [batch.id]
  );
  return result.rows;
}

async function updateMapping(id, mappings, username) {
  await db.transaction(async client => {
    const owner=(await client.query('SELECT company_id FROM intel_import_files WHERE id=$1',[id])).rows[0];
    if (!owner) throw Object.assign(new Error('Import not found'),{status:404});
    await client.query('SELECT pg_advisory_xact_lock(61009,hashtext($1))',[owner.company_id]);
    const file = (await client.query('SELECT * FROM intel_import_files WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if (!file) throw Object.assign(new Error('Import not found'),{status:404});
    if (file.status==='PROCESSING') throw Object.assign(new Error('Mappings are frozen while this import is processing'),{status:409});
    await client.query('SELECT id FROM intel_companies WHERE id=$1 FOR UPDATE',[file.company_id]);
    for (const item of mappings) {
      await client.query(`UPDATE intel_column_maps SET active=false WHERE company_id=$1 AND source_system_id IS NOT DISTINCT FROM $2::uuid AND lower(source_header)=lower($3)`,[file.company_id,file.source_system_id,item.sourceHeader]);
      await client.query(`INSERT INTO intel_column_maps(source_system_id,company_id,source_header,target_field,version)
        SELECT $1,$2,$3,$4,COALESCE(max(version),0)+1 FROM intel_column_maps WHERE company_id=$2 AND source_header=$3`,[file.source_system_id,file.company_id,item.sourceHeader,item.targetField || null]);
    }
    await client.query(`UPDATE intel_import_files SET mapping_version=mapping_version+1,
      analysis=COALESCE(analysis,'{}'::jsonb)-'validation',
      status=CASE WHEN status IN ('VALIDATED','FAILED') THEN 'ANALYZED' ELSE status END
      WHERE company_id=$1 AND source_system_id IS NOT DISTINCT FROM $2::uuid AND status<>'PROCESSING'`,[file.company_id,file.source_system_id]);
    await client.query(`INSERT INTO intel_audit(username,action,entity,entity_id,new_value) VALUES($1,'MAPPING_CHANGE','import_file',$2,$3)`,[username,id,JSON.stringify(mappings)]);
  });
  return preview(id);
}

module.exports = {
  upload,
  preview,
  validateOnly,
  processFile,
  startProcess,
  getProgress,
  getFile,
  getResults,
  listImports,
  rowErrors,
  updateMapping,
  summaryPayload,
  ensureCompany,
  claim,
  publishGeneration,
};
