const db = require('./db');
const { attachProjects, ingestSnapshot } = require('./ingest');

function invalid(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function children(node, name) {
  if (!node || !Array.isArray(node.content)) return [];
  return node.content.filter((child) => typeof child === 'object' && child.tag.toUpperCase() === name);
}

function field(node, name) {
  const matches = children(node, name);
  if (matches.length === 1 && matches[0].content.every((value) => typeof value === 'string')) {
    return matches[0].content.join('');
  }
  if (matches.length) return null;
  const key = Object.keys(node?.attributes || {}).find((nameKey) => nameKey.toUpperCase() === name);
  return key === undefined ? null : node.attributes[key];
}

function clipped(value, max) {
  const text = String(value ?? '').replace(/\u0004/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

function amount(value) {
  let raw = String(value ?? '').replace(/\u0004/g, '').trim();
  raw = raw.replace(/^(INR|Rs\.?|₹|USD)\s*/i, '');
  const credit = /\bCr\.?$/i.test(raw);
  raw = raw.replace(/\s*(Dr|Cr)\.?$/i, '').trim();
  if (!/^-?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,4})?$/.test(raw)) throw invalid('Unsupported Tally amount format');
  const signed = (credit && !raw.startsWith('-') ? '-' : '') + raw.replace(/,/g, '');
  const numeric = Number(signed);
  if (!Number.isFinite(numeric)) throw invalid('Unsupported Tally amount format');
  return numeric.toFixed(2);
}

function date(value) {
  const raw = String(value ?? '').trim();
  const iso = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
  if (!/^\d{4}-\d\d-\d\d$/.test(iso) || !Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString().slice(0, 10) !== iso) {
    throw invalid('Invalid Tally date');
  }
  return iso;
}

function yes(value) {
  return String(value || '').trim().toLowerCase() === 'yes';
}

function voucherAmount(node) {
  const direct = field(node, 'AMOUNT');
  if (typeof direct === 'string' && direct !== '') return amount(direct);
  const entries = [...children(node, 'ALLLEDGERENTRIES.LIST'), ...children(node, 'LEDGERENTRIES.LIST')];
  if (!entries.length) throw invalid('Missing voucher amount and accounting entries; fresh Tally export required');
  let credit = 0n;
  let debit = 0n;
  for (const entry of entries) {
    const raw = amount(field(entry, 'AMOUNT'));
    const negative = raw.startsWith('-');
    const [whole, fraction = ''] = raw.replace('-', '').split('.');
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (negative) debit += cents;
    else credit += cents;
  }
  if (credit !== debit) throw invalid('Voucher accounting entries do not balance');
  return amount(`${credit / 100n}.${String(credit % 100n).padStart(2, '0')}`);
}

function interpretLedger(node) {
  const name = clipped(field(node, 'NAME'), 200);
  const group = clipped(field(node, 'PARENT'), 100);
  if (!name) throw invalid('Invalid ledger name');
  if (!group) throw invalid('Invalid ledger group');
  const closing = field(node, 'CLOSINGBALANCE');
  if (closing === null) throw invalid('Missing closing balance; opening balance cannot represent current balance');
  const source = closing;
  const balance = source === '' || source === null ? '0.00' : amount(source);
  return { name, group, balance };
}

function interpretCostCentre(node) {
  const name = clipped(field(node, 'NAME') || node?.attributes?.NAME, 200);
  if (!name) throw invalid('Invalid cost centre name');
  return { name };
}

function collectNamed(node, tag, found = new Set()) {
  if (!node || typeof node !== 'object') return found;
  if (String(node.tag || '').toUpperCase() === tag) {
    const text = Array.isArray(node.content) ? node.content.filter((value) => typeof value === 'string').join('') : '';
    const name = clipped(text, 200);
    if (name) found.add(name);
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectNamed(child, tag, found);
  }
  return found;
}

function voucherProject(node) {
  const names = [...collectNamed(node, 'COSTCENTRENAME')];
  return names.length === 1 ? names[0] : '';
}

function interpretVoucher(node) {
  if (yes(field(node, 'ISCANCELLED')) || yes(field(node, 'ISOPTIONAL'))) return null;
  const type = clipped(field(node, 'VOUCHERTYPENAME') || field(node, 'VCHTYPE'), 80);
  if (!type) throw invalid('Invalid voucher type');
  const result = {
    date: date(field(node, 'DATE')),
    type,
    amount: voucherAmount(node),
    narration: clipped(field(node, 'NARRATION') || '', 2000),
  };
  const number = clipped(field(node, 'VOUCHERNUMBER'), 80);
  const party = clipped(field(node, 'PARTYLEDGERNAME') || field(node, 'PARTYNAME') || field(node, 'BASICBUYERNAME'), 200);
  const project = voucherProject(node);
  if (number) result.number = number;
  if (party) result.party = party;
  if (project) result.project = project;
  return result;
}

function projectRecords(rows) {
  const ledgers = [];
  const vouchers = [];
  const projects = [];
  const seen = new Set();
  const seenProjects = new Set();
  const skipped = { ledgers: 0, vouchers: 0, cancelled: 0 };
  const errors = [];
  for (const row of rows) {
    try {
      if (row.collection === 'LEDGER') {
        const ledger = interpretLedger(row.payload);
        const key = ledger.name.toLowerCase();
        if (seen.has(key)) {
          skipped.ledgers += 1;
          continue;
        }
        seen.add(key);
        ledgers.push(ledger);
      } else if (row.collection === 'COSTCENTRE') {
        const project = interpretCostCentre(row.payload);
        const key = project.name.toLowerCase();
        if (seenProjects.has(key)) continue;
        seenProjects.add(key);
        projects.push(project);
      } else if (row.collection === 'VOUCHER') {
        const voucher = interpretVoucher(row.payload);
        if (voucher === null) skipped.cancelled += 1;
        else {
          if (voucher.project && !seenProjects.has(voucher.project.toLowerCase())) {
            seenProjects.add(voucher.project.toLowerCase());
            projects.push({ name: voucher.project });
          }
          vouchers.push(voucher);
        }
      }
    } catch (error) {
      if (row.collection === 'LEDGER') skipped.ledgers += 1;
      else skipped.vouchers += 1;
      if (errors.length < 20) errors.push(`${row.collection}#${row.ordinal}: ${error.message}`);
    }
  }
  return { ledgers, vouchers, projects, skipped, errors };
}

function assertPromotable({ skipped = {}, errors = [] }) {
  if (errors.length || skipped.ledgers || skipped.vouchers) {
    throw invalid(`Financial validation failed: ${skipped.ledgers || 0} ledger records and ${skipped.vouchers || 0} voucher records rejected. No reporting data changed. ${errors.slice(0, 3).join('; ')}`, 422);
  }
}

function snapshotTimestamp(value) {
  return new Date(value).toISOString();
}

async function unpackBatch(batchId, { force = false } = {}) {
  if (typeof batchId !== 'string' || !batchId.trim()) throw invalid('batchId required');
  const snapshot = (await db.query(
    'SELECT batch_id, company_external_id, company_name, captured_at, coverage_status, manifest FROM tally_source_snapshots WHERE batch_id = $1',
    [batchId]
  )).rows[0];
  if (!snapshot) throw invalid('Source snapshot not found', 404);
  if (snapshot.coverage_status !== 'complete') {
    throw invalid('Partial source snapshot cannot replace reporting data; complete export required', 409);
  }
  const prior = (await db.query('SELECT company_id FROM tally_ingestions WHERE batch_id = $1', [batchId])).rows[0];
  const records = await db.query(
    `SELECT collection, ordinal, payload
     FROM tally_source_records
     WHERE batch_id = $1 AND collection IN ('LEDGER', 'VOUCHER', 'COSTCENTRE')
     ORDER BY collection, ordinal`,
    [batchId]
  );
  const { ledgers, vouchers, projects, skipped, errors } = projectRecords(records.rows);
  assertPromotable({ skipped, errors });
  let result;
  if (prior && !force) {
    result = {
      ok: true, duplicate: true, companyId: prior.company_id, batchId: snapshot.batch_id,
      companyName: snapshot.company_name, skipped: { ledgers: 0, vouchers: 0, cancelled: 0 }, errors: [],
    };
  } else {
    result = await ingestSnapshot({
      batchId: snapshot.batch_id,
      capturedAt: snapshotTimestamp(snapshot.captured_at),
      fullSnapshot: true,
      company: { externalId: snapshot.company_external_id, name: snapshot.company_name },
      ledgers,
      vouchers,
    }, { force });
  }
  if (result.companyId) {
    result.projects = await attachProjects(result.companyId, vouchers, projects);
  }
  return {
    ...result,
    companyName: snapshot.company_name,
    skipped,
    errors,
  };
}

async function listPromotableSnapshots() {
  return (await db.query(`
    SELECT DISTINCT ON (company_external_id) batch_id, company_external_id, company_name, captured_at
    FROM tally_source_snapshots
    WHERE coverage_status = 'complete'
    ORDER BY company_external_id, captured_at DESC, received_at DESC, batch_id DESC
  `)).rows;
}

async function unpackLatest(options = {}) {
  const companies = [];
  for (const row of await listPromotableSnapshots()) {
    try {
      companies.push(await unpackBatch(row.batch_id, options));
    } catch (error) {
      companies.push({
        ok: false,
        batchId: row.batch_id,
        companyName: row.company_name,
        error: error.message,
      });
    }
  }
  return { ok: companies.every((row) => row.ok), companies };
}

module.exports = {
  field,
  assertPromotable,
  interpretLedger,
  interpretCostCentre,
  interpretVoucher,
  projectRecords,
  listPromotableSnapshots,
  unpackBatch,
  unpackLatest,
};

if (require.main === module) {
  const sourceSync = require('./sourceSync');
  sourceSync.start({ triggeredBy: 'cli', force: process.argv.includes('--force'), wait: true })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'error') process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
