const db = require('./db');

function toNumber(value) {
  return Number(value) || 0;
}

function companyFilter(company) {
  return company && company !== 'all' ? Number(company) : 0;
}

function paging(page, pageSize, fallback = 25) {
  const size = Math.min(Math.max(Number(pageSize) || fallback, 1), 5000);
  const current = Math.max(Number(page) || 1, 1);
  return { size, current, offset: (current - 1) * size };
}

function optionalDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

async function listLedgers({ company = 'all', q = '', group = '', page = 1, pageSize = 25 } = {}) {
  const companyId = companyFilter(company);
  const { size, offset } = paging(page, pageSize);
  const search = String(q || '').trim();
  const groupName = String(group || '').trim();

  const where = `
    c.IsActive = 1
    AND (@companyId = 0 OR l.CompanyID = @companyId)
    AND (@group = '' OR l.GroupCategory = @group)
    AND (
      @q = ''
      OR l.LedgerName LIKE '%' + @q + '%'
      OR l.GroupCategory LIKE '%' + @q + '%'
      OR c.CompanyName LIKE '%' + @q + '%'
    )
  `;

  const [count, rows, groups] = await Promise.all([
    db.query(
      `
        SELECT COUNT(*) AS Total
        FROM dbo.Ledgers l
        INNER JOIN dbo.Companies c ON c.CompanyID = l.CompanyID
        WHERE ${where}
      `,
      { companyId, q: search, group: groupName }
    ),
    db.query(
      `
        SELECT
          l.LedgerID, l.CompanyID, c.CompanyName, l.LedgerName, l.GroupCategory, l.CurrentBalance
        FROM dbo.Ledgers l
        INNER JOIN dbo.Companies c ON c.CompanyID = l.CompanyID
        WHERE ${where}
        ORDER BY c.CompanyName, l.GroupCategory, l.LedgerName
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `,
      { companyId, q: search, group: groupName, offset, pageSize: size }
    ),
    db.query(
      `
        SELECT DISTINCT l.GroupCategory AS Name
        FROM dbo.Ledgers l
        INNER JOIN dbo.Companies c ON c.CompanyID = l.CompanyID
        WHERE c.IsActive = 1 AND (@companyId = 0 OR l.CompanyID = @companyId)
        ORDER BY l.GroupCategory
      `,
      { companyId }
    ),
  ]);

  return {
    total: count.recordset[0].Total,
    page: Math.floor(offset / size) + 1,
    pageSize: size,
    groups: groups.recordset.map((row) => row.Name).filter(Boolean),
    items: rows.recordset.map((row) => ({
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
    c.IsActive = 1
    AND (@companyId = 0 OR v.CompanyID = @companyId)
    AND (@type = '' OR v.VoucherType = @type)
    AND (@fromDate IS NULL OR v.VoucherDate >= @fromDate)
    AND (@toDate IS NULL OR v.VoucherDate <= @toDate)
    AND (
      @q = ''
      OR v.Narration LIKE '%' + @q + '%'
      OR v.VoucherType LIKE '%' + @q + '%'
      OR c.CompanyName LIKE '%' + @q + '%'
      OR ISNULL(v.PartyLedgerName, '') LIKE '%' + @q + '%'
      OR ISNULL(v.VoucherNumber, '') LIKE '%' + @q + '%'
      OR ISNULL(p.ProjectName, '') LIKE '%' + @q + '%'
    )
  `;

  const params = { companyId, q: search, type: voucherType, fromDate, toDate };

  const [count, rows, types] = await Promise.all([
    db.query(
      `
        SELECT COUNT(*) AS Total
        FROM dbo.Vouchers v
        INNER JOIN dbo.Companies c ON c.CompanyID = v.CompanyID
        LEFT JOIN dbo.Projects p ON p.ProjectID = v.ProjectID
        WHERE ${where}
      `,
      params
    ),
    db.query(
      `
        SELECT
          v.VoucherID, v.CompanyID, c.CompanyName, v.VoucherDate, v.VoucherType,
          v.Amount, v.Narration, v.ProjectID, p.ProjectName, v.VoucherNumber, v.PartyLedgerName
        FROM dbo.Vouchers v
        INNER JOIN dbo.Companies c ON c.CompanyID = v.CompanyID
        LEFT JOIN dbo.Projects p ON p.ProjectID = v.ProjectID
        WHERE ${where}
        ORDER BY v.VoucherDate DESC, v.VoucherID DESC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `,
      { ...params, offset, pageSize: size }
    ),
    db.query(
      `
        SELECT DISTINCT v.VoucherType AS Name
        FROM dbo.Vouchers v
        INNER JOIN dbo.Companies c ON c.CompanyID = v.CompanyID
        WHERE c.IsActive = 1 AND (@companyId = 0 OR v.CompanyID = @companyId)
        ORDER BY v.VoucherType
      `,
      { companyId }
    ),
  ]);

  return {
    total: count.recordset[0].Total,
    page: Math.floor(offset / size) + 1,
    pageSize: size,
    types: types.recordset.map((row) => row.Name).filter(Boolean),
    items: rows.recordset.map((row) => ({
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
