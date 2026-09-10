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
function validateSnapshot(input) {
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
    if (!Array.isArray(input[key]) || input[key].length > 50000) throw invalid(`${key} must be an array of at most 50000 items`);
  }
  const ledgers = input.ledgers.map((row) => ({
    name: text(row?.name, 'ledger.name', 200),
    group: text(row?.group, 'ledger.group', 100),
    balance: money(row?.balance, 'ledger.balance'),
  }));
  if (new Set(ledgers.map(row => row.name.toLowerCase())).size !== ledgers.length) throw invalid('Duplicate ledger names');
  const vouchers = input.vouchers.map((row) => {
    const date = text(row?.date, 'voucher.date', 10);
    if (!/^\d{4}-\d\d-\d\d$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw invalid('voucher.date must be a valid YYYY-MM-DD date');
    }
    return {
      date, type: text(row.type, 'voucher.type', 80), amount: money(row.amount, 'voucher.amount'),
      number: text(row.number, 'voucher.number', 80, true),
      party: text(row.party, 'voucher.party', 200, true),
      narration: row.narration === '' ? '' : (text(row.narration, 'voucher.narration', 400, true) || ''),
    };
  });
  return { batchId, capturedAt: new Date(capturedAt).toISOString(), company, ledgers, vouchers };
}

async function ingestSnapshot(input) {
  const snapshot = validateSnapshot(input);
  const { batchId, capturedAt, company, ledgers, vouchers } = snapshot;
  const checksum = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return db.transaction(client => applySnapshot(client, snapshot, checksum,
    id => replaceSnapshot(client, id, ledgers, vouchers)));
}

async function applySnapshot(client, { batchId, capturedAt, company }, checksum, writeRows) {
    // Serialize imports before inspecting timestamps; never apply an older snapshot last.
    await client.query('SELECT pg_advisory_xact_lock(74312002)');
    const prior = await client.query('SELECT checksum, company_id FROM tally_ingestions WHERE batch_id = $1', [batchId]);
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
    const counts = await writeRows(id);
    await client.query('INSERT INTO tally_ingestions (batch_id, company_id, captured_at, checksum) VALUES ($1, $2, $3, $4)', [batchId, id, capturedAt, checksum]);
    await client.query(`INSERT INTO "SyncLog" ("Source", "Status", "Message") VALUES ('tally', 'ok', $1)`,
      [`Received ${company.name}: ${counts.ledgerCount} ledgers, ${counts.voucherCount} vouchers`]);
    return { ok: true, duplicate: false, companyId: id, batchId, ...counts };
}

async function replaceSnapshot(client, companyId, ledgers, vouchers) {
  await client.query('DELETE FROM "Ledgers" WHERE "CompanyID" = $1', [companyId]);
  await client.query(`DELETE FROM "Vouchers" WHERE "CompanyID" = $1 AND "Source" = 'tally'`, [companyId]);
  await appendRows(client, companyId, ledgers, vouchers);
  return { ledgerCount: ledgers.length, voucherCount: vouchers.length };
}
async function appendRows(client, companyId, ledgers, vouchers) {
  await client.query(`INSERT INTO "Ledgers" ("CompanyID", "LedgerName", "GroupCategory", "CurrentBalance")
    SELECT $1, name, "group", balance::numeric FROM jsonb_to_recordset($2::jsonb)
      AS x(name text, "group" text, balance text)`, [companyId, JSON.stringify(ledgers)]);
  await client.query(`INSERT INTO "Vouchers" ("CompanyID", "VoucherDate", "VoucherType", "Amount", "VoucherNumber", "PartyLedgerName", "Narration", "Source")
    SELECT $1, date::date, type, amount::numeric, number, party, narration, 'tally'
    FROM jsonb_to_recordset($2::jsonb) AS x(date text, type text, amount text, number text, party text, narration text)`,
    [companyId, JSON.stringify(vouchers)]);
}

module.exports = { validateSnapshot, ingestSnapshot, applySnapshot, appendRows };
