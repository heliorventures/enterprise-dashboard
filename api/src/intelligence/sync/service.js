const db = require('../../db');
const tally = require('../tally/provider');

async function rulesFor() {
  const result = await db.query(`SELECT key, value FROM intel_rules WHERE company_id IS NULL`);
  return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
}

function nameScore(left, right) {
  const a = tally.normalizeName(left);
  const b = tally.normalizeName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.72;
  const aTokens = a.split(' ').filter((token) => token.length > 2);
  const bTokens = b.split(' ').filter((token) => token.length > 2);
  if (!aTokens.length || !bTokens.length) return 0;
  const set = new Set(aTokens);
  const hits = bTokens.filter((token) => set.has(token)).length;
  return hits / Math.max(aTokens.length, bTokens.length);
}

async function listSync({ companyId, status, q, minDifference, mapped, page = 1, pageSize = 50 } = {}) {
  return db.readSnapshot(async()=>{
  const where = ['1=1'];
  const params = [];
  if (companyId) {
    params.push(companyId);
    where.push(`r.company_id=$${params.length}`);
  }
  if (status && status !== 'all') {
    if (status === 'differences') {
      where.push(`r.status <> 'MATCHED'`);
    } else {
      params.push(status);
      where.push(`r.status=$${params.length}`);
    }
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(a.account_name ILIKE $${params.length} OR r.tally_ledger_name ILIKE $${params.length} OR a.pan_number ILIKE $${params.length} OR a.gst_number ILIKE $${params.length})`);
  }
  if (minDifference) {
    params.push(Number(minDifference) || 0);
    where.push(`abs(COALESCE(r.difference,0)) >= $${params.length}`);
  }
  if (mapped === 'manual') where.push(`m.id IS NOT NULL`);
  if (mapped === 'unmapped') where.push(`r.tally_ledger_id IS NULL`);
  if (mapped === 'auto') where.push(`m.id IS NULL AND r.tally_ledger_id IS NOT NULL`);
  const size=Math.min(Number(pageSize) || 50,500);
  params.push(size, (Math.max(Number(page) || 1, 1) - 1) * size);
  const result = await db.query(
    `SELECT r.id, r.status, r.match_method, r.match_score, r.matching_fields,
            r.source_amount, r.tally_amount, r.difference, r.difference_pct, r.import_batch_id, r.tally_batch_id, r.tally_balance_date, r.comparison_available,
            r.tally_ledger_id, r.tally_ledger_name, r.outstanding_id, r.company_id,
            a.id AS account_id, a.account_name, a.pan_number, a.gst_number, a.category_path,
            a.level_1_category, c.name AS company_name, c.tally_company_id,
            o.pending_bill_debit, o.pending_bill_credit, o.bill_amount, o.paid_amount, r.reporting_date,
            m.source AS mapping_source, m.mapped_by, m.mapped_at
     FROM intel_current_reconciliations r
     JOIN intel_companies c ON c.id=r.company_id
     LEFT JOIN intel_current_outstanding o ON o.id=r.outstanding_id
     LEFT JOIN intel_accounts a ON a.id=o.account_id
     LEFT JOIN intel_account_maps m ON m.account_id=a.id AND m.company_id=r.company_id
     WHERE ${where.join(' AND ')}
     ORDER BY CASE r.status WHEN 'AMOUNT_MISMATCH' THEN 0 WHEN 'MISSING_IN_TALLY' THEN 1 WHEN 'MISSING_IN_SOURCE' THEN 2 WHEN 'PARTIALLY_MATCHED' THEN 3 ELSE 4 END,
              abs(COALESCE(r.difference,0)) DESC, r.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = await db.query(
    `SELECT count(*)::int AS count
     FROM intel_current_reconciliations r
     JOIN intel_companies c ON c.id=r.company_id
     LEFT JOIN intel_current_outstanding o ON o.id=r.outstanding_id
     LEFT JOIN intel_accounts a ON a.id=o.account_id
     LEFT JOIN intel_account_maps m ON m.account_id=a.id AND m.company_id=r.company_id
     WHERE ${where.join(' AND ')}`,
    params.slice(0, params.length - 2)
  );
  const counts = await db.query(
    `SELECT r.status, count(*)::int AS count
     FROM intel_current_reconciliations r
     WHERE ($1::uuid IS NULL OR r.company_id=$1)
     GROUP BY r.status`,
    [companyId || null]
  );
  return {
    items: result.rows,
    total: total.rows[0].count,
    page: Number(page),
    pageSize: size,
    counts: Object.fromEntries(counts.rows.map((row) => [row.status, row.count])),
  };
  });
}

async function suggestions(accountName, ledgers, currentId) {
  return ledgers
    .map((ledger) => ({
      id: ledger.id,
      name: ledger.name,
      groupName: ledger.groupName,
      balance: ledger.balance,
      score: nameScore(accountName, ledger.name),
      current: ledger.id === currentId,
    }))
    .filter((row) => row.current || row.score >= 0.28)
    .sort((left, right) => right.score - left.score || Math.abs(right.balance) - Math.abs(left.balance))
    .slice(0, 12);
}

async function detail(id) {
  return db.readSnapshot(async()=>{
  const result = await db.query(
    `SELECT r.*, b.frozen_inputs, a.id AS account_id, a.account_name, a.pan_number, a.gst_number, a.msme_number,
            a.category_path, a.level_1_category, a.credit_days,
            c.name AS company_name, c.tally_company_id,
            o.pending_bill_debit, o.pending_bill_credit, o.bill_amount, o.paid_amount,
            o.last_payment_amount, o.last_payment_date, r.reporting_date,
            m.source AS mapping_source, m.mapped_by, m.mapped_at, m.tally_ledger_id AS mapped_ledger_id
     FROM intel_current_reconciliations r
     JOIN intel_import_batches b ON b.id=r.import_batch_id
     JOIN intel_companies c ON c.id=r.company_id
     LEFT JOIN intel_current_outstanding o ON o.id=r.outstanding_id
     LEFT JOIN intel_accounts a ON a.id=o.account_id
     LEFT JOIN intel_account_maps m ON m.account_id=a.id AND m.company_id=r.company_id
     WHERE r.id=$1`,
    [id]
  );
  if (!result.rowCount) throw Object.assign(new Error('Reconciliation row not found'), { status: 404 });
  const row = result.rows[0];
  const rules = await rulesFor();
  const ledgers = row.frozen_inputs?.reference?.ledgers || await tally.listLedgers(row.tally_company_id);
  const ageing = row.outstanding_id
    ? (await db.query('SELECT * FROM intel_ageing WHERE outstanding_id=$1 ORDER BY ageing_bucket', [row.outstanding_id])).rows
    : [];
  const sourceAmount = row.source_amount || '0.00';
  const tallyAmount = row.tally_amount;
  const difference = row.difference;
  const tolerance = Number((row.frozen_inputs?.rules || rules).amount_tolerance?.amount ?? 1000);
  return {
    id: row.id,
    status: row.status,
    company: { id: row.company_id, name: row.company_name, tallyCompanyId: row.tally_company_id },
    account: row.account_id ? {
      id: row.account_id,
      name: row.account_name,
      pan: row.pan_number,
      gst: row.gst_number,
      msme: row.msme_number,
      category: row.category_path,
      creditDays: row.credit_days,
    } : null,
    excel: {
      bill: row.bill_amount || '0.00',
      paid: row.paid_amount || '0.00',
      pendingDebit: row.pending_bill_debit || '0.00',
      pendingCredit: row.pending_bill_credit || '0.00',
      lastPayment: row.last_payment_amount || '0.00',
      lastPaymentDate: row.last_payment_date,
      reportingDate: row.reporting_date,
      pendingNet: sourceAmount,
    },
    tally: {
      ledgerId: row.tally_ledger_id,
      ledgerName: row.tally_ledger_name,
      balance: tallyAmount,
      groupName: ledgers.find((item) => item.id === Number(row.tally_ledger_id))?.groupName || null,
    },
    mapping: {
      source: row.mapping_source || (row.match_method === 'MANUAL' ? 'MANUAL' : row.tally_ledger_id ? 'AUTO' : null),
      method: row.match_method,
      score: row.match_score,
      fields: row.matching_fields,
      mappedBy: row.mapped_by,
      mappedAt: row.mapped_at,
      canMap: Boolean(row.account_id),
    },
    comparison: {
      reportingDate:row.reporting_date, tallyBalanceDate:row.tally_balance_date, tallyBatchId:row.tally_batch_id, comparisonAvailable:row.comparison_available,
      sourceAmount,
      tallyAmount,
      difference,
      differencePct: row.difference_pct,
      tolerance,
      inSync: row.status === 'MATCHED',
      explanation: explain(row.status, sourceAmount, tallyAmount, difference, tolerance, row.tally_ledger_name),
    },
    ageing,
    suggestions: await suggestions(row.account_name || '', ledgers, Number(row.tally_ledger_id) || null),
  };
  });
}

function explain(status, sourceAmount, tallyAmount, difference, tolerance, ledgerName) {
  if (status === 'COMPARISON_UNAVAILABLE') return 'The Excel reporting date and archived Tally balance date are unknown or different. A financial comparison is unavailable.';
  if (status === 'MATCHED') {
    return `Excel pending net and Tally balance are within the ₹${tolerance.toLocaleString('en-IN')} tolerance${ledgerName ? ` for ${ledgerName}` : ''}.`;
  }
  if (status === 'MISSING_IN_TALLY') {
    return 'This Excel account is not mapped to a Tally ledger for the selected company. Map it to the correct ledger to check the amount.';
  }
  if (status === 'MISSING_IN_SOURCE') {
    return 'This Tally ledger has a balance but was not found in the uploaded Excel file.';
  }
  if (status === 'PARTIALLY_MATCHED') {
    return `The name is only a close match${ledgerName ? ` (${ledgerName})` : ''}. Confirm the mapping, then compare the amounts.`;
  }
  if (tallyAmount == null) {
    return 'No Tally balance is available until a ledger is mapped.';
  }
  const side = difference > 0 ? 'Excel is higher' : 'Tally is higher';
  return `${side} by ₹${Math.abs(difference).toLocaleString('en-IN')}. Tolerance is ₹${tolerance.toLocaleString('en-IN')}.`;
}

async function mapRecon(id,tallyLedgerId,username) {
  const imports = require('../imports/service');
  const nextId = await db.transaction(async client => {
    const current = (await client.query(`SELECT r.*,o.account_id,b.import_file_id,b.frozen_inputs
      FROM intel_current_reconciliations r JOIN intel_outstanding o ON o.id=r.outstanding_id
      JOIN intel_import_batches b ON b.id=r.import_batch_id WHERE r.id=$1`,[id])).rows[0];
    if (!current) throw Object.assign(new Error('Only a current Excel reconciliation can be mapped'),{status:409});
    if (!current.frozen_inputs) throw Object.assign(new Error('Reprocess this legacy import before changing its reconciliation'),{status:409});
    await client.query('SELECT pg_advisory_xact_lock(61009,hashtext($1))',[current.company_id]);
    await client.query('SELECT id FROM intel_import_files WHERE id=$1 FOR UPDATE',[current.import_file_id]);
    await client.query('SELECT id FROM intel_companies WHERE id=$1 FOR UPDATE',[current.company_id]);
    if (!(await client.query('SELECT id FROM intel_current_reconciliations WHERE id=$1',[id])).rowCount) throw Object.assign(new Error('Publication changed; reload this reconciliation'),{status:409});
    const reference=current.frozen_inputs.reference;
    const ledger = reference.ledgers.find(row => row.id===Number(tallyLedgerId));
    if (tallyLedgerId!=null && tallyLedgerId!=='' && !ledger) throw Object.assign(new Error('Ledger is unavailable in this generation Tally snapshot'),{status:400});
    if (ledger) {
      if ((await client.query('SELECT id FROM intel_account_maps WHERE company_id=$1 AND tally_ledger_id=$2 AND account_id<>$3',[current.company_id,ledger.id,current.account_id])).rowCount)
        throw Object.assign(new Error('This ledger is already reserved for another account'),{status:409});
      await client.query(`INSERT INTO intel_account_maps(company_id,account_id,tally_ledger_id,tally_ledger_name,mapped_by,source) VALUES($1,$2,$3,$4,$5,'MANUAL')
        ON CONFLICT(company_id,account_id) DO UPDATE SET tally_ledger_id=EXCLUDED.tally_ledger_id,tally_ledger_name=EXCLUDED.tally_ledger_name,mapped_by=EXCLUDED.mapped_by,mapped_at=now(),source='MANUAL'`,[current.company_id,current.account_id,ledger.id,ledger.name,username]);
    } else await client.query('DELETE FROM intel_account_maps WHERE company_id=$1 AND account_id=$2',[current.company_id,current.account_id]);
    const reserved = await imports.claim(current.import_file_id,{username,reprocess:true,reference,inputs:current.frozen_inputs},{transaction:work=>work(client)});
    if (reserved.existing) throw Object.assign(new Error('An import is already processing'),{status:409});
    await imports.publishGeneration(client,reserved);
    await client.query(`INSERT INTO intel_audit(username,action,entity,entity_id,old_value,new_value) VALUES($1,$2,'account',$3,$4,$5)`,[username,ledger?'MAP_LEDGER':'UNMAP_LEDGER',current.account_id,{reconId:id,batchId:current.import_batch_id},{batchId:reserved.batch.id,tallyLedgerId:ledger?.id || null}]);
    return (await client.query('SELECT r.id FROM intel_reconciliations r JOIN intel_outstanding o ON o.id=r.outstanding_id WHERE r.import_batch_id=$1 AND o.account_id=$2',[reserved.batch.id,current.account_id])).rows[0].id;
  });
  return detail(nextId);
}

async function listLedgers({ company, q } = {}) {
  const tallyId = Number(company);
  if (!Number.isInteger(tallyId) || tallyId <= 0) return [];
  const ledgers = await tally.listLedgers(tallyId);
  const needle = tally.normalizeName(q || '');
  if (!needle) return ledgers.slice(0, 80);
  return ledgers
    .map((row) => ({ ...row, score: nameScore(needle, row.normalized) }))
    .filter((row) => row.score >= 0.28 || row.normalized.includes(needle) || needle.includes(row.normalized))
    .sort((left, right) => right.score - left.score)
    .slice(0, 80);
}

module.exports = { listSync, detail, mapRecon, listLedgers, rulesFor };
