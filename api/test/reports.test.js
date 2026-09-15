const { test } = require('node:test');
const assert = require('node:assert/strict');
const reports = require('../src/reports');

test('expense groups exclude payables and keep purchase or expense books', () => {
  assert.equal(reports.isExpenseGroup('Indirect Expenses'), true);
  assert.equal(reports.isExpenseGroup('Purchase Accounts'), true);
  assert.equal(reports.isExpenseGroup('Office Rent Expenses (G)'), false);
  assert.equal(reports.isExpenseGroup('Sundry Creditors - Fuel (G)'), false);
  assert.equal(reports.isExpenseGroup('Provision for Expenses (G)'), false);
  assert.equal(reports.isExpenseGroup('Salary Payable'), false);
});

test('expense classification follows resolved hierarchy rather than words in custom names', () => {
  const rows = reports.nestExpenses([
    { CompanyID: 1, CompanyName: 'Example', LedgerID: 1, LedgerName: 'Provision', GroupCategory: 'Provision for Expenses (G)', RootGroup: 'Provisions', CurrentBalance: '80947' },
    { CompanyID: 1, CompanyName: 'Example', LedgerID: 2, LedgerName: 'Rent', GroupCategory: 'Premises', RootGroup: 'Indirect Expenses', CurrentBalance: '-100' },
    { CompanyID: 1, CompanyName: 'Example', LedgerID: 3, LedgerName: 'Advance', GroupCategory: 'Purchase advance', RootGroup: 'Current Assets', CurrentBalance: '200' },
    { CompanyID: 1, CompanyName: 'Example', LedgerID: 4, LedgerName: 'Unknown', GroupCategory: 'Expense Reserve', CurrentBalance: '300' },
  ]);
  assert.equal(rows[0].total, 100);
  assert.equal(rows[0].ledgerCount, 1);
  assert.equal(rows[0].groups[0].ledgers[0].name, 'Rent');
});

test('expense rows nest into company, group, and ledger drill-down', () => {
  const companies = reports.nestExpenses([
    { CompanyID: 1, CompanyName: 'Buildcon', LedgerID: 10, LedgerName: 'Rent', GroupCategory: 'Indirect Expenses', CurrentBalance: '-4000' },
    { CompanyID: 1, CompanyName: 'Buildcon', LedgerID: 11, LedgerName: 'Fuel', GroupCategory: 'Direct Expenses', CurrentBalance: '1000' },
    { CompanyID: 2, CompanyName: 'Consultancy', LedgerID: 12, LedgerName: 'Vendor', GroupCategory: 'Sundry Creditors', CurrentBalance: '9000' },
  ]);
  assert.equal(companies.length, 1);
  assert.equal(companies[0].name, 'Buildcon');
  assert.equal(companies[0].total, 5000);
  assert.equal(companies[0].groups.length, 2);
  assert.equal(companies[0].groups[0].name, 'Indirect Expenses');
  assert.equal(companies[0].groups[0].ledgers[0].name, 'Rent');
});

test('project rows nest invested and earned by company', () => {
  const companies = reports.nestProjects([
    { CompanyID: 1, CompanyName: 'Infra', ProjectID: 10, ProjectName: 'Hingoli', voucherCount: 2, withAmount: 2, invested: 4000, earned: 1500 },
    { CompanyID: 1, CompanyName: 'Infra', ProjectID: 11, ProjectName: 'Beed', voucherCount: 1, withAmount: 1, invested: 500, earned: 2000 },
    { CompanyID: 2, CompanyName: 'Consultancy', ProjectID: 12, ProjectName: 'Office', voucherCount: 1, withAmount: 0, invested: 0, earned: 0 },
  ]);
  assert.equal(companies.length, 2);
  assert.equal(companies[0].name, 'Infra');
  assert.equal(companies[0].invested, 4500);
  assert.equal(companies[0].earned, 3500);
  assert.equal(companies[0].net, -1000);
  assert.equal(companies[0].projects[0].name, 'Hingoli');
  assert.equal(companies[1].projects[0].name, 'Office');
});
