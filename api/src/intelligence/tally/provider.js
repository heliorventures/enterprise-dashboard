const db = require('../db');
const { normalizeSpace } = require('../excel/parser');

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
               l."GroupCategory" AS group_name, l."CurrentBalance" AS balance
        FROM "Ledgers" l
        WHERE l."CompanyID" = $1
      `,
      [tallyCompanyId]
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      companyId: Number(row.company_id),
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
    const reference = await database.query(`SELECT f.batch_id, s.manifest
      FROM finance_snapshots f JOIN tally_source_snapshots s ON s.batch_id=f.batch_id
      WHERE f.company_id=$1`, [tallyCompanyId]);
    const row = reference.rows[0];
    if (!row) return { ledgers:await listLedgers(tallyCompanyId,database),batchId:null,balanceDate:null };
    const facts = await database.query(`SELECT l."LedgerID" AS id,f.name,f.group_name,f.closing_balance AS balance
      FROM finance_ledger_facts f LEFT JOIN "Ledgers" l ON l."CompanyID"=f.company_id AND l."LedgerName"=f.name
      WHERE f.company_id=$1 AND f.batch_id=$2`,[tallyCompanyId,row.batch_id]);
    const coherent = facts.rows.length>0 && facts.rows.every(ledger=>ledger.id!=null)
      && new Set(facts.rows.map(ledger=>ledger.name)).size===facts.rows.length;
    return { ledgers:coherent ? facts.rows.map(ledger=>({id:Number(ledger.id),companyId:tallyCompanyId,name:ledger.name,
        normalized:normalizeName(ledger.name),groupName:ledger.group_name,balance:String(ledger.balance)})) : await listLedgers(tallyCompanyId,database),
      batchId:row.batch_id, balanceDate:coherent ? require('../excel/parser').parseDate(row.manifest?.dateContext?.ledgers?.to) : null };
  };
  return database===db ? db.readSnapshot(read) : read();
}

module.exports = { listCompanies, listLedgers, matchCompanyName, normalizeName, snapshot };
