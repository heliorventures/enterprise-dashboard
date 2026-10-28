const db = require('../db');
const audit = require('../audit');
const decimal = require('../transform/decimal');
const { basis, currentBasis, rowsWithCurrency } = require('../currency');
const { currencyCode } = require('../../reportCurrency');
const config = require('../config');

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// Project rules choose the first matching keyword: lowest priority number, then
// the most specific (longest) keyword. The same expression is used for Excel
// parties and for Tally-only ledgers so both sides land in the same project.
const RULE_PROJECT = (nameExpr, companyExpr) => `(
  SELECT ru.project_id FROM intel_project_rules ru
  WHERE ru.company_id=${companyExpr} AND position(lower(btrim(ru.keyword)) in lower(${nameExpr}))>0
  ORDER BY ru.priority, length(ru.keyword) DESC, ru.id LIMIT 1)`;

async function companyRecord(database, companyId) {
  const company = (await database.query(
    `SELECT ic.id,ic.name,ic.tally_company_id,c."Currency" AS currency
     FROM intel_companies ic LEFT JOIN "Companies" c ON c."CompanyID"=ic.tally_company_id WHERE ic.id=$1`, [companyId])).rows[0];
  if (!company) throw fail('Upload and process an Excel file for this company first', 404);
  return company;
}

function cleanName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw fail('Project name is required (up to 120 characters)');
  return value.trim().replace(/\s+/g, ' ');
}

function cleanKeyword(value) {
  const keyword = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (keyword.length < 2 || keyword.length > 80) throw fail('A keyword needs 2 to 80 characters');
  return keyword;
}

function cleanMoney(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(String(value))) throw fail(`${label} must be a positive amount with up to 2 decimals`);
  return String(value);
}

async function checkTallyProject(database, company, tallyProjectId) {
  if (tallyProjectId == null) return null;
  const found = await database.query('SELECT "ProjectID" FROM "Projects" WHERE "ProjectID"=$1 AND "CompanyID"=$2',
    [tallyProjectId, company.tally_company_id]);
  if (!found.rowCount) throw fail('That Tally project does not belong to this company');
  return tallyProjectId;
}

function uniqueViolation(error, message) {
  if (error?.code === '23505') throw fail(message, 409);
  throw error;
}

/**
 * Re-evaluate rule based assignments for a company. A MANUAL decision is never
 * touched. RULE rows follow the current rules, so deleting a rule releases its
 * parties. Safe to call inside the import publication transaction.
 */
async function applyRules(database, companyId) {
  const result = await database.query(
    `WITH wanted AS (
       SELECT a.id, ${RULE_PROJECT('a.account_name', 'a.company_id')} AS project_id
       FROM intel_accounts a WHERE a.company_id=$1 AND a.project_source IS DISTINCT FROM 'MANUAL'
     )
     UPDATE intel_accounts a SET project_id=w.project_id, project_source=CASE WHEN w.project_id IS NULL THEN NULL ELSE 'RULE' END
     FROM wanted w
     WHERE a.id=w.id AND (a.project_id IS DISTINCT FROM w.project_id)
     RETURNING a.id, w.project_id`,
    [companyId]
  );
  return { changed: result.rowCount, assigned: result.rows.filter(row => row.project_id).length };
}

/**
 * Store what every project looked like for one import. Amounts are Excel facts and
 * are always kept; the gap is stored only when the comparison with Tally was possible
 * (same date and one confirmed currency), exactly as the live views decide it.
 * Safe to repeat: the batch's rows are replaced.
 */
async function snapshotBatch(database, companyId, batchId) {
  const batch = (await database.query(
    'SELECT id,reporting_date,frozen_inputs FROM intel_import_batches WHERE id=$1 AND company_id=$2', [batchId, companyId])).rows[0];
  if (!batch) return 0;
  const { currency } = basis(batch.frozen_inputs);
  const comparable = Boolean(currency);
  const erp = (await database.query(
    `SELECT a.project_id,max(p.name) AS project_name,count(*)::int AS parties,
            COALESCE(sum(o.bill_amount),0) AS billed,COALESCE(sum(o.paid_amount),0) AS paid,
            COALESCE(sum(o.pending_bill_debit),0) AS debit,COALESCE(sum(o.pending_bill_credit),0) AS credit,
            count(*) FILTER (WHERE $2::boolean AND r.comparison_available AND r.status='MATCHED')::int AS matched,
            count(*) FILTER (WHERE $2::boolean AND r.comparison_available AND r.status NOT IN ('MATCHED','COMPARISON_UNAVAILABLE'))::int AS differences,
            count(*) FILTER (WHERE r.id IS NOT NULL AND NOT ($2::boolean AND r.comparison_available))::int AS unavailable,
            COALESCE(sum(abs(r.difference)) FILTER (WHERE $2::boolean AND r.comparison_available),0) AS gap
     FROM intel_outstanding o
     JOIN intel_accounts a ON a.id=o.account_id
     LEFT JOIN intel_projects p ON p.id=a.project_id
     LEFT JOIN intel_reconciliations r ON r.outstanding_id=o.id AND r.import_batch_id=o.import_batch_id
     WHERE o.import_batch_id=$1 GROUP BY a.project_id`, [batchId, comparable])).rows;
  const only = (await database.query(
    `WITH t AS (
       SELECT r.*,${RULE_PROJECT('r.tally_ledger_name', 'r.company_id')} AS project_id
       FROM intel_reconciliations r
       WHERE r.import_batch_id=$1 AND r.outstanding_id IS NULL AND r.status='MISSING_IN_SOURCE')
     SELECT t.project_id,max(p.name) AS project_name,count(*)::int AS ledgers,
            COALESCE(sum(abs(t.difference)) FILTER (WHERE $2::boolean AND t.comparison_available),0) AS gap
     FROM t LEFT JOIN intel_projects p ON p.id=t.project_id GROUP BY t.project_id`, [batchId, comparable])).rows;
  const merged = new Map();
  const slot = row => {
    const key = row.project_id || 'none';
    if (!merged.has(key)) merged.set(key, { project_id: row.project_id || null, project_name: row.project_name || null, parties: 0, billed: 0, paid: 0, pending_debit: 0, pending_credit: 0, matched: 0, differences: 0, unavailable: 0, tally_only: 0, gap: 0 });
    return merged.get(key);
  };
  for (const row of erp) Object.assign(slot(row), { parties: row.parties, billed: row.billed, paid: row.paid, pending_debit: row.debit, pending_credit: row.credit, matched: row.matched, differences: row.differences, unavailable: row.unavailable, gap: row.gap });
  for (const row of only) { const target = slot(row); target.tally_only = row.ledgers; target.gap = decimal.sum([target.gap, row.gap]); }
  await database.query('DELETE FROM intel_project_snapshots WHERE import_batch_id=$1', [batchId]);
  if (!merged.size) return 0;
  const payload = [...merged.values()].map(row => ({ ...row, gap: comparable ? row.gap : null }));
  await database.query(
    `INSERT INTO intel_project_snapshots(company_id,import_batch_id,project_id,project_name,reporting_date,currency,parties,billed,paid,
        pending_debit,pending_credit,matched,differences,unavailable,tally_only,gap)
     SELECT $1,$2,x.project_id,x.project_name,$3,$4,x.parties,x.billed,x.paid,x.pending_debit,x.pending_credit,x.matched,x.differences,x.unavailable,x.tally_only,x.gap
     FROM jsonb_to_recordset($5::jsonb) AS x(project_id uuid,project_name text,parties int,billed numeric,paid numeric,pending_debit numeric,
       pending_credit numeric,matched int,differences int,unavailable int,tally_only int,gap numeric)`,
    [companyId, batchId, batch.reporting_date, currency, JSON.stringify(payload)]);
  return payload.length;
}

/** Keep the newest published snapshot equal to the live project view after any edit. */
async function refreshCurrentSnapshot(database, companyId) {
  const published = (await database.query('SELECT import_batch_id FROM intel_company_publications WHERE company_id=$1', [companyId])).rows[0];
  return published ? snapshotBatch(database, companyId, published.import_batch_id) : 0;
}

async function createProject(companyId, body, username) {
  return db.transaction(async client => {
    const company = await companyRecord(client, companyId);
    const name = cleanName(body.name);
    const tallyProjectId = await checkTallyProject(client, company, body.tallyProjectId ?? null);
    const budget = cleanMoney(body.budgetExpense, 'Budget');
    const target = cleanMoney(body.targetRevenue, 'Target revenue');
    let project;
    try {
      project = (await client.query(
        `INSERT INTO intel_projects(company_id,name,tally_project_id,budget_expense,target_revenue) VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [companyId, name, tallyProjectId, budget ?? null, target ?? null])).rows[0];
    } catch (error) { uniqueViolation(error, 'A project with this name already exists'); }
    const keywords = Array.isArray(body.keywords) ? body.keywords.map(cleanKeyword) : [];
    for (const keyword of keywords) {
      try { await client.query('INSERT INTO intel_project_rules(company_id,project_id,keyword) VALUES($1,$2,$3)', [companyId, project.id, keyword]); }
      catch (error) { uniqueViolation(error, `The keyword “${keyword}” is already used by another project`); }
    }
    const applied = await applyRules(client, companyId);
    await refreshCurrentSnapshot(client, companyId);
    await client.query(`INSERT INTO intel_audit(username,action,entity,entity_id,new_value) VALUES($1,'CREATE','project',$2,$3)`,
      [username, project.id, { name, keywords, assigned: applied.assigned }]);
    return { ...project, assigned: applied.assigned };
  });
}

async function updateProject(id, body, username) {
  return db.transaction(async client => {
    const project = (await client.query('SELECT * FROM intel_projects WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!project) throw fail('Project not found', 404);
    const company = await companyRecord(client, project.company_id);
    const next = {
      name: body.name === undefined ? project.name : cleanName(body.name),
      tally_project_id: body.tallyProjectId === undefined ? project.tally_project_id : await checkTallyProject(client, company, body.tallyProjectId),
      budget_expense: body.budgetExpense === undefined ? project.budget_expense : cleanMoney(body.budgetExpense, 'Budget'),
      target_revenue: body.targetRevenue === undefined ? project.target_revenue : cleanMoney(body.targetRevenue, 'Target revenue'),
    };
    let updated;
    try {
      updated = (await client.query(
        `UPDATE intel_projects SET name=$2,tally_project_id=$3,budget_expense=$4,target_revenue=$5,updated_at=now() WHERE id=$1 RETURNING *`,
        [id, next.name, next.tally_project_id, next.budget_expense, next.target_revenue])).rows[0];
    } catch (error) { uniqueViolation(error, 'A project with this name already exists'); }
    await refreshCurrentSnapshot(client, project.company_id);
    await client.query(`INSERT INTO intel_audit(username,action,entity,entity_id,old_value,new_value) VALUES($1,'UPDATE','project',$2,$3,$4)`,
      [username, id, project, updated]);
    return updated;
  });
}

async function deleteProject(id, username) {
  return db.transaction(async client => {
    const project = (await client.query('SELECT * FROM intel_projects WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!project) throw fail('Project not found', 404);
    // Release every party first so project_id and project_source stay consistent.
    const released = await client.query(`UPDATE intel_accounts SET project_id=NULL,project_source=NULL WHERE project_id=$1`, [id]);
    await client.query('DELETE FROM intel_projects WHERE id=$1', [id]);
    const applied = await applyRules(client, project.company_id);
    await refreshCurrentSnapshot(client, project.company_id);
    await client.query(`INSERT INTO intel_audit(username,action,entity,entity_id,old_value,new_value) VALUES($1,'DELETE','project',$2,$3,$4)`,
      [username, id, project, { released: released.rowCount, reassigned: applied.assigned }]);
    return { deleted: true, released: released.rowCount };
  });
}

async function addRule(projectId, keywordInput, username) {
  return db.transaction(async client => {
    const project = (await client.query('SELECT * FROM intel_projects WHERE id=$1 FOR UPDATE', [projectId])).rows[0];
    if (!project) throw fail('Project not found', 404);
    const keyword = cleanKeyword(keywordInput);
    let rule;
    try {
      rule = (await client.query('INSERT INTO intel_project_rules(company_id,project_id,keyword) VALUES($1,$2,$3) RETURNING *',
        [project.company_id, projectId, keyword])).rows[0];
    } catch (error) { uniqueViolation(error, 'That keyword is already used by a project'); }
    const applied = await applyRules(client, project.company_id);
    await refreshCurrentSnapshot(client, project.company_id);
    await client.query(`INSERT INTO intel_audit(username,action,entity,entity_id,new_value) VALUES($1,'ADD_RULE','project',$2,$3)`,
      [username, projectId, { keyword, assigned: applied.assigned }]);
    return { ...rule, assigned: applied.assigned };
  });
}

async function deleteRule(ruleId, username) {
  return db.transaction(async client => {
    const rule = (await client.query('DELETE FROM intel_project_rules WHERE id=$1 RETURNING *', [ruleId])).rows[0];
    if (!rule) throw fail('Rule not found', 404);
    const applied = await applyRules(client, rule.company_id);
    await refreshCurrentSnapshot(client, rule.company_id);
    await client.query(`INSERT INTO intel_audit(username,action,entity,entity_id,old_value) VALUES($1,'DELETE_RULE','project',$2,$3)`,
      [username, rule.project_id, { keyword: rule.keyword, changed: applied.changed }]);
    return { deleted: true, changed: applied.changed };
  });
}

async function reapply(companyId, username) {
  return db.transaction(async client => {
    await companyRecord(client, companyId);
    const applied = await applyRules(client, companyId);
    await refreshCurrentSnapshot(client, companyId);
    await client.query(`INSERT INTO intel_audit(username,action,entity,entity_id,new_value) VALUES($1,'APPLY_RULES','project',$2,$3)`,
      [username, companyId, applied]);
    return applied;
  });
}

/** A user decision wins over rules. A null project returns the party to rules. */
async function assignAccount(accountId, projectId, username) {
  return db.transaction(async client => {
    const account = (await client.query('SELECT id,company_id,account_name,project_id,project_source FROM intel_accounts WHERE id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!account) throw fail('Account not found', 404);
    if (projectId) {
      const project = (await client.query('SELECT id FROM intel_projects WHERE id=$1 AND company_id=$2', [projectId, account.company_id])).rows[0];
      if (!project) throw fail('Choose a project of the same company', 400);
      await client.query(`UPDATE intel_accounts SET project_id=$2,project_source='MANUAL' WHERE id=$1`, [accountId, projectId]);
    } else {
      await client.query(`UPDATE intel_accounts SET project_id=NULL,project_source=NULL WHERE id=$1`, [accountId]);
      await applyRules(client, account.company_id);
    }
    await refreshCurrentSnapshot(client, account.company_id);
    const result = (await client.query('SELECT project_id,project_source FROM intel_accounts WHERE id=$1', [accountId])).rows[0];
    await client.query(`INSERT INTO intel_audit(username,action,entity,entity_id,old_value,new_value) VALUES($1,'ASSIGN','account',$2,$3,$4)`,
      [username, accountId, { project_id: account.project_id, project_source: account.project_source }, result]);
    return result;
  });
}

/**
 * Why amounts are not compared, in words a user can act on. Amounts are only compared
 * when the Excel and Tally have the same confirmed currency; no conversion is applied.
 */
function unavailableReason(inputs, companyCurrency) {
  // An absent publication has no comparison basis; it says nothing about
  // whether the company's Tally snapshot or currency is available.
  if (!inputs) {
    const currency = currencyCode(companyCurrency) || currencyCode(config.defaultCurrency);
    return `No Excel comparison has been published for this company yet.${currency ? ` Company currency: ${currency}.` : ''} Upload and process an Excel file to compare amounts with Tally.`;
  }
  const parts = [];
  if (!inputs?.source_currency) parts.push('the Excel file does not state a currency');
  if (!inputs?.tally_currency) parts.push('Tally has no confirmed single currency for this company yet (its latest balance snapshot is missing)');
  const reason = parts.length ? parts.join(' and ') : 'the Excel and Tally currencies differ';
  return `Amounts and gaps are hidden because ${reason}. No conversion is applied. Which parties exist in Tally can still be checked by name: see “Missing in Tally”.`;
}

function percent(numerator, denominator) {
  const bottom = decimal.cents(denominator);
  if (bottom <= 0n) return null;
  return Math.round(Number(decimal.cents(numerator)) / Number(bottom) * 1000) / 10;
}

function budgetStatus(billed, budget) {
  const used = budget == null ? null : percent(billed, budget);
  if (used == null) return { used: null, status: 'NO_BUDGET' };
  return { used, status: used > 100 ? 'OVER_BUDGET' : used >= 80 ? 'AT_RISK' : 'ON_TRACK' };
}

/**
 * What the comparison for this company assumed, in plain words, so nobody mistakes an
 * assumption for a fact. Empty when the Excel and Tally both stated currency and date.
 */
async function basisNotes(database, companyId) {
  const row = (await database.query(
    `SELECT b.frozen_inputs->'analysis'->>'currency' AS currency,
            b.frozen_inputs->'analysis'->>'currencyAssumed' AS currency_assumed,
            b.frozen_inputs->'reference'->>'balanceDateAssumed' AS date_assumed,
            f.reporting_period_to::text AS reporting_date
     FROM intel_company_publications p
     JOIN intel_import_batches b ON b.id=p.import_batch_id
     JOIN intel_import_files f ON f.id=b.import_file_id
     WHERE p.company_id=$1`, [companyId])).rows[0];
  if (!row) return [];
  const notes = [];
  if (row.currency_assumed === 'true' && row.currency) {
    notes.push(`The Excel states no currency, so ${row.currency} (the company currency) is used. No conversion is applied.`);
  }
  if (row.date_assumed === 'true') {
    notes.push(`Tally balances here carry no date, so they are treated as the same date as the Excel (${row.reporting_date}). A difference can be caused by timing as well as by a real mismatch.`);
  }
  return notes;
}

async function latestImport(database, companyId) {
  const result = await database.query(
    `SELECT f.id,f.file_name,f.status,f.reporting_period_to AS reporting_date,p.published_at,b.detail_rows,b.generation
     FROM intel_company_publications p
     JOIN intel_import_batches b ON b.id=p.import_batch_id
     JOIN intel_import_files f ON f.id=b.import_file_id
     WHERE p.company_id=$1`, [companyId]);
  return result.rows[0] || null;
}

async function summary(companyId) {
  return db.readSnapshot(async () => {
    const company = await companyRecord(db, companyId);
    const basis = await currentBasis(db, companyId);
    const currency = basis.companies.get(companyId)?.currency || null;
    const projects = (await db.query(
      `SELECT p.*, tp."ProjectName" AS tally_project_name,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'keyword',r.keyword) ORDER BY r.keyword) FROM intel_project_rules r WHERE r.project_id=p.id),'[]'::jsonb) AS rules
       FROM intel_projects p LEFT JOIN "Projects" tp ON tp."ProjectID"=p.tally_project_id
       WHERE p.company_id=$1 AND p.active ORDER BY lower(p.name)`, [companyId])).rows;
    const erp = (await db.query(
      `SELECT a.project_id,count(*)::int AS parties,
              COALESCE(sum(o.bill_amount),0) AS billed,COALESCE(sum(o.paid_amount),0) AS paid,
              COALESCE(sum(o.pending_bill_debit),0) AS debit,COALESCE(sum(o.pending_bill_credit),0) AS credit,
              count(*) FILTER (WHERE r.status='MATCHED')::int AS matched,
              count(*) FILTER (WHERE r.status IS NOT NULL AND r.status NOT IN ('MATCHED','COMPARISON_UNAVAILABLE'))::int AS differences,
              count(*) FILTER (WHERE r.status='COMPARISON_UNAVAILABLE')::int AS unavailable,
              COALESCE(sum(abs(r.difference)),0) AS gap,
              COALESCE(sum(r.source_amount),0) AS excel_amount,COALESCE(sum(r.tally_amount),0) AS tally_amount
       FROM intel_current_outstanding o
       JOIN intel_accounts a ON a.id=o.account_id
       LEFT JOIN intel_current_reconciliations r ON r.outstanding_id=o.id
       WHERE o.company_id=$1 GROUP BY a.project_id`, [companyId])).rows;
    const tallyOnly = (await db.query(
      `SELECT ${RULE_PROJECT('r.tally_ledger_name', 'r.company_id')} AS project_id,count(*)::int AS ledgers,COALESCE(sum(abs(r.difference)),0) AS gap,
              COALESCE(sum(r.tally_amount),0) AS tally_amount
       FROM intel_current_reconciliations r
       WHERE r.company_id=$1 AND r.outstanding_id IS NULL AND r.status='MISSING_IN_SOURCE' GROUP BY 1`, [companyId])).rows;
    const tallyIds = projects.map(project => project.tally_project_id).filter(Boolean);
    const vouchers = tallyIds.length ? (await db.query(
      `SELECT "ProjectID" AS id,count(*)::int AS vouchers,count(*) FILTER (WHERE "Amount"<>0)::int AS with_amount,
              max("VoucherDate")::text AS last_date
       FROM "Vouchers" WHERE "ProjectID"=ANY($1::int[]) GROUP BY 1`, [tallyIds])).rows : [];
    const allVouchers = (await db.query(
      `SELECT count(*)::int AS vouchers,count(*) FILTER (WHERE "Amount"<>0)::int AS with_amount FROM "Vouchers" WHERE "CompanyID"=$1`,
      [company.tally_company_id])).rows[0];

    const erpBy = new Map(erp.map(row => [row.project_id || null, row]));
    const tallyOnlyBy = new Map(tallyOnly.map(row => [row.project_id || null, row]));
    const voucherBy = new Map(vouchers.map(row => [row.id, row]));
    const money = value => currency ? decimal.amount(value) : null;

    const shape = (project, key) => {
      const row = erpBy.get(key) || { parties: 0, billed: 0, paid: 0, debit: 0, credit: 0, matched: 0, differences: 0, unavailable: 0, gap: 0, excel_amount: 0, tally_amount: 0 };
      const only = tallyOnlyBy.get(key) || { ledgers: 0, gap: 0, tally_amount: 0 };
      const tallyTotal = decimal.sum([row.tally_amount, only.tally_amount]);
      const budget = project?.budget_expense ?? null;
      const target = project?.target_revenue ?? null;
      const progress = currency ? budgetStatus(row.billed, budget) : { used: null, status: 'NO_BUDGET' };
      const tallyVouchers = project?.tally_project_id ? voucherBy.get(project.tally_project_id) : null;
      return {
        id: project?.id || null,
        name: project?.name || 'Not assigned to a project',
        tallyProjectId: project?.tally_project_id ?? null,
        tallyProjectName: project?.tally_project_name ?? null,
        budgetExpense: project ? budget : null,
        targetRevenue: project ? target : null,
        rules: project?.rules || [],
        parties: row.parties,
        billed: money(row.billed),
        paid: money(row.paid),
        pending: currency ? decimal.subtract(row.debit, row.credit) : null,
        paidPct: currency ? percent(row.paid, row.billed) : null,
        matched: row.matched,
        differences: row.differences,
        unavailable: row.unavailable,
        tallyOnlyLedgers: only.ledgers,
        gap: currency ? decimal.sum([row.gap, only.gap]) : null,
        // What the Excel file says, what Tally says, and Excel minus Tally.
        excelAmount: money(row.excel_amount),
        tallyAmount: money(tallyTotal),
        netDifference: currency ? decimal.subtract(row.excel_amount, tallyTotal) : null,
        budgetUsedPct: progress.used,
        budgetStatus: progress.status,
        tallyVouchers: tallyVouchers?.vouchers ?? null,
        tallyVouchersWithAmount: tallyVouchers?.with_amount ?? null,
        tallyLastVoucherDate: tallyVouchers?.last_date ?? null,
        // Never call a project in sync while any of its comparisons is unavailable.
        health: row.parties + only.ledgers === 0 ? 'EMPTY'
          : row.differences + only.ledgers > 0 ? 'HAS_GAPS'
            : row.unavailable > 0 ? 'COMPARISON_UNAVAILABLE' : 'IN_SYNC',
      };
    };

    const shaped = projects.map(project => shape(project, project.id));
    const unassigned = shape(null, null);
    const totalParties = shaped.reduce((sum, item) => sum + item.parties, 0) + unassigned.parties;
    return {
      company: { id: company.id, name: company.name, tallyCompanyId: company.tally_company_id },
      currency,
      monetaryAvailable: Boolean(currency),
      currencyMessage: currency ? null : unavailableReason(basis.companies.get(companyId), company.currency),
      projects: shaped,
      unassigned,
      tallyProjects: (await db.query('SELECT "ProjectID" AS id,"ProjectName" AS name FROM "Projects" WHERE "CompanyID"=$1 ORDER BY "ProjectName"', [company.tally_company_id])).rows,
      coverage: { assigned: totalParties - unassigned.parties, total: totalParties },
      tally: {
        vouchers: allVouchers.vouchers,
        vouchersWithAmount: allVouchers.with_amount,
        amountsAvailable: allVouchers.with_amount > 0,
      },
      latestImport: await latestImport(db, companyId),
      notes: await basisNotes(db, companyId),
    };
  });
}

async function detail(companyId, projectId, { q, status, page = 1, pageSize = 100 } = {}) {
  return db.readSnapshot(async () => {
    const company = await companyRecord(db, companyId);
    let project = null;
    if (projectId) {
      project = (await db.query(
        `SELECT p.*,tp."ProjectName" AS tally_project_name,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'keyword',r.keyword) ORDER BY r.keyword) FROM intel_project_rules r WHERE r.project_id=p.id),'[]'::jsonb) AS rules
         FROM intel_projects p LEFT JOIN "Projects" tp ON tp."ProjectID"=p.tally_project_id WHERE p.id=$1 AND p.company_id=$2`,
        [projectId, companyId])).rows[0];
      if (!project) throw fail('Project not found', 404);
    }
    const where = ['o.company_id=$1', 'a.project_id IS NOT DISTINCT FROM $2::uuid'];
    const params = [companyId, projectId || null];
    if (q) { params.push(`%${q}%`); where.push(`(a.account_name ILIKE $${params.length} OR r.tally_ledger_name ILIKE $${params.length})`); }
    if (status === 'differences') where.push(`r.status NOT IN ('MATCHED')`);
    else if (status && status !== 'all') { params.push(status); where.push(`r.status=$${params.length}`); }
    const size = Math.min(Number(pageSize) || 100, 500);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
    const base = `FROM intel_current_outstanding o
      JOIN intel_accounts a ON a.id=o.account_id
      LEFT JOIN intel_current_reconciliations r ON r.outstanding_id=o.id
      WHERE ${where.join(' AND ')}`;
    const rows = await db.query(
      `SELECT a.id AS account_id,a.account_name,a.project_source,a.level_1_category,o.import_batch_id,
              o.bill_amount,o.paid_amount,o.pending_bill_debit,o.pending_bill_credit,
              r.id AS reconciliation_id,r.status,r.source_amount,r.tally_amount,r.difference,r.tally_ledger_id,r.tally_ledger_name,
              r.reporting_date,r.tally_balance_date,r.comparison_available
       ${base}
       ORDER BY abs(COALESCE(r.difference,0)) DESC,a.account_name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, offset]);
    const total = (await db.query(`SELECT count(*)::int AS n ${base}`, params)).rows[0].n;
    const tallyOnly = (await db.query(
            `SELECT r.id AS reconciliation_id,r.tally_ledger_id,r.tally_ledger_name,r.tally_amount,r.difference,r.status,r.import_batch_id,
              r.reporting_date,r.tally_balance_date,r.comparison_available
       FROM intel_current_reconciliations r
       WHERE r.company_id=$1 AND r.outstanding_id IS NULL AND r.status='MISSING_IN_SOURCE'
         AND ${RULE_PROJECT('r.tally_ledger_name', 'r.company_id')} IS NOT DISTINCT FROM $2::uuid
       ORDER BY abs(COALESCE(r.difference,0)) DESC LIMIT 200`, [companyId, projectId || null])).rows;
    const choices = (await db.query('SELECT id,name FROM intel_projects WHERE company_id=$1 AND active ORDER BY lower(name)', [companyId])).rows;
    return {
      company: { id: company.id, name: company.name },
      project: project && { ...project },
      projectChoices: choices,
      tallyProjects: (await db.query('SELECT "ProjectID" AS id,"ProjectName" AS name FROM "Projects" WHERE "CompanyID"=$1 ORDER BY "ProjectName"', [company.tally_company_id])).rows,
      items: await rowsWithCurrency(db, rows.rows),
      total, page: Number(page) || 1, pageSize: size,
      tallyOnly: await rowsWithCurrency(db, tallyOnly),
    };
  });
}

/**
 * Suggest keywords from the data itself: the text after the last " - " in Excel
 * party names and Tally ledger names (e.g. "Pratik Petrolium - Majalgaon"), and
 * the names of Tally projects. Nothing is created automatically.
 */
async function suggestions(companyId) {
  const company = await companyRecord(db, companyId);
  const names = new Map();
  const add = name => { const key = String(name || '').trim().toLowerCase(); if (key) names.set(key, String(name)); };
  (await db.query('SELECT account_name FROM intel_accounts WHERE company_id=$1', [companyId])).rows.forEach(row => add(row.account_name));
  (await db.query('SELECT "LedgerName" AS name FROM "Ledgers" WHERE "CompanyID"=$1', [company.tally_company_id])).rows.forEach(row => add(row.name));
  const existing = new Set((await db.query('SELECT lower(btrim(keyword)) AS k FROM intel_project_rules WHERE company_id=$1', [companyId])).rows.map(row => row.k));
  const counts = new Map();
  for (const name of names.values()) {
    const parts = name.split(/\s+[-–]\s+/);
    if (parts.length < 2) continue;
    const tail = parts[parts.length - 1].trim();
    if (!/^[A-Za-z][A-Za-z .&]{2,29}$/.test(tail)) continue;
    const key = tail.toLowerCase();
    if (existing.has(key)) continue;
    const entry = counts.get(key) || { keyword: tail, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  const tallyProjects = (await db.query('SELECT "ProjectID" AS id,"ProjectName" AS name FROM "Projects" WHERE "CompanyID"=$1', [company.tally_company_id])).rows;
  const output = new Map();
  for (const project of tallyProjects) {
    const keyword = String(project.name).split(/\s*[-–]\s*/)[0].trim();
    const key = keyword.toLowerCase();
    if (keyword.length < 2 || existing.has(key)) continue;
    const count = [...names.keys()].filter(name => name.includes(key)).length;
    output.set(key, { keyword, count, tallyProjectId: project.id, tallyProjectName: project.name, source: 'TALLY_PROJECT' });
  }
  for (const [key, entry] of counts) {
    if (entry.count >= 2 && !output.has(key)) output.set(key, { ...entry, source: 'NAME_SUFFIX' });
  }
  return [...output.values()].sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword));
}

const REPORT_LIMIT = 10000;

/**
 * Every Excel-vs-Tally difference of the published import, with its project, for the
 * downloadable report: Excel parties that are not MATCHED, plus Tally ledgers that are
 * not in the Excel. Amounts follow the currency rules (hidden when not comparable).
 */
async function differences(companyId) {
  return db.readSnapshot(async () => {
    const company = await companyRecord(db, companyId);
    const parties = (await db.query(
      `SELECT COALESCE(p.name,'Not assigned to a project') AS project_name,a.account_name,a.level_1_category,o.import_batch_id,
              r.status,r.source_amount,r.tally_amount,r.difference,r.tally_ledger_id,r.tally_ledger_name
       FROM intel_current_outstanding o
       JOIN intel_accounts a ON a.id=o.account_id
       LEFT JOIN intel_projects p ON p.id=a.project_id
       LEFT JOIN intel_current_reconciliations r ON r.outstanding_id=o.id
       WHERE o.company_id=$1 AND COALESCE(r.status,'MATCHED')<>'MATCHED'
       ORDER BY lower(COALESCE(p.name,'~')),abs(COALESCE(r.difference,0)) DESC,a.account_name LIMIT $2`, [companyId, REPORT_LIMIT + 1])).rows;
    const tallyOnly = (await db.query(
      `SELECT COALESCE(p.name,'Not assigned to a project') AS project_name,r.import_batch_id,r.status,r.tally_ledger_id,r.tally_ledger_name,
              r.tally_amount,r.difference
       FROM intel_current_reconciliations r
       LEFT JOIN intel_projects p ON p.id=${RULE_PROJECT('r.tally_ledger_name', 'r.company_id')}
       WHERE r.company_id=$1 AND r.outstanding_id IS NULL AND r.status='MISSING_IN_SOURCE'
       ORDER BY lower(COALESCE(p.name,'~')),abs(COALESCE(r.difference,0)) DESC LIMIT $2`, [companyId, REPORT_LIMIT + 1])).rows;
    if (parties.length > REPORT_LIMIT || tallyOnly.length > REPORT_LIMIT) throw fail('The report is larger than 10,000 rows per list', 413);
    return {
      company: { id: company.id, name: company.name },
      parties: await rowsWithCurrency(db, parties),
      tallyOnly: await rowsWithCurrency(db, tallyOnly),
    };
  });
}

/**
 * Progress by upload: one row per import and project, newest first. `projectId` limits
 * it to one project ('unassigned' for parties without one); omit it for every project.
 * Money is returned only when that import had a declared currency.
 */
async function history(companyId, projectId, { limit = 60 } = {}) {
  return db.readSnapshot(async () => {
    const company = await companyRecord(db, companyId);
    const filtered = projectId !== undefined && projectId !== null;
    const unassigned = projectId === 'unassigned';
    const rows = (await db.query(
      `SELECT s.*,b.generation,b.completed_at,f.id AS file_id,f.file_name,
              (pub.import_batch_id IS NOT NULL) AS current
       FROM intel_project_snapshots s
       JOIN intel_import_batches b ON b.id=s.import_batch_id
       JOIN intel_import_files f ON f.id=b.import_file_id
       LEFT JOIN intel_company_publications pub ON pub.import_batch_id=s.import_batch_id
       WHERE s.company_id=$1
         AND (NOT $2::boolean OR ($3::boolean AND s.project_id IS NULL AND s.project_name IS NULL) OR (NOT $3::boolean AND s.project_id=$4::uuid))
       ORDER BY s.reporting_date DESC NULLS LAST,b.completed_at DESC NULLS LAST,lower(COALESCE(s.project_name,'~'))
       LIMIT $5`,
      [companyId, filtered, unassigned, unassigned ? null : projectId, Math.min(Math.max(Number(limit) || 60, 1), 500)])).rows;
    return {
      company: { id: company.id, name: company.name },
      items: rows.map(row => {
        const money = value => row.currency ? decimal.amount(value) : null;
        return {
          importId: row.file_id,
          batchId: row.import_batch_id,
          fileName: row.file_name,
          generation: row.generation,
          importedAt: row.completed_at,
          reportingDate: row.reporting_date,
          current: row.current,
          projectId: row.project_id,
          projectName: row.project_name || 'Not assigned to a project',
          currency: row.currency,
          parties: row.parties,
          billed: money(row.billed),
          paid: money(row.paid),
          pending: row.currency ? decimal.subtract(row.pending_debit, row.pending_credit) : null,
          paidPct: row.currency ? percent(row.paid, row.billed) : null,
          matched: row.matched,
          differences: row.differences,
          unavailable: row.unavailable,
          tallyOnlyLedgers: row.tally_only,
          gap: row.gap == null ? null : decimal.amount(row.gap),
        };
      }),
    };
  });
}

module.exports = { RULE_PROJECT, summary, detail, suggestions, history, differences, snapshotBatch, refreshCurrentSnapshot, createProject, updateProject, deleteProject, addRule, deleteRule, reapply, assignAccount, applyRules, budgetStatus };
