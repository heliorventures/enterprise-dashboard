const db = require('./db');
const tally = require('./tally');
const { syncFromTally } = require('./sync');

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
    SELECT CompanyID, CompanyName, TallyGUID, IsActive
    FROM dbo.Companies
    WHERE IsActive = 1
    ORDER BY CompanyName
  `);
  return result.recordset;
}

async function companyFinancials(companyId) {
  const result = await db.query(
    `
      SELECT
        c.CompanyID,
        c.CompanyName,
        SUM(CASE WHEN l.GroupCategory LIKE '%Sales%' THEN l.CurrentBalance ELSE 0 END) AS Revenue,
        SUM(CASE WHEN l.GroupCategory LIKE '%Purchase%' OR l.GroupCategory LIKE '%Expense%' THEN l.CurrentBalance ELSE 0 END) AS Expenses,
        SUM(CASE WHEN l.GroupCategory LIKE '%Debtor%' THEN l.CurrentBalance ELSE 0 END) AS Receivables,
        SUM(CASE WHEN l.GroupCategory LIKE '%Creditor%' THEN l.CurrentBalance ELSE 0 END) AS Payables,
        SUM(CASE WHEN l.GroupCategory LIKE '%Bank%' OR l.GroupCategory LIKE '%Cash%' THEN l.CurrentBalance ELSE 0 END) AS Cash
      FROM dbo.Companies c
      LEFT JOIN dbo.Ledgers l ON l.CompanyID = c.CompanyID
      WHERE c.IsActive = 1
        AND (@companyId = 0 OR c.CompanyID = @companyId)
      GROUP BY c.CompanyID, c.CompanyName
      ORDER BY c.CompanyName
    `,
    { companyId: Number(companyId) || 0 }
  );
  return result.recordset;
}

async function projectRows(companyId) {
  const result = await db.query(
    `
      SELECT
        p.ProjectID,
        p.CompanyID,
        c.CompanyName,
        p.ProjectName,
        p.BudgetedExpense,
        p.TargetRevenue,
        p.StartDate,
        p.EndDate,
        ISNULL((
          SELECT SUM(v.Amount)
          FROM dbo.Vouchers v
          WHERE v.ProjectID = p.ProjectID
            AND v.VoucherType IN ('Payment', 'Purchase')
        ), 0) AS ActualSpend
      FROM dbo.Projects p
      INNER JOIN dbo.Companies c ON c.CompanyID = p.CompanyID
      WHERE c.IsActive = 1
        AND (@companyId = 0 OR p.CompanyID = @companyId)
      ORDER BY p.EndDate
    `,
    { companyId: Number(companyId) || 0 }
  );
  return result.recordset;
}

async function lastSync() {
  const result = await db.query(`
    SELECT TOP 1 Source, Status, Message, SyncedAt
    FROM dbo.SyncLog
    ORDER BY SyncedAt DESC
  `);
  return result.recordset[0] || null;
}

function mapFinance(row) {
  const revenue = toNumber(row.Revenue);
  const expenses = toNumber(row.Expenses);
  return {
    id: String(row.CompanyID),
    name: row.CompanyName,
    revenue,
    expenses,
    profit: revenue - expenses,
    receivables: toNumber(row.Receivables),
    payables: toNumber(row.Payables),
    cash: toNumber(row.Cash),
    source: 'sql',
  };
}

async function getDashboard(companyCode = 'all') {
  const companyId = companyCode === 'all' ? 0 : Number(companyCode);
  const [tallyStatus, companies, financialRows, projects, sync] = await Promise.all([
    tally.ping(),
    getCompanies(),
    companyFinancials(companyId),
    projectRows(companyId),
    lastSync(),
  ]);

  const companyCards = financialRows.map(mapFinance);
  const workItems = projects.map((project) => {
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
      source: 'sql',
      budget: toNumber(project.BudgetedExpense),
      actual: toNumber(project.ActualSpend),
      target: toNumber(project.TargetRevenue),
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
      cash: companyCards.reduce((sum, row) => sum + row.cash, 0),
    },
    companyFinancials: companyCards,
    work: {
      totals: {
        total: workItems.length,
        onTrack: workItems.filter((item) => item.status === 'on-track').length,
        delayed: workItems.filter((item) => item.status === 'delayed').length,
        atRisk: workItems.filter((item) => item.status === 'at-risk').length,
        completed: workItems.filter((item) => item.status === 'completed').length,
      },
      items: workItems,
    },
  };
}

module.exports = {
  getDashboard,
  getCompanies,
  syncFromTally,
};
