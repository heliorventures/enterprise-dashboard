const { createHash } = require('node:crypto');
const db = require('./db');

function invalid(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
function text(value, label, max, optional = false) {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw invalid(`${label} must be a nonempty string of at most ${max} characters`);
  }
  return value.trim();
}
function money(value, label) {
  // Send decimals as strings: no binary floating point conversion before PostgreSQL.
  if (typeof value !== 'string' || !/^-?\d{1,16}(\.\d{1,2})?$/.test(value)) {
    throw invalid(`${label} must be a decimal string with at most 16 integer and 2 fractional digits`);
  }
  return value;
}
function validateSnapshot(input, maxRows = 50000) {
  if (!input || input.fullSnapshot !== true) throw invalid('fullSnapshot must be true');
  const batchId = text(input.batchId, 'batchId', 200);
  const capturedAt = text(input.capturedAt, 'capturedAt', 40);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt))) {
    throw invalid('capturedAt must be an ISO timestamp with timezone');
  }
  const calendarDate = capturedAt.slice(0, 10);
  if (calendarDate.startsWith('0000') || new Date(calendarDate).toISOString().slice(0, 10) !== calendarDate) {
    throw invalid('capturedAt must contain a valid calendar date');
  }
  if (Date.parse(capturedAt) > Date.now() + 300000) throw invalid('capturedAt is in the future');
  const company = {
    externalId: text(input.company?.externalId, 'company.externalId', 200),
    name: text(input.company?.name, 'company.name', 200),
  };
  for (const key of ['ledgers', 'vouchers']) {
    if (!Array.isArray(input[key]) || input[key].length > maxRows) throw invalid(`${key} must be an array of at most ${maxRows} items`);
  }
  const ledgers = input.ledgers.map((row) => ({
    name: text(row?.name, 'ledger.name', 200),
    group: text(row?.group, 'ledger.group', 100),
    balance: money(row?.balance, 'ledger.balance'),
    sourceKey: ledgerKey(row),
  }));
  if (new Set(ledgers.map(row => row.name.toLowerCase())).size !== ledgers.length) throw invalid('Duplicate ledger names');
  if (new Set(ledgers.map(row => row.sourceKey)).size !== ledgers.length) throw invalid('Duplicate ledger source keys');
  const usedVoucherKeys = new Map();
  const vouchers = input.vouchers.map((row) => {
    const date = text(row?.date, 'voucher.date', 10);
    if (!/^\d{4}-\d\d-\d\d$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw invalid('voucher.date must be a valid YYYY-MM-DD date');
    }
    const mapped = {
      date, type: text(row.type, 'voucher.type', 80), amount: money(row.amount, 'voucher.amount'),
      number: text(row.number, 'voucher.number', 80, true),
      party: text(row.party, 'voucher.party', 200, true),
      narration: row.narration === '' ? '' : (text(row.narration, 'voucher.narration', 2000, true) || ''),
      project: text(row.project, 'voucher.project', 200, true),
    };
    return { ...mapped, sourceKey: uniqueVoucherKey(mapped, usedVoucherKeys) };
  });
  return { batchId, capturedAt: new Date(capturedAt).toISOString(), company, ledgers, vouchers };
}

function ledgerKey(row) {
  return `ledger:${String(row?.name || '').trim().toLowerCase()}`;
}

function projectKey(row) {
  return `project:${String(row?.name || '').trim().toLowerCase()}`;
}

function decimalKey(amount) {
  const raw = String(amount);
  const [integer, fraction = ''] = raw.replace(/^-/, '').split('.');
  const whole = integer.replace(/^0+(?=\d)/, '');
  const cents = fraction.padEnd(2, '0');
  const value = `${raw.startsWith('-') && (whole !== '0' || cents !== '00') ? '-' : ''}${whole}.${cents}`;
  return value;
}

function voucherKey(row) {
  return ['voucher', row.date, row.type, row.number || '', decimalKey(row.amount), row.party || ''].join('|');
}

function uniqueVoucherKey(row, used) {
  const base = voucherKey(row);
  const n = (used.get(base) || 0) + 1;
  used.set(base, n);
  return n === 1 ? base : `${base}|${n}`;
}

function planIncremental(existing, incoming, same) {
  const current = new Map(existing.map((row) => [row.sourceKey, row]));
  const insert = [];
  const update = [];
  const seen = new Set();
  for (const row of incoming) {
    seen.add(row.sourceKey);
    const prior = current.get(row.sourceKey);
    if (!prior) insert.push(row);
    else if (!same(prior, row)) update.push(row);
  }
  const remove = [...current.keys()].filter((key) => !seen.has(key));
  return {
    insert,
    update,
    remove,
    unchanged: incoming.length - insert.length - update.length,
  };
}

async function ingestSnapshot(input, { force = false, afterWrite, archivedSource = false } = {}) {
  const snapshot = validateSnapshot(input, archivedSource ? 5000000 : 50000);
  const { batchId, capturedAt, company, ledgers, vouchers } = snapshot;
  const checksum = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return db.transaction(async client => {
    const result = await applySnapshot(client, snapshot, checksum, id => replaceSnapshot(client, id, ledgers, vouchers), force, Boolean(afterWrite));
    if (afterWrite) {
      const latest = result.duplicate ? (await client.query('SELECT batch_id FROM tally_ingestions WHERE company_id=$1 ORDER BY captured_at DESC LIMIT 1',[result.companyId])).rows[0] : null;
      if (!result.duplicate || latest?.batch_id === batchId) result.projects = await afterWrite(client, result.companyId);
    }
    return result;
  });
}

async function clearReportingProjection(client, companyId) {
  for (const table of ['finance_allocations','finance_postings','finance_inventory_movements','finance_ledger_facts',...require('./reportingEntities').tables,'finance_monthly_summaries','finance_snapshots']) {
    await client.query(`DELETE FROM ${table} WHERE company_id=$1`, [companyId]);
  }
}

async function applySnapshot(client, { batchId, capturedAt, company }, checksum, writeRows, force = false, preserveProjection = false) {
    // Serialize imports before inspecting timestamps; never apply an older snapshot last.
    await client.query('SELECT pg_advisory_xact_lock(74312002)');
    const prior = await client.query('SELECT checksum, company_id FROM tally_ingestions WHERE batch_id = $1', [batchId]);
    if (prior.rows.length && force) {
      const id = prior.rows[0].company_id;
      const newer = await client.query('SELECT 1 FROM tally_ingestions WHERE company_id = $1 AND captured_at > $2 LIMIT 1', [id, capturedAt]);
      if (newer.rows.length) throw invalid('Cannot reprocess an older snapshot over newer reporting data', 409);
      if (!preserveProjection) await clearReportingProjection(client, id);
      const counts = await writeRows(id);
      await client.query('UPDATE tally_ingestions SET checksum = $2 WHERE batch_id = $1', [batchId, checksum]);
      await client.query(`INSERT INTO "SyncLog" ("Source", "Status", "Message") VALUES ('tally', 'ok', $1)`, [promoteMessage(company.name, counts)]);
      return { ok: true, duplicate: false, companyId: id, batchId, ...counts };
    }
    if (prior.rows.length) {
      if (prior.rows[0].checksum !== checksum) throw invalid('batchId already used for different data', 409);
      return { ok: true, duplicate: true, companyId: prior.rows[0].company_id, batchId };
    }
    const result = await client.query(`INSERT INTO "Companies" ("CompanyName", "ExternalID", "TallyGUID")
      VALUES ($1, $2, $2) ON CONFLICT ("ExternalID") DO UPDATE SET "CompanyName" = EXCLUDED."CompanyName"
      RETURNING "CompanyID"`, [company.name, company.externalId]);
    const id = result.rows[0].CompanyID;
    const latest = await client.query('SELECT captured_at FROM tally_ingestions WHERE company_id = $1 ORDER BY captured_at DESC LIMIT 1', [id]);
    if (latest.rows.length && Date.parse(capturedAt) <= latest.rows[0].captured_at.getTime()) {
      throw invalid('Snapshot is older than or equal to the latest accepted snapshot', 409);
    }
    if (!preserveProjection) await clearReportingProjection(client, id);
    const counts = await writeRows(id);
    await client.query('INSERT INTO tally_ingestions (batch_id, company_id, captured_at, checksum) VALUES ($1, $2, $3, $4)', [batchId, id, capturedAt, checksum]);
    await client.query(`INSERT INTO "SyncLog" ("Source", "Status", "Message") VALUES ('tally', 'ok', $1)`,
      [promoteMessage(company.name, counts)]);
    return { ok: true, duplicate: false, companyId: id, batchId, ...counts };
}

function promoteMessage(companyName, counts) {
  if (counts.ledgers && counts.vouchers) {
    return `Promoted ${companyName} incrementally: ${counts.ledgers.insert} ledgers new, ${counts.ledgers.update} updated, ${counts.ledgers.unchanged} unchanged, ${counts.ledgers.remove} removed; ${counts.vouchers.insert} vouchers new, ${counts.vouchers.update} updated, ${counts.vouchers.unchanged} unchanged, ${counts.vouchers.remove} removed`;
  }
  return `Promoted ${companyName}: ${counts.ledgerCount} ledgers, ${counts.voucherCount} vouchers`;
}

async function replaceSnapshot(client, companyId, ledgers, vouchers) {
  return applyIncremental(client, companyId, ledgers, vouchers);
}

function sameLedger(prior, row) {
  return prior.name === row.name && prior.group === row.group && decimalKey(prior.balance) === decimalKey(row.balance);
}

function sameVoucher(prior, row) {
  return prior.date === row.date
    && prior.type === row.type
    && decimalKey(prior.amount) === decimalKey(row.amount)
    && (prior.number || '') === (row.number || '')
    && (prior.party || '') === (row.party || '')
    && (prior.narration || '') === (row.narration || '');
}

async function applyIncremental(client, companyId, ledgers, vouchers) {
  const existingLedgers = (await client.query(
    `SELECT "SourceKey" AS "sourceKey", "LedgerName" AS name, "GroupCategory" AS "group", "CurrentBalance"::text AS balance
     FROM "Ledgers" WHERE "CompanyID" = $1 AND "SourceKey" IS NOT NULL`,
    [companyId]
  )).rows;
  const existingVouchers = (await client.query(
    `SELECT "SourceKey" AS "sourceKey", "VoucherDate"::text AS date, "VoucherType" AS type, "Amount"::text AS amount,
            "VoucherNumber" AS number, "PartyLedgerName" AS party, "Narration" AS narration
     FROM "Vouchers" WHERE "CompanyID" = $1 AND "Source" = 'tally' AND "SourceKey" IS NOT NULL`,
    [companyId]
  )).rows;
  const ledgerPlan = planIncremental(existingLedgers, ledgers, sameLedger);
  const voucherPlan = planIncremental(existingVouchers, vouchers, sameVoucher);

  if (ledgerPlan.insert.length) {
    await client.query(`INSERT INTO "Ledgers" ("CompanyID", "LedgerName", "GroupCategory", "CurrentBalance", "SourceKey")
      SELECT $1, name, "group", balance::numeric, "sourceKey"
      FROM jsonb_to_recordset($2::jsonb) AS x(name text, "group" text, balance text, "sourceKey" text)`,
    [companyId, JSON.stringify(ledgerPlan.insert)]);
  }
  for (const row of ledgerPlan.update) {
    await client.query(
      `UPDATE "Ledgers" SET "LedgerName"=$3, "GroupCategory"=$4, "CurrentBalance"=$5::numeric
       WHERE "CompanyID"=$1 AND "SourceKey"=$2`,
      [companyId, row.sourceKey, row.name, row.group, row.balance]
    );
  }
  if (ledgerPlan.remove.length) {
    await client.query(
      `DELETE FROM "Ledgers" WHERE "CompanyID"=$1 AND "SourceKey" = ANY($2::text[])`,
      [companyId, ledgerPlan.remove]
    );
  }

  if (voucherPlan.insert.length) {
    await client.query(`INSERT INTO "Vouchers" ("CompanyID", "VoucherDate", "VoucherType", "Amount", "VoucherNumber", "PartyLedgerName", "Narration", "Source", "SourceKey")
      SELECT $1, date::date, type, amount::numeric, number, party, narration, 'tally', "sourceKey"
      FROM jsonb_to_recordset($2::jsonb) AS x(date text, type text, amount text, number text, party text, narration text, "sourceKey" text)`,
    [companyId, JSON.stringify(voucherPlan.insert)]);
  }
  for (const row of voucherPlan.update) {
    await client.query(
      `UPDATE "Vouchers"
       SET "VoucherDate"=$3::date, "VoucherType"=$4, "Amount"=$5::numeric, "VoucherNumber"=$6, "PartyLedgerName"=$7, "Narration"=$8
       WHERE "CompanyID"=$1 AND "Source"='tally' AND "SourceKey"=$2`,
      [companyId, row.sourceKey, row.date, row.type, row.amount, row.number, row.party, row.narration]
    );
  }
  if (voucherPlan.remove.length) {
    await client.query(
      `DELETE FROM "Vouchers" WHERE "CompanyID"=$1 AND "Source"='tally' AND "SourceKey" = ANY($2::text[])`,
      [companyId, voucherPlan.remove]
    );
  }

  return {
    ledgerCount: ledgers.length,
    voucherCount: vouchers.length,
    ledgers: { insert: ledgerPlan.insert.length, update: ledgerPlan.update.length, unchanged: ledgerPlan.unchanged, remove: ledgerPlan.remove.length },
    vouchers: { insert: voucherPlan.insert.length, update: voucherPlan.update.length, unchanged: voucherPlan.unchanged, remove: voucherPlan.remove.length },
  };
}
async function attachProjects(companyId, vouchers = [], projects = [], transactionClient = null) {
  const names = new Map();
  for (const row of projects) {
    const name = String(row?.name || '').trim();
    if (name) names.set(name.toLowerCase(), name);
  }
  const used = new Map();
  const links = vouchers.map((row) => {
    const project = String(row?.project || '').trim();
    if (project) names.set(project.toLowerCase(), project);
    return {
      sourceKey: row.sourceKey || uniqueVoucherKey(row, used),
      projectKey: project ? projectKey({ name: project }) : '',
    };
  });
  const rows = [...names.values()].map((name) => ({ name, sourceKey: projectKey({ name }) }));
  if (!rows.length && !links.length) return { count: 0, linked: 0 };

  const write = async (client) => {
    if (rows.length) {
      await client.query(
        `INSERT INTO "Projects" ("CompanyID", "ProjectName", "SourceKey")
         SELECT $1, name, "sourceKey"
         FROM jsonb_to_recordset($2::jsonb) AS x(name text, "sourceKey" text)
         ON CONFLICT ("CompanyID", "SourceKey") WHERE "SourceKey" IS NOT NULL
         DO UPDATE SET "ProjectName" = EXCLUDED."ProjectName" WHERE "Projects"."ProjectName" IS DISTINCT FROM EXCLUDED."ProjectName"`,
        [companyId, JSON.stringify(rows)]
      );
    }
    if (links.length) {
      await client.query(
        `UPDATE "Vouchers" v
         SET "ProjectID" = mapped.id
         FROM (
           SELECT x."sourceKey", p."ProjectID" AS id
           FROM jsonb_to_recordset($2::jsonb) AS x("sourceKey" text, "projectKey" text)
           LEFT JOIN "Projects" p
             ON p."CompanyID" = $1
            AND p."SourceKey" = NULLIF(x."projectKey", '')
         ) mapped
         WHERE v."CompanyID" = $1
           AND v."Source" = 'tally'
           AND v."SourceKey" = mapped."sourceKey" AND v."ProjectID" IS DISTINCT FROM mapped.id`,
        [companyId, JSON.stringify(links)]
      );
    }
    return { count: rows.length, linked: links.filter((row) => row.projectKey).length };
  };
  return transactionClient ? write(transactionClient) : db.transaction(write);
}

async function appendRows(client, companyId, ledgers, vouchers, usedVoucherKeys = new Map()) {
  const keyedLedgers = ledgers.map((row) => ({ ...row, sourceKey: row.sourceKey || ledgerKey(row) }));
  const keyedVouchers = vouchers.map((row) => ({ ...row, sourceKey: uniqueVoucherKey(row, usedVoucherKeys) }));
  await client.query(`INSERT INTO "Ledgers" ("CompanyID", "LedgerName", "GroupCategory", "CurrentBalance", "SourceKey")
    SELECT $1, name, "group", balance::numeric, "sourceKey" FROM jsonb_to_recordset($2::jsonb)
      AS x(name text, "group" text, balance text, "sourceKey" text)`, [companyId, JSON.stringify(keyedLedgers)]);
  await client.query(`INSERT INTO "Vouchers" ("CompanyID", "VoucherDate", "VoucherType", "Amount", "VoucherNumber", "PartyLedgerName", "Narration", "Source", "SourceKey")
    SELECT $1, date::date, type, amount::numeric, number, party, narration, 'tally', "sourceKey"
    FROM jsonb_to_recordset($2::jsonb) AS x(date text, type text, amount text, number text, party text, narration text, "sourceKey" text)`,
    [companyId, JSON.stringify(keyedVouchers)]);
}

module.exports = {
  validateSnapshot,
  ingestSnapshot,
  applySnapshot,
  appendRows,
  applyIncremental,
  attachProjects,
  ledgerKey,
  projectKey,
  voucherKey,
  planIncremental,
  uniqueVoucherKey,
};
