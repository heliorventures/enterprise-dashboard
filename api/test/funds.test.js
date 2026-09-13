const { test } = require('node:test');
const assert = require('node:assert/strict');
const funds = require('../src/funds');

test('last complete month and forecast months stay on the calendar', () => {
  assert.equal(funds.lastCompleteMonthKey(new Date('2026-09-12T10:00:00')), '2026-08');
  assert.equal(funds.shiftMonth('2026-09', 1), '2026-10');
  assert.equal(funds.shiftMonth('2026-11', 3), '2027-02');
  assert.equal(funds.monthLabel('2026-08'), 'August 2026');
});

test('run-rate prefers voucher months and falls back to ledger closings', () => {
  const fromVouchers = funds.runRate(
    [
      { key: '2026-06', expenses: 90, inflow: 30 },
      { key: '2026-07', expenses: 110, inflow: 50 },
      { key: '2026-08', expenses: 100, inflow: 40 },
      { key: '2026-09', expenses: 10, inflow: 5 },
    ],
    999,
    999,
    '2026-09'
  );
  assert.equal(fromVouchers.method, 'vouchers');
  assert.equal(fromVouchers.monthlyExpense, 100);
  assert.equal(fromVouchers.monthlyInflow, 40);

  const fromLedgers = funds.runRate([{ key: '2026-08', expenses: 0, inflow: 0 }], 60000, 12000, '2026-09');
  assert.equal(fromLedgers.method, 'ledgers');
  assert.equal(fromLedgers.monthlyExpense, 10000);
  assert.equal(fromLedgers.monthlyInflow, 2000);
});

test('three-month budget uses current cash and the monthly run-rate', () => {
  const snapshot = funds.summarizeFunds({
    today: new Date('2026-09-12T08:00:00'),
    bank: 400000,
    cash: 20000,
    receivables: 80000,
    payables: 50000,
    ledgerExpense: 60000,
    ledgerIncome: 0,
    history: [
      { key: '2026-08', expenses: 30000, inflow: 10000, expenseCount: 12, voucherCount: 20 },
    ],
  });

  assert.equal(snapshot.lastMonth.key, '2026-08');
  assert.equal(snapshot.lastMonth.expenses, 30000);
  assert.equal(snapshot.threeMonthBudget, 90000);
  assert.equal(snapshot.forecast.length, 3);
  assert.equal(snapshot.forecast[0].key, '2026-10');
  assert.equal(snapshot.forecast[2].closingCash, 360000);
  assert.equal(snapshot.uncommitted, 370000);
  assert.equal(snapshot.runRate.method, 'vouchers');
});

test('company fund board uses last-month spend, next-month cash, and a risk note', () => {
  const rows = funds.buildCompanyFundRows({
    today: new Date('2026-09-12T08:00:00'),
    companies: [
      {
        id: '1',
        name: 'Solvian Buildcon',
        bank: 200000,
        cash: 0,
        cashAndBank: 200000,
        receivables: 80000,
        payables: 350000,
        expenses: 90000,
        revenue: 30000,
      },
    ],
    histories: new Map([
      ['1', [{ key: '2026-08', expenses: 40000, inflow: 10000, expenseCount: 8, voucherCount: 10 }]],
    ]),
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].lastMonthExpenses, 40000);
  assert.equal(rows[0].lastMonthInflow, 10000);
  assert.equal(rows[0].lastMonthEstimated, false);
  assert.equal(rows[0].nextMonthNeed, 40000);
  assert.equal(rows[0].nextMonthFund, 170000);
  assert.equal(rows[0].tone, 'risk');
  assert.match(rows[0].note, /Payables are larger than cash/);
});
