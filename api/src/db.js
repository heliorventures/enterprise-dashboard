const sql = require('mssql');
const config = require('./config');

const poolConfig = {
  user: config.db.user,
  password: config.db.password,
  server: config.db.host,
  database: config.db.database,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    ...(config.db.instanceName ? { instanceName: config.db.instanceName } : {}),
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool;

async function ensureSyncLog(connection) {
  await connection.request().query(`
    IF OBJECT_ID('dbo.SyncLog', 'U') IS NULL
    CREATE TABLE dbo.SyncLog (
      SyncID INT IDENTITY(1,1) PRIMARY KEY,
      Source NVARCHAR(40) NOT NULL,
      Status NVARCHAR(20) NOT NULL,
      Message NVARCHAR(1000) NULL,
      SyncedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
  `);
}

async function ensureBooksColumns(connection) {
  await connection.request().query(`
    IF COL_LENGTH('dbo.Vouchers', 'VoucherNumber') IS NULL
      ALTER TABLE dbo.Vouchers ADD VoucherNumber NVARCHAR(80) NULL;

    IF COL_LENGTH('dbo.Vouchers', 'PartyLedgerName') IS NULL
      ALTER TABLE dbo.Vouchers ADD PartyLedgerName NVARCHAR(200) NULL;
  `);

  await connection.request().query(`
    IF EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.Vouchers')
        AND name = 'ProjectID'
        AND is_nullable = 0
    )
    ALTER TABLE dbo.Vouchers ALTER COLUMN ProjectID INT NULL;
  `);
}

async function seedDayBookIfThin(connection) {
  const count = await connection.request().query('SELECT COUNT(*) AS Total FROM dbo.Vouchers');
  if (count.recordset[0].Total >= 40) {
    return;
  }

  const extraLedgers = [
    ['GST Input', 'Duties & Taxes', 186000],
    ['GST Output', 'Duties & Taxes', 274000],
    ['TDS Payable', 'Duties & Taxes', 42000],
    ['HDFC Current A/c', 'Bank Accounts', 0],
    ['Furniture & Fittings', 'Fixed Assets', 980000],
    ['Capital Account', 'Capital Account', 5000000],
    ['Office Rent', 'Indirect Expenses', 0],
    ['Staff Salary', 'Indirect Expenses', 0],
  ];

  const companies = await connection.request().query('SELECT CompanyID FROM dbo.Companies WHERE IsActive = 1');
  for (const company of companies.recordset) {
    for (const [name, group, balance] of extraLedgers) {
      const exists = await connection
        .request()
        .input('companyId', sql.Int, company.CompanyID)
        .input('name', sql.NVarChar(200), name)
        .query('SELECT 1 AS Found FROM dbo.Ledgers WHERE CompanyID = @companyId AND LedgerName = @name');
      if (exists.recordset.length) {
        continue;
      }
      await connection
        .request()
        .input('companyId', sql.Int, company.CompanyID)
        .input('name', sql.NVarChar(200), name)
        .input('group', sql.NVarChar(100), group)
        .input('balance', sql.Decimal(18, 2), balance)
        .query(`
          INSERT INTO dbo.Ledgers (CompanyID, LedgerName, GroupCategory, CurrentBalance)
          VALUES (@companyId, @name, @group, @balance)
        `);
    }
  }

  const types = [
    ['Sales', 'Invoice – domestic supply', 248000, 'Sharma Distributors'],
    ['Sales', 'Invoice – AMC contract', 186500, 'Orbit Hospitals'],
    ['Purchase', 'Raw material bill', 112400, 'Pinnacle Steels'],
    ['Purchase', 'Freight inward', 18600, 'Blue Dart Logistics'],
    ['Receipt', 'Collection against invoice', 175000, 'Sharma Distributors'],
    ['Payment', 'Vendor payment', 98000, 'Pinnacle Steels'],
    ['Payment', 'Salary processed', 420000, 'Staff Salary'],
    ['Journal', 'GST liability booking', 27400, 'GST Output'],
    ['Contra', 'Cash deposited in bank', 50000, 'HDFC Current A/c'],
  ];

  for (const company of companies.recordset) {
    for (let index = 0; index < types.length; index += 1) {
      const [type, narration, amount, party] = types[index];
      const date = new Date();
      date.setDate(date.getDate() - (index + 2) * 3);
      await connection
        .request()
        .input('companyId', sql.Int, company.CompanyID)
        .input('date', sql.Date, date.toISOString().slice(0, 10))
        .input('type', sql.NVarChar(80), type)
        .input('number', sql.NVarChar(80), `${type.slice(0, 3).toUpperCase()}-${company.CompanyID}${100 + index}`)
        .input('party', sql.NVarChar(200), party)
        .input('amount', sql.Decimal(18, 2), amount)
        .input('narration', sql.NVarChar(400), narration)
        .query(`
          INSERT INTO dbo.Vouchers
            (CompanyID, ProjectID, VoucherDate, VoucherType, Amount, Narration, VoucherNumber, PartyLedgerName)
          VALUES
            (@companyId, NULL, @date, @type, @amount, @narration, @number, @party)
        `);
    }
  }
}

async function seedOperationalData(connection) {
  const ledgers = await connection.request().query('SELECT COUNT(*) AS Total FROM dbo.Ledgers');
  if (ledgers.recordset[0].Total > 0) {
    return;
  }

  const finance = [
    [1, [['Sales', 'Sales Accounts', 18450000], ['Purchases', 'Purchase Accounts', 9800000], ['Expenses', 'Indirect Expenses', 3320000], ['Debtors', 'Sundry Debtors', 4200000], ['Creditors', 'Sundry Creditors', 1980000], ['Bank', 'Bank Accounts', 2460000], ['Cash', 'Cash-in-Hand', 300000]]],
    [2, [['Sales', 'Sales Accounts', 22100000], ['Purchases', 'Purchase Accounts', 15100000], ['Expenses', 'Indirect Expenses', 4100000], ['Debtors', 'Sundry Debtors', 6100000], ['Creditors', 'Sundry Creditors', 2750000], ['Bank', 'Bank Accounts', 1880000], ['Cash', 'Cash-in-Hand', 240000]]],
    [3, [['Sales', 'Sales Accounts', 12680000], ['Purchases', 'Purchase Accounts', 7420000], ['Expenses', 'Indirect Expenses', 2730000], ['Debtors', 'Sundry Debtors', 2540000], ['Creditors', 'Sundry Creditors', 2210000], ['Bank', 'Bank Accounts', 1510000], ['Cash', 'Cash-in-Hand', 170000]]],
    [4, [['Sales', 'Sales Accounts', 31240000], ['Purchases', 'Purchase Accounts', 21450000], ['Expenses', 'Indirect Expenses', 5210000], ['Debtors', 'Sundry Debtors', 7340000], ['Creditors', 'Sundry Creditors', 4120000], ['Bank', 'Bank Accounts', 3650000], ['Cash', 'Cash-in-Hand', 410000]]],
    [5, [['Sales', 'Sales Accounts', 9720000], ['Purchases', 'Purchase Accounts', 6110000], ['Expenses', 'Indirect Expenses', 2030000], ['Debtors', 'Sundry Debtors', 1860000], ['Creditors', 'Sundry Creditors', 1420000], ['Bank', 'Bank Accounts', 820000], ['Cash', 'Cash-in-Hand', 120000]]],
    [6, [['Sales', 'Sales Accounts', 15860000], ['Purchases', 'Purchase Accounts', 8940000], ['Expenses', 'Indirect Expenses', 3610000], ['Debtors', 'Sundry Debtors', 2980000], ['Creditors', 'Sundry Creditors', 1870000], ['Bank', 'Bank Accounts', 2140000], ['Cash', 'Cash-in-Hand', 260000]]],
  ];

  for (const [companyId, rows] of finance) {
    for (const [name, group, balance] of rows) {
      await connection
        .request()
        .input('companyId', sql.Int, companyId)
        .input('name', sql.NVarChar(200), name)
        .input('group', sql.NVarChar(100), group)
        .input('balance', sql.Decimal(18, 2), balance)
        .query(`
          INSERT INTO dbo.Ledgers (CompanyID, LedgerName, GroupCategory, CurrentBalance)
          VALUES (@companyId, @name, @group, @balance)
        `);
    }
  }

  const projects = [
    [1, 'Plant expansion – Pune', 4500000, 8200000, -40, 50],
    [1, 'ERP rollout – finance', 1200000, 0, -20, 25],
    [2, 'Highway package 3', 18600000, 24000000, -90, 40],
    [2, 'Site mobilisation – Nashik', 3200000, 4100000, -15, 60],
    [3, 'Warehouse fit-out', 2100000, 2800000, -10, 45],
    [3, 'Distributor onboarding', 650000, 1800000, 5, 70],
    [4, 'Line 2 automation', 7800000, 11500000, -60, 20],
    [5, 'Store refresh – 12 cities', 2400000, 5100000, -5, 35],
    [6, 'Clinic network – phase 2', 5600000, 9400000, -25, 55],
  ];

  for (const [companyId, name, budget, target, startOffset, endOffset] of projects) {
    const start = new Date();
    start.setDate(start.getDate() + startOffset);
    const end = new Date();
    end.setDate(end.getDate() + endOffset);

    const inserted = await connection
      .request()
      .input('companyId', sql.Int, companyId)
      .input('name', sql.NVarChar(200), name)
      .input('budget', sql.Decimal(18, 2), budget)
      .input('target', sql.Decimal(18, 2), target)
      .input('start', sql.Date, start.toISOString().slice(0, 10))
      .input('end', sql.Date, end.toISOString().slice(0, 10))
      .query(`
        INSERT INTO dbo.Projects (CompanyID, ProjectName, BudgetedExpense, TargetRevenue, StartDate, EndDate)
        OUTPUT INSERTED.ProjectID
        VALUES (@companyId, @name, @budget, @target, @start, @end)
      `);

    const projectId = inserted.recordset[0].ProjectID;
    const spend = Math.round(budget * (0.35 + (companyId % 4) * 0.12));
    const voucherDate = new Date();
    voucherDate.setDate(voucherDate.getDate() - 7);

    await connection
      .request()
      .input('companyId', sql.Int, companyId)
      .input('projectId', sql.Int, projectId)
      .input('date', sql.Date, voucherDate.toISOString().slice(0, 10))
      .input('amount', sql.Decimal(18, 2), spend)
      .input('narration', sql.NVarChar(400), `${name} – booked spend`)
      .query(`
        INSERT INTO dbo.Vouchers (CompanyID, ProjectID, VoucherDate, VoucherType, Amount, Narration)
        VALUES (@companyId, @projectId, @date, 'Payment', @amount, @narration)
      `);
  }
}

async function getPool() {
  if (pool) {
    return pool;
  }

  pool = await new sql.ConnectionPool(poolConfig).connect();
  await ensureSyncLog(pool);
  await ensureBooksColumns(pool);
  await seedOperationalData(pool);
  await seedDayBookIfThin(pool);
  return pool;
}

async function query(text, params = {}) {
  const connection = await getPool();
  const request = connection.request();
  for (const [key, value] of Object.entries(params)) {
    request.input(key, value);
  }
  return request.query(text);
}

module.exports = {
  sql,
  getPool,
  query,
};
