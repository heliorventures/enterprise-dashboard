const db = require('./db');

function toNumber(value) {
  return Number(value) || 0;
}

const { companyFilter, paging, optionalDate } = require('./filters');

async function listLedgers({ company = 'all', q = '', group = '', page = 1, pageSize = 25 } = {}) {
  const companyId = companyFilter(company);
  const { size, offset } = paging(page, pageSize);
  const search = String(q || '').trim();
  const groupName = String(group || '').trim();

  const where = `
    c."IsActive" = true
    AND ($1 = 0 OR l."CompanyID" = $1)
    AND ($2 = '' OR l."GroupCategory" = $2)
    AND (
      $3 = ''
      OR l."LedgerName" ILIKE '%' || $3 || '%'
      OR l."GroupCategory" ILIKE '%' || $3 || '%'
      OR c."CompanyName" ILIKE '%' || $3 || '%'
    )
  `;

  const [count, rows, groups] = await Promise.all([
    db.query(
      `
        SELECT COUNT(*) AS "Total"
        FROM "Ledgers" l
        INNER JOIN "Companies" c ON c."CompanyID" = l."CompanyID"
        WHERE ${where}
      `,
      [companyId, groupName, search]
    ),
    db.query(
      `
        SELECT
          l."LedgerID", l."CompanyID", c."CompanyName", l."LedgerName", l."GroupCategory", l."CurrentBalance"
        FROM "Ledgers" l
        INNER JOIN "Companies" c ON c."CompanyID" = l."CompanyID"
        WHERE ${where}
        ORDER BY c."CompanyName", l."GroupCategory", l."LedgerName", l."LedgerID"
        LIMIT $4 OFFSET $5
      `,
      [companyId, groupName, search, size, offset]
    ),
    db.query(
      `
        SELECT DISTINCT l."GroupCategory" AS "Name"
        FROM "Ledgers" l
        INNER JOIN "Companies" c ON c."CompanyID" = l."CompanyID"
        WHERE c."IsActive" = true AND ($1 = 0 OR l."CompanyID" = $1)
        ORDER BY l."GroupCategory"
      `,
      [companyId]
    ),
  ]);

  return {
    total: Number(count.rows[0].Total),
    page: Math.floor(offset / size) + 1,
    pageSize: size,
    groups: groups.rows.map((row) => row.Name).filter(Boolean),
    items: rows.rows.map((row) => ({
      id: row.LedgerID,
      companyId: String(row.CompanyID),
      companyName: row.CompanyName,
      name: row.LedgerName,
      group: row.GroupCategory,
      balance: toNumber(row.CurrentBalance),
    })),
  };
}

async function listVouchers({
  company = 'all',
  q = '',
  type = '',
  from = '',
  to = '',
  page = 1,
  pageSize = 25,
} = {}) {
  const companyId = companyFilter(company);
  const { size, offset } = paging(page, pageSize);
  const search = String(q || '').trim();
  const voucherType = String(type || '').trim();
  const fromDate = optionalDate(from);
  const toDate = optionalDate(to);

  const where = `
    c."IsActive" = true
    AND ($1 = 0 OR v."CompanyID" = $1)
    AND ($2 = '' OR v."VoucherType" = $2)
    AND ($4::date IS NULL OR v."VoucherDate" >= $4::date)
    AND ($5::date IS NULL OR v."VoucherDate" <= $5::date)
    AND (
      $3 = ''
      OR v."Narration" ILIKE '%' || $3 || '%'
      OR v."VoucherType" ILIKE '%' || $3 || '%'
      OR c."CompanyName" ILIKE '%' || $3 || '%'
      OR COALESCE(v."PartyLedgerName", '') ILIKE '%' || $3 || '%'
      OR COALESCE(v."VoucherNumber", '') ILIKE '%' || $3 || '%'
      OR COALESCE(p."ProjectName", '') ILIKE '%' || $3 || '%'
    )
  `;

  const params = [companyId, voucherType, search, fromDate, toDate];

  const [count, rows, types] = await Promise.all([
    db.query(
      `
        SELECT COUNT(*) AS "Total"
        FROM "Vouchers" v
        INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
        LEFT JOIN "Projects" p ON p."ProjectID" = v."ProjectID"
        WHERE ${where}
      `,
      params
    ),
    db.query(
      `
        SELECT
          v."VoucherID", v."CompanyID", c."CompanyName", v."VoucherDate", v."VoucherType",
          v."Amount", v."Narration", v."ProjectID", p."ProjectName", v."VoucherNumber", v."PartyLedgerName"
        FROM "Vouchers" v
        INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
        LEFT JOIN "Projects" p ON p."ProjectID" = v."ProjectID"
        WHERE ${where}
        ORDER BY v."VoucherDate" DESC, v."VoucherID" DESC
        LIMIT $6 OFFSET $7
      `,
      [...params, size, offset]
    ),
    db.query(
      `
        SELECT DISTINCT v."VoucherType" AS "Name"
        FROM "Vouchers" v
        INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
        WHERE c."IsActive" = true AND ($1 = 0 OR v."CompanyID" = $1)
        ORDER BY v."VoucherType"
      `,
      [companyId]
    ),
  ]);

  return {
    total: Number(count.rows[0].Total),
    page: Math.floor(offset / size) + 1,
    pageSize: size,
    types: types.rows.map((row) => row.Name).filter(Boolean),
    items: rows.rows.map((row) => ({
      id: row.VoucherID,
      companyId: String(row.CompanyID),
      companyName: row.CompanyName,
      date: row.VoucherDate,
      type: row.VoucherType,
      number: row.VoucherNumber,
      party: row.PartyLedgerName,
      project: row.ProjectName,
      amount: toNumber(row.Amount),
      narration: row.Narration,
    })),
  };
}

module.exports = {
  listLedgers,
  listVouchers,
};
