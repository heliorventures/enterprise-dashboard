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

async function listLedgers(tallyCompanyId) {
  if (!tallyCompanyId) return [];
  try {
    const result = await db.query(
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
      balance: Number(row.balance) || 0,
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

module.exports = { listCompanies, listLedgers, matchCompanyName, normalizeName };
