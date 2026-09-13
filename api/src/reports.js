const db = require('./db');
const { companyFilter } = require('./filters');
const { fundsOnHand, lastCompleteMonthKey, monthLabel, money } = require('./funds');

function isExpenseGroup(name) {
  const group = String(name || '');
  if (/(payable|provision|creditor|advance from)/i.test(group)) return false;
  return /expense|purchase account/i.test(group);
}

function toNumber(value) {
  return Number(value) || 0;
}

function nestExpenses(rows) {
  const companies = [];
  const index = new Map();
  for (const row of rows) {
    if (!isExpenseGroup(row.RootGroup || row.GroupCategory)) continue;
    const id = String(row.CompanyID);
    if (!index.has(id)) {
      const company = { id, name: row.CompanyName, total: 0, ledgerCount: 0, groups: [] };
      index.set(id, company);
      companies.push(company);
    }
    const company = index.get(id);
    let group = company.groups.find((item) => item.name === row.GroupCategory);
    if (!group) {
      group = { name: row.GroupCategory, total: 0, ledgerCount: 0, ledgers: [] };
      company.groups.push(group);
    }
    const balance = fundsOnHand(row.CurrentBalance);
    const ledger = {
      id: row.LedgerID,
      name: row.LedgerName,
      group: row.GroupCategory,
      companyId: id,
      companyName: row.CompanyName,
      balance,
    };
    group.ledgers.push(ledger);
    group.total = money(group.total + balance);
    group.ledgerCount += 1;
    company.total = money(company.total + balance);
    company.ledgerCount += 1;
  }
  for (const company of companies) {
    company.groups.sort((left, right) => Math.abs(right.total) - Math.abs(left.total) || left.name.localeCompare(right.name));
    for (const group of company.groups) {
      group.ledgers.sort((left, right) => Math.abs(right.balance) - Math.abs(left.balance) || left.name.localeCompare(right.name));
    }
  }
  companies.sort((left, right) => Math.abs(right.total) - Math.abs(left.total) || left.name.localeCompare(right.name));
  return companies;
}

function summarizeProject(row) {
  const invested = money(row.invested ?? row.Invested);
  const earned = money(row.earned ?? row.Earned);
  return {
    id: String(row.ProjectID ?? row.id),
    companyId: String(row.CompanyID ?? row.companyId),
    companyName: row.CompanyName || row.companyName,
    name: row.ProjectName || row.name,
    voucherCount: toNumber(row.voucherCount ?? row.VoucherCount),
    withAmount: toNumber(row.withAmount ?? row.WithAmount),
    invested,
    earned,
    net: money(earned - invested),
  };
}

function nestProjects(rows) {
  const companies = [];
  const index = new Map();
  for (const row of rows) {
    const project = summarizeProject(row);
    if (!index.has(project.companyId)) {
      const company = {
        id: project.companyId,
        name: project.companyName,
        voucherCount: 0,
        invested: 0,
        earned: 0,
        net: 0,
        projects: [],
      };
      index.set(project.companyId, company);
      companies.push(company);
    }
    const company = index.get(project.companyId);
    company.projects.push(project);
    company.voucherCount += project.voucherCount;
    company.invested = money(company.invested + project.invested);
    company.earned = money(company.earned + project.earned);
    company.net = money(company.earned - company.invested);
  }
  companies.sort((left, right) => Math.abs(right.net) - Math.abs(left.net) || left.name.localeCompare(right.name));
  for (const company of companies) {
    company.projects.sort((left, right) => Math.abs(right.net) - Math.abs(left.net) || left.name.localeCompare(right.name));
  }
  return companies;
}

async function expenseReport({ company = 'all' } = {}) {
  const companyId = companyFilter(company);
  const lastKey = lastCompleteMonthKey();
  const lastStart = `${lastKey}-01`;
  const [ledgers, payments] = await Promise.all([
    db.query(
      `
        SELECT c."CompanyID", c."CompanyName", l."LedgerID", l."LedgerName", l."GroupCategory", l."CurrentBalance", COALESCE(f.root_group,l."GroupCategory") AS "RootGroup"
        FROM "Ledgers" l
        INNER JOIN "Companies" c ON c."CompanyID" = l."CompanyID"
        LEFT JOIN finance_ledger_facts f ON f.company_id=l."CompanyID" AND f.name=l."LedgerName"
        WHERE c."IsActive" = true
          AND ($1 = 0 OR l."CompanyID" = $1)
          AND (COALESCE(f.root_group,l."GroupCategory") ILIKE '%Expense%' OR COALESCE(f.root_group,l."GroupCategory") ILIKE '%Purchase Account%')
          AND COALESCE(f.root_group,l."GroupCategory") NOT ILIKE '%Payable%'
          AND COALESCE(f.root_group,l."GroupCategory") NOT ILIKE '%Provision%'
          AND COALESCE(f.root_group,l."GroupCategory") NOT ILIKE '%Creditor%'
        ORDER BY c."CompanyName", l."GroupCategory", l."LedgerName"
      `,
      [companyId]
    ),
    db.query(
      `
        SELECT
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE v."Amount" <> 0)::int AS "withAmount",
          COALESCE(SUM(ABS(v."Amount")), 0) AS amount
        FROM "Vouchers" v
        INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
        LEFT JOIN voucher_types vt ON vt.company_id=v."CompanyID" AND vt.name=v."VoucherType"
        WHERE c."IsActive" = true
          AND ($1 = 0 OR v."CompanyID" = $1)
          AND COALESCE(vt.resolved_root,v."VoucherType") ~* '(payment|purchase|debit[[:space:]]*note)'
          AND v."VoucherDate" >= $2::date
          AND v."VoucherDate" < ($2::date + INTERVAL '1 month')
      `,
      [companyId, lastStart]
    ),
  ]);

  const companies = nestExpenses(ledgers.rows);
  return {
    lastMonth: {
      key: lastKey,
      label: monthLabel(lastKey),
      from: lastStart,
      count: toNumber(payments.rows[0].count),
      withAmount: toNumber(payments.rows[0].withAmount),
      amount: money(payments.rows[0].amount),
    },
    total: money(companies.reduce((sum, row) => sum + row.total, 0)),
    ledgerCount: companies.reduce((sum, row) => sum + row.ledgerCount, 0),
    companies,
  };
}

async function projectReport({ company = 'all' } = {}) {
  const companyId = companyFilter(company);
  const result = await db.query(
    `
      SELECT
        c."CompanyID",
        c."CompanyName",
        p."ProjectID",
        p."ProjectName",
        COUNT(v."VoucherID")::int AS "voucherCount",
        COUNT(v."VoucherID") FILTER (WHERE v."Amount" <> 0)::int AS "withAmount",
        COALESCE(SUM(CASE WHEN COALESCE(vt.resolved_root,v."VoucherType") ~* '(payment|purchase|debit[[:space:]]*note)' THEN ABS(v."Amount") ELSE 0 END), 0) AS invested,
        COALESCE(SUM(CASE WHEN COALESCE(vt.resolved_root,v."VoucherType") ~* '(receipt|sales|credit[[:space:]]*note)' THEN ABS(v."Amount") ELSE 0 END), 0) AS earned
      FROM "Projects" p
      INNER JOIN "Companies" c ON c."CompanyID" = p."CompanyID"
      INNER JOIN "Vouchers" v ON v."ProjectID" = p."ProjectID" AND v."CompanyID" = p."CompanyID"
      LEFT JOIN voucher_types vt ON vt.company_id=v."CompanyID" AND vt.name=v."VoucherType"
      WHERE c."IsActive" = true
        AND ($1 = 0 OR p."CompanyID" = $1)
      GROUP BY c."CompanyID", c."CompanyName", p."ProjectID", p."ProjectName"
      ORDER BY c."CompanyName", p."ProjectName"
    `,
    [companyId]
  );
  const companies = nestProjects(result.rows);
  const invested = money(companies.reduce((sum, row) => sum + row.invested, 0));
  const earned = money(companies.reduce((sum, row) => sum + row.earned, 0));
  return {
    linkedVoucherCount: companies.reduce((sum, row) => sum + row.voucherCount, 0),
    projectCount: companies.reduce((sum, row) => sum + row.projects.length, 0),
    invested,
    earned,
    net: money(earned - invested),
    companies,
  };
}

module.exports = {
  isExpenseGroup,
  nestExpenses,
  nestProjects,
  expenseReport: (query = {}) => { companyFilter(query.company); return db.readSnapshot(() => expenseReport(query)); },
  projectReport: (query = {}) => { companyFilter(query.company); return db.readSnapshot(() => projectReport(query)); },
};
