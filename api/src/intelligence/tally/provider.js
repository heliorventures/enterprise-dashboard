const db = require('../db');
const { normalizeSpace } = require('../excel/parser');
const { scalarField } = require('../../sourceTree');
const { currencyCode } = require('../../reportCurrency');
const { balanceDateBasis } = require('./balanceDate');

function normalizeName(name) {
  return normalizeSpace(name).replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
}

async function listCompanies() {
  try {
    const result = await db.query(`
      SELECT "CompanyID" AS id, "CompanyName" AS name, "IsActive" AS active
      FROM "Companies"
      WHERE COALESCE("IsActive", true) = true
      ORDER BY "CompanyName"
    `);
    return result.rows.map((row) => ({ id: Number(row.id), name: row.name, active: row.active !== false, source: 'tally' }));
  } catch (error) {
    if (error.code === '42P01') return [];
    throw error;
  }
}

async function listLedgers(tallyCompanyId, database=db) {
  if (!tallyCompanyId) return [];
  try {
    const result = await database.query(
      `
        SELECT l."LedgerID" AS id, l."CompanyID" AS company_id, l."LedgerName" AS name,
               l."GroupCategory" AS group_name, l."CurrentBalance" AS balance, l."SourceKey" AS source_key
        FROM "Ledgers" l
        WHERE l."CompanyID" = $1
      `,
      [tallyCompanyId]
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      companyId: Number(row.company_id),
      sourceKey: row.source_key || null,
      guid: null,
      name: row.name,
      normalized: normalizeName(row.name),
      groupName: row.group_name,
      balance: String(row.balance ?? '0'),
    }));
  } catch (error) {
    if (error.code === '42P01') return [];
    throw error;
  }
}

async function matchCompanyName(name) {
  const companies = await listCompanies();
  const needle = normalizeName(name);
  if (!needle) return null;
  return companies.find((row) => normalizeName(row.name) === needle)
    || companies.find((row) => needle.includes(normalizeName(row.name)) || normalizeName(row.name).includes(needle))
    || null;
}

async function snapshot(tallyCompanyId, database=db) {
  const read = async () => {
    const reference = await database.query(`SELECT f.batch_id, f.currency, f.coverage, s.manifest
      FROM finance_snapshots f JOIN tally_source_snapshots s ON s.batch_id=f.batch_id
      WHERE f.company_id=$1`, [tallyCompanyId]);
    const row = reference.rows[0];
    if (!row) {
      // No dated balance snapshot (legacy ledgers). The company's own currency is the
      // Tally currency; the configured default applies only if the company has none.
      const company = (await database.query('SELECT "Currency" AS currency FROM "Companies" WHERE "CompanyID"=$1',[tallyCompanyId])).rows[0];
      const currency = currencyCode(company?.currency) || currencyCode(require('../config').defaultCurrency);
      return { ledgers:await listLedgers(tallyCompanyId,database),batchId:null,balanceDate:null,
        balanceDateAssumed:require('../config').assumeUndatedTallyBalances===true,
        currency,currencyAssumed:Boolean(currency),uniformCurrency:Boolean(currency) };
    }
    const facts = await database.query(`SELECT l."LedgerID" AS id,l."SourceKey" AS source_key,f.name,f.group_name,f.closing_balance AS balance,
        r.payload AS archive_payload, f.currency
      FROM finance_ledger_facts f LEFT JOIN "Ledgers" l ON l."CompanyID"=f.company_id AND l."LedgerName"=f.name
      LEFT JOIN tally_source_records r ON r.batch_id=f.batch_id AND r.collection='LEDGER' AND r.ordinal=f.ordinal
      WHERE f.company_id=$1 AND f.batch_id=$2`,[tallyCompanyId,row.batch_id]);
    const coherent = facts.rows.length>0 && facts.rows.every(ledger=>ledger.id!=null)
      && new Set(facts.rows.map(ledger=>ledger.name)).size===facts.rows.length;
    return { ledgers:coherent ? facts.rows.map(ledger=>({id:Number(ledger.id),companyId:tallyCompanyId,name:ledger.name,
        sourceKey:ledger.source_key || null,guid:scalarField(ledger.archive_payload,'GUID')?.trim() || null,
        currency:currencyCode(ledger.currency) || currencyCode(row.currency),
        normalized:normalizeName(ledger.name),groupName:ledger.group_name,balance:String(ledger.balance)})) : await listLedgers(tallyCompanyId,database),
      currency:currencyCode(row.currency),uniformCurrency:row.coverage?.uniformCurrency===true,
      batchId:row.batch_id, ...(coherent ? balanceDateBasis(row.manifest?.dateContext?.ledgers?.to) : {balanceDate:null}) };
  };
  return database===db ? db.readSnapshot(read) : read();
}

module.exports = { listCompanies, listLedgers, matchCompanyName, normalizeName, snapshot };
