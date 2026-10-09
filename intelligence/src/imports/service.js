const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { analyzeWorkbook } = require('../excel/parser');
const { loadMaps, resolveMaps, saveDetectedMaps } = require('../mapping/engine');
const { transformRow, netOutstanding, ageingEntries, money } = require('../transform/normalize');
const tally = require('../tally/provider');
const { reconcileAccounts } = require('../reconciliation/engine');
const audit = require('../audit');

async function rulesFor() {
  const result = await db.query(`SELECT key, value FROM intel_rules WHERE company_id IS NULL`);
  return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
}

async function ensureCompany({ companyId }) {
  if (!companyId) {
    throw Object.assign(new Error('Select the company this Excel file belongs to'), { status: 400 });
  }
  const existing = await db.query('SELECT * FROM intel_companies WHERE id=$1 AND active=true', [companyId]);
  if (!existing.rowCount) {
    throw Object.assign(new Error('Unknown company'), { status: 400 });
  }
  return existing.rows[0];
}

async function excelSource() {
  const result = await db.query(`SELECT * FROM intel_source_systems WHERE type='EXCEL' ORDER BY name LIMIT 1`);
  return result.rows[0];
}

async function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function upload({ buffer, fileName, companyId, uploadedBy }) {
  const fileHash = await hashBuffer(buffer);
  const existing = await db.query(
    `SELECT id, file_name, uploaded_at, status FROM intel_import_files WHERE file_hash=$1 ORDER BY uploaded_at DESC LIMIT 1`,
    [fileHash]
  );
  const source = await excelSource();
  const analysis = await analyzeWorkbook(buffer);
  const maps = await loadMaps(db, { sourceSystemId: source?.id, companyId });
  analysis.columns = resolveMaps(maps, analysis.columns);
  const company = await ensureCompany({ companyId });
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

async function validateOnly(id) {
  const file = await getFile(id);
  const buffer = await fs.readFile(file.stored_path);
  const analysis = await analyzeWorkbook(buffer);
  const maps = await loadMaps(db, { sourceSystemId: file.source_system_id, companyId: file.company_id });
  const columns = resolveMaps(maps, analysis.columns);
  const gstRequired = ((await rulesFor()).gst_required || {}).required === true;
  let valid = 0;
  let warnings = 0;
  let errors = 0;
  const issues = [];
  for (const row of analysis.rows.filter((item) => item.rowType === 'DETAIL')) {
    const { mapped, errors: rowErrors } = transformRow(row.raw, columns);
    const extra = [];
    if (!mapped.account_name) extra.push({ code: 'REQUIRED_FIELD', field: 'account_name' });
    if (gstRequired && !mapped.gst_number) extra.push({ code: 'MISSING_GST', field: 'gst_number' });
    const all = [...rowErrors, ...extra];
    if (all.some((item) => item.code === 'INVALID_DECIMAL' || item.code === 'INVALID_DATE' || item.code === 'REQUIRED_FIELD')) {
      errors += 1;
    } else if (all.length || !mapped.pan_number || !mapped.gst_number) {
      warnings += 1;
      valid += 1;
    } else valid += 1;
    if (all.length) issues.push({ row: row.sourceRowNumber, account: mapped.account_name, errors: all });
  }
  return {
    total: analysis.counts.dataRows,
    valid,
    warnings,
    errors,
    unmappedColumns: columns.filter((col) => col.unmapped).map((col) => col.canonical),
    issues: issues.slice(0, 100),
  };
}

async function processFile(id, { username, reprocess = false } = {}) {
  const file = await getFile(id);
  const buffer = await fs.readFile(file.stored_path);
  const analysis = await analyzeWorkbook(buffer);
  const maps = await loadMaps(db, { sourceSystemId: file.source_system_id, companyId: file.company_id });
  const columns = resolveMaps(maps, analysis.columns);
  const rulebook = await rulesFor();
  const batch = await db.query(
    `INSERT INTO intel_import_batches (import_file_id, status, total_rows, started_at, progress_message)
     VALUES ($1,'PROCESSING',$2,now(),'Normalizing rows') RETURNING *`,
    [id, analysis.rows.length]
  );
  const batchId = batch.rows[0].id;
  try {
  await db.query(`UPDATE intel_import_files SET status='PROCESSING', mapping_version=mapping_version+CASE WHEN $2 THEN 1 ELSE 0 END WHERE id=$1`, [id, reprocess]);
  if (reprocess) {
    await db.query(
      `DELETE FROM intel_exceptions WHERE import_batch_id IN (SELECT id FROM intel_import_batches WHERE import_file_id=$1 AND id<>$2)`,
      [id, batchId]
    );
    await db.query(
      `DELETE FROM intel_outstanding WHERE import_batch_id IN (SELECT id FROM intel_import_batches WHERE import_file_id=$1 AND id<>$2)`,
      [id, batchId]
    );
  }

  let successful = 0;
  let warning = 0;
  let failed = 0;
  const staged = analysis.rows.map((row) => {
    const { mapped, errors } = row.rowType === 'DETAIL' ? transformRow(row.raw, columns) : { mapped: {}, errors: [] };
    let status = 'OK';
    if (row.rowType === 'DETAIL' && errors.length) {
      status = errors.some((item) => item.code.startsWith('INVALID') || item.code === 'REQUIRED_FIELD') ? 'ERROR' : 'WARNING';
    }
    if (row.rowType === 'DETAIL' && !mapped.account_name) status = 'ERROR';
    if (status === 'ERROR') failed += 1;
    else if (status === 'WARNING') {
      warning += 1;
      successful += 1;
    } else if (row.rowType === 'DETAIL') successful += 1;
    return { row, mapped, errors, status };
  });
  const insertedRows = await db.query(
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
    const accounts = await db.query(
      `INSERT INTO intel_accounts (company_id, account_name, account_type, level_1_category, level_2_category, category_path, gst_number, pan_number, msme_number, credit_days)
       SELECT $1, x.account_name, x.account_type, x.level_1_category, x.level_2_category, x.category_path, x.gst_number, x.pan_number, x.msme_number, x.credit_days
       FROM jsonb_to_recordset($2::jsonb) AS x(
         account_name text, account_type text, level_1_category text, level_2_category text, category_path text[],
         gst_number text, pan_number text, msme_number text, credit_days numeric
       )
       ON CONFLICT (company_id, account_name) DO UPDATE SET
         gst_number=COALESCE(EXCLUDED.gst_number, intel_accounts.gst_number),
         pan_number=COALESCE(EXCLUDED.pan_number, intel_accounts.pan_number),
         msme_number=COALESCE(EXCLUDED.msme_number, intel_accounts.msme_number),
         credit_days=COALESCE(EXCLUDED.credit_days, intel_accounts.credit_days),
         level_1_category=EXCLUDED.level_1_category,
         level_2_category=EXCLUDED.level_2_category,
         category_path=EXCLUDED.category_path
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
      }, {})))]
    );
    const accountByName = new Map(accounts.rows.map((row) => [row.account_name, row]));
    const outstandingRows = await db.query(
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
      await db.query(
        `INSERT INTO intel_ageing (outstanding_id, ageing_bucket, bucket_from, bucket_to, bucket_label, debit_amount, credit_amount)
         SELECT x.outstanding_id, x.ageing_bucket, x.bucket_from, x.bucket_to, x.bucket_label, x.debit_amount, x.credit_amount
         FROM jsonb_to_recordset($1::jsonb) AS x(
           outstanding_id uuid, ageing_bucket text, bucket_from date, bucket_to date, bucket_label text, debit_amount numeric, credit_amount numeric
         )`,
        [JSON.stringify(ageingPayload)]
      );
    }
  }

  const totalRow = analysis.rows.find((row) => row.rowType === 'TOTAL');
  const sourceDebit = totalRow ? Number(totalRow.raw[columns.find((col) => col.target === 'pending_bill_debit')?.canonical]) || 0 : null;
  const sourceCredit = totalRow ? Number(totalRow.raw[columns.find((col) => col.target === 'pending_bill_credit')?.canonical]) || 0 : null;
  const calcDebit = money(details.reduce((sum, item) => sum + (Number(item.mapped.pending_bill_debit) || 0), 0));
  const calcCredit = money(details.reduce((sum, item) => sum + (Number(item.mapped.pending_bill_credit) || 0), 0));
  const totalStatus = sourceDebit == null
    ? 'SOURCE_TOTAL_ABSENT'
    : Math.abs(sourceDebit - calcDebit) < 0.05 && Math.abs((sourceCredit || 0) - calcCredit) < 0.05
      ? 'SOURCE_TOTAL_VALIDATED'
      : 'SOURCE_TOTAL_MISMATCH';
  if (totalStatus === 'SOURCE_TOTAL_MISMATCH') {
    await db.query(
      `INSERT INTO intel_exceptions (company_id, import_batch_id, type, severity, title, detail)
       VALUES ($1,$2,'SOURCE_TOTAL_MISMATCH','HIGH','Source total does not match calculated detail totals',$3)`,
      [companyId, batchId, { sourceDebit, sourceCredit, calcDebit, calcCredit }]
    );
  }

  const company = (await db.query('SELECT * FROM intel_companies WHERE id=$1', [companyId])).rows[0];
  const ledgers = await tally.listLedgers(company?.tally_company_id);
  const formula = rulebook.net_outstanding_formula?.expression || 'pending_bill_debit - pending_bill_credit';
  const reconInput = details.map((item) => ({
    outstanding_id: item.outstandingId,
    company_id: companyId,
    account_name: item.mapped.account_name,
    pan_number: item.mapped.pan_number,
    gst_number: item.mapped.gst_number,
    source_amount: netOutstanding(item.mapped, formula),
  }));
  const recon = reconcileAccounts(reconInput, ledgers, rulebook);
  const nameByOutstanding = new Map(reconInput.map((item) => [item.outstanding_id, item.account_name]));
  if (recon.matched.length) {
    const inserted = await db.query(
      `INSERT INTO intel_reconciliations (
          outstanding_id, company_id, tally_ledger_id, tally_ledger_name, tally_amount, source_amount,
          difference, difference_pct, match_method, match_score, matching_fields, status
       )
       SELECT x.outstanding_id, $1, x.tally_ledger_id, x.tally_ledger_name, x.tally_amount, x.source_amount,
              x.difference, x.difference_pct, x.match_method, x.match_score, x.matching_fields, x.status
       FROM jsonb_to_recordset($2::jsonb) AS x(
         outstanding_id uuid, tally_ledger_id integer, tally_ledger_name text, tally_amount numeric, source_amount numeric,
         difference numeric, difference_pct numeric, match_method text, match_score numeric, matching_fields text[], status text
       )
       RETURNING *`,
      [companyId, JSON.stringify(recon.matched.map((row) => ({
        outstanding_id: row.outstandingId,
        tally_ledger_id: row.tallyLedgerId,
        tally_ledger_name: row.tallyLedgerName,
        tally_amount: row.tallyAmount,
        source_amount: row.sourceAmount,
        difference: row.difference,
        difference_pct: row.differencePct,
        match_method: row.matchMethod,
        match_score: row.matchScore,
        matching_fields: row.matchingFields,
        status: row.status,
      })))]
    );
    const exceptionRows = inserted.rows.filter((row) => row.status !== 'MATCHED').map((row) => {
      const severity = Math.abs(row.difference || 0) >= Number(rulebook.critical_difference?.amount || 100000) ? 'HIGH' : 'MEDIUM';
      return {
        company_id: companyId,
        outstanding_id: row.outstanding_id,
        reconciliation_id: row.id,
        import_batch_id: batchId,
        type: row.status,
        severity,
        title: `${row.status.replace(/_/g, ' ')} for ${nameByOutstanding.get(row.outstanding_id) || 'account'}`,
        detail: row,
      };
    });
    if (exceptionRows.length) {
      await db.query(
        `INSERT INTO intel_exceptions (company_id, outstanding_id, reconciliation_id, import_batch_id, type, severity, title, detail)
         SELECT x.company_id, x.outstanding_id, x.reconciliation_id, x.import_batch_id, x.type, x.severity, x.title, x.detail
         FROM jsonb_to_recordset($1::jsonb) AS x(
           company_id uuid, outstanding_id uuid, reconciliation_id uuid, import_batch_id uuid, type text, severity text, title text, detail jsonb
         )`,
        [JSON.stringify(exceptionRows)]
      );
    }
  }

  await db.query(
    `UPDATE intel_import_batches SET
        status='COMPLETED', successful_rows=$2, warning_rows=$3, failed_rows=$4, group_rows=$5, detail_rows=$6,
        source_total_status=$7, source_total_debit=$8, source_total_credit=$9,
        calculated_total_debit=$10, calculated_total_credit=$11, progress_percent=100,
        progress_message='Completed', completed_at=now()
     WHERE id=$1`,
    [
      batchId, successful, warning, failed, analysis.counts.groupRows, analysis.counts.dataRows,
      totalStatus, sourceDebit, sourceCredit, calcDebit, calcCredit,
    ]
  );
  await db.query(`UPDATE intel_import_files SET status='COMPLETED' WHERE id=$1`, [id]);
  await audit.record({ username, action: reprocess ? 'REPROCESS' : 'PROCESS', entity: 'import_file', entityId: id, newValue: { batchId, successful, failed, totalStatus } });
  return getResults(id);
  } catch (error) {
    await db.query(
      `UPDATE intel_import_batches SET status='FAILED', error_message=$2, completed_at=now() WHERE id=$1`,
      [batchId, error.message]
    );
    await db.query(`UPDATE intel_import_files SET status='FAILED' WHERE id=$1`, [id]);
    throw error;
  }
}

async function latestBatch(fileId) {
  const result = await db.query(
    `SELECT * FROM intel_import_batches WHERE import_file_id=$1 ORDER BY started_at DESC NULLS LAST, id DESC LIMIT 1`,
    [fileId]
  );
  return result.rows[0] || null;
}

async function getResults(id) {
  const file = await getFile(id);
  const batch = await latestBatch(id);
  const recon = batch
    ? await db.query(
      `SELECT status, count(*)::int AS count, COALESCE(sum(difference),0) AS difference
       FROM intel_reconciliations WHERE outstanding_id IN (SELECT id FROM intel_outstanding WHERE import_batch_id=$1)
       GROUP BY status`,
      [batch.id]
    )
    : { rows: [] };
  return { file: summaryPayload(file), companyName: file.company_name, batch, reconciliation: recon.rows };
}

async function listImports() {
  const result = await db.query(`
    SELECT f.id, f.file_name, f.status, f.uploaded_at, f.detected_company, c.name AS company_name, s.name AS source_name,
           b.total_rows, b.successful_rows, b.failed_rows, b.warning_rows, b.detail_rows, b.source_total_status
    FROM intel_import_files f
    LEFT JOIN intel_companies c ON c.id=f.company_id
    LEFT JOIN intel_source_systems s ON s.id=f.source_system_id
    LEFT JOIN LATERAL (
      SELECT * FROM intel_import_batches b WHERE b.import_file_id=f.id ORDER BY b.id DESC LIMIT 1
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
  const file = await getFile(id);
  for (const item of mappings) {
    await db.query(
      `INSERT INTO intel_column_maps (source_system_id, company_id, source_header, target_field)
       VALUES ($1,$2,$3,$4)`,
      [file.source_system_id, file.company_id, item.sourceHeader, item.targetField || null]
    );
  }
  const analysis = file.analysis || {};
  if (analysis.columns) {
    analysis.columns = analysis.columns.map((col) => {
      const next = mappings.find((item) => item.sourceHeader === col.canonical);
      return next ? { ...col, target: next.targetField, unmapped: !next.targetField } : col;
    });
    await db.query('UPDATE intel_import_files SET analysis=$2 WHERE id=$1', [id, analysis]);
  }
  await audit.record({ username, action: 'MAPPING_CHANGE', entity: 'import_file', entityId: id, newValue: mappings });
  return preview(id);
}

module.exports = {
  upload,
  preview,
  validateOnly,
  processFile,
  getFile,
  getResults,
  listImports,
  rowErrors,
  updateMapping,
  summaryPayload,
  ensureCompany,
};
