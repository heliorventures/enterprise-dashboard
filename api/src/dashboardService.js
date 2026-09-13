const db = require('./db');
const { companyFilter } = require('./filters');
const { fundsOnHand, groupHistory, money, monthLabel, summarizeFunds } = require('./funds');

function toNumber(value) {
  return Number(value) || 0;
}

function projectStatus(project) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = project.EndDate ? new Date(project.EndDate) : null;
  const budget = toNumber(project.BudgetedExpense);
  const actual = toNumber(project.ActualSpend);
  const overrun = budget > 0 && actual > budget * 0.9;

  if (end && end < today) {
    return 'delayed';
  }
  if (overrun) {
    return 'at-risk';
  }
  return 'on-track';
}

function projectProgress(project) {
  const budget = toNumber(project.BudgetedExpense);
  const actual = toNumber(project.ActualSpend);
  if (budget <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((actual / budget) * 100));
}

async function getCompanies() {
  const result = await db.query(`
    SELECT "CompanyID", "CompanyName", "TallyGUID", "IsActive"
    FROM "Companies"
    WHERE "IsActive" = true
    ORDER BY "CompanyName"
  `);
  return result.rows;
}

async function companyFinancials(companyId) {
  const result = await db.query(
    `
      SELECT
        c."CompanyID",
        c."CompanyName",
        COUNT(l."LedgerID") AS "LedgerCount",
        (SELECT COUNT(*) FROM "Vouchers" v WHERE v."CompanyID" = c."CompanyID") AS "VoucherCount",
        SUM(CASE WHEN COALESCE(f.root_group,l."GroupCategory") ILIKE '%Sales%'
          OR COALESCE(f.root_group,l."GroupCategory") ILIKE 'Indirect Income%'
          OR COALESCE(f.root_group,l."GroupCategory") ILIKE 'Direct Income%'
          THEN l."CurrentBalance" ELSE 0 END) AS "Revenue",
        SUM(CASE WHEN lower(f.root_group) IN ('purchase accounts','direct expenses','indirect expenses') OR (f.root_group IS NULL AND (l."GroupCategory" ILIKE '%Purchase%' OR l."GroupCategory" ILIKE '%Expense%')) THEN l."CurrentBalance" ELSE 0 END) AS "Expenses",
        SUM(CASE WHEN COALESCE(f.root_group,l."GroupCategory") ILIKE '%Debtor%' THEN l."CurrentBalance" ELSE 0 END) AS "Receivables",
        SUM(CASE WHEN COALESCE(f.root_group,l."GroupCategory") ILIKE '%Creditor%' THEN l."CurrentBalance" ELSE 0 END) AS "Payables",
        SUM(CASE WHEN COALESCE(f.root_group,l."GroupCategory") ILIKE '%Bank%' THEN l."CurrentBalance" ELSE 0 END) AS "Bank",
        SUM(CASE WHEN COALESCE(f.root_group,l."GroupCategory") ILIKE '%Cash%' THEN l."CurrentBalance" ELSE 0 END) AS "Cash"
      FROM "Companies" c
      LEFT JOIN "Ledgers" l ON l."CompanyID" = c."CompanyID"
      LEFT JOIN finance_ledger_facts f ON f.company_id=l."CompanyID" AND f.name=l."LedgerName"
      WHERE c."IsActive" = true
        AND ($1 = 0 OR c."CompanyID" = $1)
      GROUP BY c."CompanyID", c."CompanyName"
      ORDER BY c."CompanyName"
    `,
    [Number(companyId) || 0]
  );
  return result.rows;
}

async function projectRows(companyId) {
  const result = await db.query(
    `
      SELECT
        p."ProjectID",
        p."CompanyID",
        c."CompanyName",
        p."ProjectName",
        p."BudgetedExpense",
        p."TargetRevenue",
        p."StartDate",
        p."EndDate",
        p."SourceKey",
        COUNT(v."VoucherID")::int AS "VoucherCount",
        COALESCE(SUM(CASE WHEN COALESCE(vt.resolved_root,v."VoucherType") ~* '(payment|purchase|debit[[:space:]]*note)' THEN ABS(v."Amount") ELSE 0 END), 0) AS "Invested",
        COALESCE(SUM(CASE WHEN COALESCE(vt.resolved_root,v."VoucherType") ~* '(receipt|sales|credit[[:space:]]*note)' THEN ABS(v."Amount") ELSE 0 END), 0) AS "Earned",
        COALESCE(SUM(CASE WHEN COALESCE(vt.resolved_root,v."VoucherType") IN ('Payment', 'Purchase') THEN v."Amount" ELSE 0 END), 0) AS "ActualSpend"
      FROM "Projects" p
      INNER JOIN "Companies" c ON c."CompanyID" = p."CompanyID"
      LEFT JOIN "Vouchers" v ON v."ProjectID" = p."ProjectID" AND v."CompanyID" = p."CompanyID"
      LEFT JOIN voucher_types vt ON vt.company_id=v."CompanyID" AND vt.name=v."VoucherType"
      WHERE c."IsActive" = true
        AND ($1 = 0 OR p."CompanyID" = $1)
      GROUP BY p."ProjectID", p."CompanyID", c."CompanyName", p."ProjectName", p."BudgetedExpense",
               p."TargetRevenue", p."StartDate", p."EndDate", p."SourceKey"
      ORDER BY c."CompanyName", p."ProjectName"
    `,
    [Number(companyId) || 0]
  );
  return result.rows;
}

async function lastSync() {
  const result = await db.query(`
    SELECT "Source", "Status", "Message", "SyncedAt"
    FROM "SyncLog"
    ORDER BY "SyncedAt" DESC, "SyncID" DESC LIMIT 1
  `);
  return result.rows[0] || null;
}

async function bookCounts(companyId) {
  const [ledgers, vouchers, groups] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS count FROM "Ledgers" l
       INNER JOIN "Companies" c ON c."CompanyID" = l."CompanyID"
       WHERE c."IsActive" = true AND ($1 = 0 OR l."CompanyID" = $1)`,
      [Number(companyId) || 0]
    ),
    db.query(
      `SELECT COUNT(*)::int AS count FROM "Vouchers" v
       INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
       WHERE c."IsActive" = true AND ($1 = 0 OR v."CompanyID" = $1)`,
      [Number(companyId) || 0]
    ),
    db.query(
      `SELECT l."GroupCategory" AS name, COUNT(*)::int AS count, COALESCE(SUM(l."CurrentBalance"), 0) AS balance
       FROM "Ledgers" l
       INNER JOIN "Companies" c ON c."CompanyID" = l."CompanyID"
       WHERE c."IsActive" = true AND ($1 = 0 OR l."CompanyID" = $1)
       GROUP BY l."GroupCategory"
       ORDER BY ABS(COALESCE(SUM(l."CurrentBalance"), 0)) DESC, l."GroupCategory"`,
      [Number(companyId) || 0]
    ),
  ]);
  return {
    ledgerCount: ledgers.rows[0].count,
    voucherCount: vouchers.rows[0].count,
    groups: groups.rows.map((row) => ({
      name: row.name,
      count: row.count,
      balance: toNumber(row.balance),
    })),
  };
}

function mapFinance(row) {
  const revenue = fundsOnHand(row.Revenue);
  const expenses = fundsOnHand(row.Expenses);
  const bank = fundsOnHand(row.Bank);
  const cash = fundsOnHand(row.Cash);
  return {
    id: String(row.CompanyID),
    name: row.CompanyName,
    revenue,
    expenses,
    profit: revenue - expenses,
    receivables: money(-toNumber(row.Receivables)),
    payables: money(toNumber(row.Payables)),
    bank,
    cash,
    cashAndBank: bank + cash,
    ledgerCount: toNumber(row.LedgerCount),
    voucherCount: toNumber(row.VoucherCount),
    source: 'sql',
  };
}

async function monthlyActivity(companyId) {
  const result = await db.query(
    `
      SELECT
        v."CompanyID"::text AS "companyId",
        to_char(date_trunc('month', v."VoucherDate"), 'YYYY-MM') AS key,
        COALESCE(SUM(CASE WHEN COALESCE(vt.resolved_root,v."VoucherType") ~* '(payment|purchase|debit[[:space:]]*note)' THEN ABS(v."Amount") ELSE 0 END), 0) AS expenses,
        COALESCE(SUM(CASE WHEN COALESCE(vt.resolved_root,v."VoucherType") ~* '(receipt|sales|credit[[:space:]]*note)' THEN ABS(v."Amount") ELSE 0 END), 0) AS inflow,
        COUNT(*) FILTER (WHERE COALESCE(vt.resolved_root,v."VoucherType") ~* '(payment|purchase|debit[[:space:]]*note)')::int AS "expenseCount",
        COUNT(*)::int AS "voucherCount"
      FROM "Vouchers" v
      INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
      LEFT JOIN voucher_types vt ON vt.company_id=v."CompanyID" AND vt.name=v."VoucherType"
      WHERE c."IsActive" = true
        AND ($1 = 0 OR v."CompanyID" = $1)
        AND v."VoucherDate" >= (date_trunc('month', CURRENT_DATE) - INTERVAL '11 months')::date
      GROUP BY v."CompanyID", 2
      ORDER BY 2, v."CompanyID"
    `,
    [Number(companyId) || 0]
  );
  return result.rows.map((row) => ({
    companyId: String(row.companyId),
    key: row.key,
    label: monthLabel(row.key),
    expenses: toNumber(row.expenses),
    inflow: toNumber(row.inflow),
    expenseCount: toNumber(row.expenseCount),
    voucherCount: toNumber(row.voucherCount),
  }));
}

async function bankAccounts(companyId) {
  const result = await db.query(
    `
      SELECT c."CompanyID", c."CompanyName", l."LedgerName", l."GroupCategory", l."CurrentBalance", COALESCE(f.root_group,l."GroupCategory") AS "RootGroup"
      FROM "Ledgers" l
      INNER JOIN "Companies" c ON c."CompanyID" = l."CompanyID"
      LEFT JOIN finance_ledger_facts f ON f.company_id=l."CompanyID" AND f.name=l."LedgerName"
      WHERE c."IsActive" = true
        AND ($1 = 0 OR l."CompanyID" = $1)
        AND (COALESCE(f.root_group,l."GroupCategory") ILIKE '%Bank%' OR COALESCE(f.root_group,l."GroupCategory") ILIKE '%Cash%')
      ORDER BY ABS(l."CurrentBalance") DESC, c."CompanyName", l."LedgerName"
    `,
    [Number(companyId) || 0]
  );
  return result.rows.map((row) => ({
    companyId: String(row.CompanyID),
    companyName: row.CompanyName,
    name: row.LedgerName,
    group: row.GroupCategory,
    available: fundsOnHand(row.CurrentBalance),
    // Preserve evidence for reconciliation; do not infer a universal debit/credit
    // convention from mixed signed-numeric and Dr/Cr-tagged source formats.
    rawBalance: toNumber(row.CurrentBalance),
    kind: /bank/i.test(row.RootGroup || row.GroupCategory) ? 'bank' : 'cash',
  }));
}

async function getDashboard(companyCode = 'all') {
  const companyId = companyFilter(companyCode);
  const [companies, financialRows, projects, sync, books, activity, accounts] = await Promise.all([
    getCompanies(),
    companyFinancials(companyId),
    projectRows(companyId),
    lastSync(),
    bookCounts(companyId),
    monthlyActivity(companyId),
    bankAccounts(companyId),
  ]);
  const tallyStatus = {
    connected: Boolean(sync),
    mode: 'archive',
    url: '',
    companies: [],
    message: 'Books are updated from dumped Tally source records, not a live Tally connection',
  };

  const companyCards = financialRows.map(mapFinance);
  const groupedActivity = groupHistory(activity);
  const workItems = projects.filter((project) => toNumber(project.VoucherCount) > 0 || !project.SourceKey).map((project) => {
    const status = projectStatus(project);
    return {
      id: project.ProjectID,
      companyId: String(project.CompanyID),
      companyName: project.CompanyName,
      name: project.ProjectName,
      status,
      progress: projectProgress(project),
      owner: '',
      dueDate: project.EndDate,
      source: project.SourceKey ? 'tally' : 'sql',
      budget: toNumber(project.BudgetedExpense),
      actual: toNumber(project.ActualSpend),
      target: toNumber(project.TargetRevenue),
      voucherCount: toNumber(project.VoucherCount),
      invested: toNumber(project.Invested),
      earned: toNumber(project.Earned),
      net: money(toNumber(project.Earned) - toNumber(project.Invested)),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    tally: tallyStatus,
    lastSync: sync,
    selectedCompany: companyCode,
    companies: companies.map((row) => ({
      id: String(row.CompanyID),
      name: row.CompanyName,
      workAdapter: 'sql',
    })),
    kpis: {
      revenue: companyCards.reduce((sum, row) => sum + row.revenue, 0),
      expenses: companyCards.reduce((sum, row) => sum + row.expenses, 0),
      profit: companyCards.reduce((sum, row) => sum + row.profit, 0),
      receivables: companyCards.reduce((sum, row) => sum + row.receivables, 0),
      payables: companyCards.reduce((sum, row) => sum + row.payables, 0),
      cash: companyCards.reduce((sum, row) => sum + row.cashAndBank, 0),
      bank: companyCards.reduce((sum, row) => sum + row.bank, 0),
    },
    funds: summarizeFunds({
      bank: companyCards.reduce((sum, row) => sum + row.bank, 0),
      cash: companyCards.reduce((sum, row) => sum + row.cash, 0),
      receivables: companyCards.reduce((sum, row) => sum + row.receivables, 0),
      payables: companyCards.reduce((sum, row) => sum + row.payables, 0),
      ledgerExpense: companyCards.reduce((sum, row) => sum + row.expenses, 0),
      ledgerIncome: companyCards.reduce((sum, row) => sum + row.revenue, 0),
      history: groupedActivity.months,
      histories: groupedActivity.byCompany,
      accounts,
      companies: companyCards.map((row) => ({
        id: row.id,
        name: row.name,
        bank: row.bank,
        cash: row.cash,
        cashAndBank: row.cashAndBank,
        receivables: row.receivables,
        payables: row.payables,
        expenses: row.expenses,
        revenue: row.revenue,
        uncommitted: row.cashAndBank - row.payables,
      })),
    }),
    companyFinancials: companyCards,
    books,
    work: {
      totals: {
        total: workItems.length,
        onTrack: workItems.filter((item) => item.status === 'on-track').length,
        delayed: workItems.filter((item) => item.status === 'delayed').length,
        atRisk: workItems.filter((item) => item.status === 'at-risk').length,
        completed: workItems.filter((item) => item.status === 'completed').length,
        voucherCount: workItems.reduce((sum, item) => sum + item.voucherCount, 0),
        invested: money(workItems.reduce((sum, item) => sum + item.invested, 0)),
        earned: money(workItems.reduce((sum, item) => sum + item.earned, 0)),
        net: money(workItems.reduce((sum, item) => sum + item.net, 0)),
      },
      items: workItems,
    },
  };
}

module.exports = {
  getDashboard: company => { companyFilter(company); return db.readSnapshot(() => getDashboard(company)); },
  getCompanies,
};
