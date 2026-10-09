const db = require('../db');
const { money } = require('../transform/normalize');
const decimal = require('../transform/decimal');

function inr(value) {
  return decimal.amount(value);
}

async function summary({ companyId } = {}) {
  return db.readSnapshot(async()=>{
  const filter = companyId ? 'AND o.company_id=$1' : '';
  const params = companyId ? [companyId] : [];
  const outstanding = await db.query(
    `SELECT
        count(*)::int AS records,
        COALESCE(sum(bill_amount),0) AS bill,
        COALESCE(sum(paid_amount),0) AS paid,
        COALESCE(sum(pending_bill_debit),0) AS debit,
        COALESCE(sum(pending_bill_credit),0) AS credit
     FROM intel_current_outstanding o
     WHERE 1=1 ${filter}`,
    params
  );
  const recon = await db.query(
    `SELECT status, count(*)::int AS count, COALESCE(sum(abs(difference)),0) AS gap
     FROM intel_current_reconciliations r
     LEFT JOIN intel_current_outstanding o ON o.id=r.outstanding_id
     WHERE 1=1 ${filter.replaceAll('o.company_id', 'r.company_id')}
     GROUP BY status`,
    params
  );
  const exceptions = await db.query(
    `SELECT count(*) FILTER (WHERE status='OPEN')::int AS open,
            count(*) FILTER (WHERE severity='HIGH' AND status='OPEN')::int AS critical
     FROM intel_current_exceptions e
     WHERE 1=1 ${companyId ? 'AND e.company_id=$1' : ''}`,
    params
  );
  const ageing = await db.query(
    `SELECT a.ageing_bucket, a.bucket_label,
            COALESCE(sum(a.debit_amount),0) AS debit,
            COALESCE(sum(a.credit_amount),0) AS credit
     FROM intel_ageing a
     JOIN intel_current_outstanding o ON o.id=a.outstanding_id
     WHERE 1=1 ${filter}
     GROUP BY a.ageing_bucket, a.bucket_label
     ORDER BY min(a.ageing_bucket)`,
    params
  );
  const byCompany = await db.query(
    `SELECT c.id, c.name,
            COALESCE(sum(o.pending_bill_debit),0) AS debit,
            COALESCE(sum(o.pending_bill_credit),0) AS credit,
            COALESCE((SELECT sum(abs(r.difference)) FROM intel_current_reconciliations r WHERE r.company_id=c.id),0) AS gap
     FROM intel_companies c
     LEFT JOIN intel_current_outstanding o ON o.company_id=c.id
     WHERE c.active=true ${companyId ? 'AND c.id=$1' : ''}
     GROUP BY c.id, c.name
     ORDER BY abs(COALESCE(sum(o.pending_bill_debit-o.pending_bill_credit),0)) DESC`,
    params
  );
  const topAccounts = await db.query(
    `SELECT a.id, a.account_name, c.name AS company_name,
            o.pending_bill_debit, o.pending_bill_credit, o.bill_amount, o.paid_amount,
            r.status, r.difference, r.tally_amount, r.source_amount
     FROM intel_current_outstanding o
     JOIN intel_accounts a ON a.id=o.account_id
     JOIN intel_companies c ON c.id=o.company_id
     LEFT JOIN intel_current_reconciliations r ON r.outstanding_id=o.id
     WHERE 1=1 ${filter}
     ORDER BY abs(o.pending_bill_debit-o.pending_bill_credit) DESC, o.id
     LIMIT 10`,
    params
  );
  const row = outstanding.rows[0];
  const reconMap = Object.fromEntries(recon.rows.map((item) => [item.status, item]));
  const matched = reconMap.MATCHED?.count || 0;
  const unmatched = recon.rows.filter((item) => item.status !== 'MATCHED').reduce((sum, item) => sum + item.count, 0);
  const gap = decimal.sum(recon.rows.map(item => item.gap));
  return {
    cards: {
      totalOutstanding: decimal.subtract(row.debit,row.credit),
      totalPaid: inr(row.paid),
      totalPending: inr(row.debit),
      totalBill: inr(row.bill),
      totalFinancialGap: gap,
      matched: matched,
      unmatched,
      criticalExceptions: exceptions.rows[0].critical,
      openExceptions: exceptions.rows[0].open,
      records: row.records,
    },
    reconciliation: recon.rows,
    ageing: ageing.rows.map((item) => ({
      bucket: item.ageing_bucket,
      label: item.bucket_label,
      debit: inr(item.debit),
      credit: inr(item.credit),
      net: decimal.subtract(item.debit,item.credit),
    })),
    byCompany: byCompany.rows.map((item) => ({
      id: item.id,
      name: item.name,
      outstanding: decimal.subtract(item.debit,item.credit),
      debit: inr(item.debit),
      credit: inr(item.credit),
      gap: inr(item.gap),
    })),
    topAccounts: topAccounts.rows,
  };
  });
}

async function outstanding({ companyId, q, status, page = 1, pageSize = 50 } = {}) {
  return db.readSnapshot(async()=>{
  const where = ['1=1'];
  const params = [];
  if (companyId) {
    params.push(companyId);
    where.push(`o.company_id=$${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(a.account_name ILIKE $${params.length} OR a.pan_number ILIKE $${params.length} OR a.gst_number ILIKE $${params.length})`);
  }
  if (status && status !== 'all') {
    if (status === 'differences') where.push(`r.status <> 'MATCHED'`);
    else { params.push(status); where.push(`r.status=$${params.length}`); }
  }
  params.push(pageSize, (page - 1) * pageSize);
  const result = await db.query(
    `SELECT o.*, a.account_name, a.gst_number, a.pan_number, a.msme_number, a.credit_days,
            a.level_1_category, a.level_2_category, a.category_path, c.name AS company_name,
            r.status AS recon_status, r.difference, r.tally_amount, r.source_amount, r.match_method
     FROM intel_current_outstanding o
     JOIN intel_accounts a ON a.id=o.account_id
     JOIN intel_companies c ON c.id=o.company_id
     LEFT JOIN intel_current_reconciliations r ON r.outstanding_id=o.id
     WHERE ${where.join(' AND ')}
     ORDER BY abs(o.pending_bill_debit-o.pending_bill_credit) DESC, o.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = await db.query(
    `SELECT count(*)::int AS count FROM intel_current_outstanding o JOIN intel_accounts a ON a.id=o.account_id LEFT JOIN intel_current_reconciliations r ON r.outstanding_id=o.id WHERE ${where.join(' AND ')}`,
    params.slice(0, params.length - 2)
  );
  return { items: result.rows, total: total.rows[0].count, page: Number(page), pageSize: Number(pageSize) };
  });
}

async function ageing({ companyId } = {}) {
  const summary = await db.query(
    `SELECT a.ageing_bucket, a.bucket_label, a.bucket_from, a.bucket_to,
            COALESCE(sum(a.debit_amount),0) AS debit, COALESCE(sum(a.credit_amount),0) AS credit
     FROM intel_ageing a
     JOIN intel_current_outstanding o ON o.id=a.outstanding_id
     WHERE ($1::uuid IS NULL OR o.company_id=$1)
     GROUP BY 1,2,3,4
     ORDER BY 1`,
    [companyId || null]
  );
  const totalNet = decimal.sum(summary.rows.map(row => decimal.subtract(row.debit,row.credit)));
  return {
    buckets: summary.rows.map((row) => {
      const net = decimal.subtract(row.debit,row.credit);
      return { ...row, debit: inr(row.debit), credit: inr(row.credit), net, pct: decimal.cents(totalNet)!==0n ? money((Number(net) / Number(totalNet)) * 100) : 0 };
    }),
  };
}

async function gaps({ companyId, status, q, limit = 500 } = {}) {
  const result = await db.query(
    `SELECT r.*, a.account_name, c.name AS company_name
     FROM intel_current_reconciliations r
     LEFT JOIN intel_current_outstanding o ON o.id=r.outstanding_id
     LEFT JOIN intel_accounts a ON a.id=o.account_id
     JOIN intel_companies c ON c.id=r.company_id
     WHERE ($1::uuid IS NULL OR r.company_id=$1)
       AND ($2::text IS NULL OR ($2='differences' AND r.status<>'MATCHED') OR r.status=$2)
       AND ($3::text IS NULL OR a.account_name ILIKE $3 OR r.tally_ledger_name ILIKE $3 OR a.pan_number ILIKE $3 OR a.gst_number ILIKE $3)
     ORDER BY abs(r.difference) DESC NULLS LAST
     LIMIT $4`,
    [companyId || null, status && status!=='all' ? status : null, q ? `%${q}%` : null, limit]
  );
  return result.rows;
}

async function accountDetail(id) {
  return db.readSnapshot(async()=>{
  const account = await db.query(
    `SELECT a.*, c.name AS company_name FROM intel_accounts a JOIN intel_companies c ON c.id=a.company_id WHERE a.id=$1`,
    [id]
  );
  if (!account.rowCount) throw Object.assign(new Error('Account not found'), { status: 404 });
  const outstanding = await db.query(
    `SELECT o.*, ir.mapped_data AS source_account, b.generation, b.tally_batch_id, b.tally_balance_date, (p.import_batch_id=o.import_batch_id) AS is_current, r.comparison_available,
       CASE WHEN p.import_batch_id=o.import_batch_id AND NOT r.comparison_available THEN 'COMPARISON_UNAVAILABLE' ELSE r.status END AS status,
       r.tally_amount, r.source_amount,
       CASE WHEN p.import_batch_id=o.import_batch_id AND NOT r.comparison_available THEN NULL ELSE r.difference END AS difference,
       r.status AS historical_status,r.difference AS historical_difference,r.match_method, r.match_score, r.tally_ledger_name
     FROM intel_outstanding o
     JOIN intel_import_batches b ON b.id=o.import_batch_id
     LEFT JOIN intel_import_rows ir ON ir.id=o.import_row_id
     LEFT JOIN intel_company_publications p ON p.company_id=o.company_id
     LEFT JOIN intel_reconciliations r ON r.outstanding_id=o.id
     WHERE o.account_id=$1
     ORDER BY o.reporting_date DESC NULLS LAST,b.generation DESC`,
    [id]
  );
  const ageingRows = outstanding.rowCount
    ? await db.query(`SELECT * FROM intel_ageing WHERE outstanding_id=$1 ORDER BY ageing_bucket`, [outstanding.rows[0].id])
    : { rows: [] };
  const exceptions = await db.query(
    `SELECT * FROM intel_exceptions WHERE outstanding_id = ANY($1::uuid[]) ORDER BY created_at DESC`,
    [outstanding.rows.map((row) => row.id)]
  );
  const audit = await db.query(
    `SELECT * FROM intel_audit WHERE entity IN ('account','exception','import_file') AND entity_id=ANY($1::text[]) ORDER BY id DESC LIMIT 50`,
    [[id, ...exceptions.rows.map((row) => String(row.id))]]
  );
  return { account: account.rows[0], outstanding: outstanding.rows, ageing: ageingRows.rows, exceptions: exceptions.rows, audit: audit.rows };
  });
}

async function dataQuality({ companyId } = {}) {
  return db.readSnapshot(async()=>{
  const result = await db.query(
    `SELECT
        count(*)::int AS accounts,
        count(*) FILTER (WHERE gst_number IS NULL OR gst_number='')::int AS missing_gst,
        count(*) FILTER (WHERE pan_number IS NULL OR pan_number='')::int AS missing_pan,
        count(*) FILTER (WHERE msme_number IS NULL OR msme_number='')::int AS missing_msme
     FROM intel_accounts a JOIN intel_current_outstanding o ON o.account_id=a.id
     WHERE ($1::uuid IS NULL OR a.company_id=$1)`,
    [companyId || null]
  );
  const payments = await db.query(
    `SELECT count(*) FILTER (WHERE last_payment_date IS NULL)::int AS missing_payment_date,
            count(*)::int AS outstanding_rows
     FROM intel_current_outstanding o WHERE ($1::uuid IS NULL OR o.company_id=$1)`,
    [companyId || null]
  );
  const exceptions = await db.query(
    `SELECT type, count(*)::int AS count FROM intel_current_exceptions
     WHERE ($1::uuid IS NULL OR company_id=$1) GROUP BY type`,
    [companyId || null]
  );
  return { ...result.rows[0], ...payments.rows[0], issues: exceptions.rows };
  });
}

async function listExceptions({ companyId, status = 'OPEN', owner, q, limit = 500, offset=0 } = {}) {
  const result = await db.query(
    `SELECT e.*, a.account_name, c.name AS company_name
     FROM intel_current_exceptions e
     LEFT JOIN intel_current_outstanding o ON o.id=e.outstanding_id
     LEFT JOIN intel_accounts a ON a.id=o.account_id
     LEFT JOIN intel_companies c ON c.id=e.company_id
     WHERE ($1::uuid IS NULL OR e.company_id=$1)
       AND ($2::text IS NULL OR e.status=$2)
       AND ($3::text IS NULL OR e.owner=$3)
       AND ($4::text IS NULL OR a.account_name ILIKE $4 OR e.title ILIKE $4)
     ORDER BY CASE e.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, e.created_at DESC,e.id DESC LIMIT $5 OFFSET $6`,
    [companyId || null, status && status!=='all' ? status : null, owner || null, q ? `%${q}%` : null, limit,offset]
  );
  return result.rows;
}

async function listExceptionsPage({page=1,pageSize=50,...scope}={}) {
  return db.readSnapshot(async()=>{
    const items=await listExceptions({...scope,limit:pageSize,offset:(page-1)*pageSize});
    const total=(await db.query(`SELECT count(*)::int AS count FROM intel_current_exceptions e
      LEFT JOIN intel_current_outstanding o ON o.id=e.outstanding_id LEFT JOIN intel_accounts a ON a.id=o.account_id
      WHERE ($1::uuid IS NULL OR e.company_id=$1) AND ($2::text IS NULL OR e.status=$2)
        AND ($3::text IS NULL OR e.owner=$3) AND ($4::text IS NULL OR a.account_name ILIKE $4 OR e.title ILIKE $4)`,
      [scope.companyId || null,scope.status==='all' || scope.status===null ? null : scope.status || 'OPEN',scope.owner || null,scope.q?`%${scope.q}%`:null])).rows[0].count;
    return {items,total,page:Number(page),pageSize:Number(pageSize)};
  });
}

async function updateException(id, patch, username) {
  return db.transaction(async client => {
    const current = await client.query('SELECT * FROM intel_exceptions WHERE id=$1 FOR UPDATE',[id]);
    if (!current.rowCount) throw Object.assign(new Error('Exception not found'),{status:404});
    const updated = (await client.query(`UPDATE intel_exceptions SET status=$2,owner=$3,severity=$4,updated_at=now() WHERE id=$1 RETURNING *`,
      [id,patch.status || current.rows[0].status,patch.owner===undefined?current.rows[0].owner:patch.owner,patch.severity || current.rows[0].severity])).rows[0];
    if (patch.comment) await client.query('INSERT INTO intel_exception_comments(exception_id,author,body) VALUES($1,$2,$3)',[id,username,patch.comment]);
    await client.query(`INSERT INTO intel_audit(username,action,entity,entity_id,old_value,new_value) VALUES($1,'EXCEPTION_UPDATE','exception',$2,$3,$4)`,[username,id,current.rows[0],updated]);
    return updated;
  });
}

async function companies() {
  const tallyCompanies = await require('../tally/provider').listCompanies();
  for (const company of tallyCompanies) {
    await db.query(
      `INSERT INTO intel_companies (name, tally_company_id, active)
       SELECT $1, $2, true
       WHERE NOT EXISTS (SELECT 1 FROM intel_companies WHERE tally_company_id=$2)`,
      [company.name, company.id]
    );
  }
  const local = await db.query('SELECT * FROM intel_companies WHERE active=true ORDER BY name');
  return local.rows;
}

async function sources() {
  const result = await db.query('SELECT * FROM intel_source_systems WHERE active=true ORDER BY name');
  return result.rows;
}

module.exports = {
  summary,
  outstanding,
  ageing,
  gaps,
  accountDetail,
  dataQuality,
  listExceptions,
  listExceptionsPage,
  updateException,
  companies,
  sources,
};
