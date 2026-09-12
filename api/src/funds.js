function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function fundsOnHand(value) {
  return money(Math.abs(value));
}

function currentMonthKey(today = new Date()) {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(key, delta) {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function lastCompleteMonthKey(today = new Date()) {
  return shiftMonth(currentMonthKey(today), -1);
}

function monthLabel(key) {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function fyStartKey(monthKey) {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return month >= 4 ? `${year}-04` : `${year - 1}-04`;
}

function monthsElapsedInFy(monthKey) {
  const start = fyStartKey(monthKey);
  let count = 0;
  let cursor = start;
  while (cursor <= monthKey && count < 12) {
    count += 1;
    cursor = shiftMonth(cursor, 1);
  }
  return Math.max(1, count);
}

function classifyVoucher(type) {
  const name = String(type || '');
  if (/payment|purchase|debit\s*note/i.test(name)) return 'outflow';
  if (/receipt|sales|credit\s*note/i.test(name)) return 'inflow';
  return 'other';
}

function runRate(history, ledgerExpense, ledgerIncome, currentKey) {
  const complete = history.filter((row) => row.key < currentKey);
  const spent = complete.filter((row) => row.expenses > 0);
  const received = complete.filter((row) => row.inflow > 0);
  if (spent.length) {
    return {
      monthlyExpense: money(spent.reduce((sum, row) => sum + row.expenses, 0) / spent.length),
      monthlyInflow: money(received.length ? received.reduce((sum, row) => sum + row.inflow, 0) / received.length : 0),
      method: 'vouchers',
      monthsUsed: spent.length,
    };
  }

  const elapsed = monthsElapsedInFy(currentKey);
  return {
    monthlyExpense: money(ledgerExpense / elapsed),
    monthlyInflow: money(ledgerIncome / elapsed),
    method: 'ledgers',
    monthsUsed: elapsed,
  };
}

function buildForecast({ cash, rate, fromKey, months = 3 }) {
  let closing = money(cash);
  const rows = [];
  for (let index = 1; index <= months; index += 1) {
    const key = shiftMonth(fromKey, index);
    closing = money(closing + rate.monthlyInflow - rate.monthlyExpense);
    rows.push({
      key,
      label: monthLabel(key),
      expenses: money(rate.monthlyExpense),
      inflow: money(rate.monthlyInflow),
      net: money(rate.monthlyInflow - rate.monthlyExpense),
      closingCash: closing,
      kind: 'forecast',
    });
  }
  return rows;
}

function groupHistory(rows) {
  const months = new Map();
  const companies = new Map();
  for (const row of rows) {
    const month = months.get(row.key) || {
      key: row.key,
      label: row.label,
      expenses: 0,
      inflow: 0,
      expenseCount: 0,
      voucherCount: 0,
    };
    month.expenses += row.expenses || 0;
    month.inflow += row.inflow || 0;
    month.expenseCount += row.expenseCount || 0;
    month.voucherCount += row.voucherCount || 0;
    months.set(row.key, month);

    const companyId = String(row.companyId || '');
    if (!companyId) continue;
    if (!companies.has(companyId)) companies.set(companyId, []);
    companies.get(companyId).push(row);
  }
  return {
    months: [...months.values()].sort((left, right) => left.key.localeCompare(right.key)),
    byCompany: companies,
  };
}

function companyInsight(row) {
  if (row.payables > row.cashAndBank && row.receivables > 0) {
    return {
      tone: 'risk',
      note: 'Payables are larger than cash. Collect receivables or move surplus from another company before new vendor payments.',
    };
  }
  if (row.nextMonthFund < 0) {
    return {
      tone: 'risk',
      note: 'Next-month cash turns negative on the current run-rate. Pause non-essential spend and chase collections.',
    };
  }
  if (row.nextMonthFund < row.payables && row.payables > 0) {
    return {
      tone: 'watch',
      note: 'Projected next-month cash may not cover vendor dues already on the books. Keep a weekly payment calendar.',
    };
  }
  if (row.lastMonthEstimated && row.lastMonthVouchers > 0) {
    return {
      tone: 'watch',
      note: 'Last-month vouchers exist but amounts are missing. The expense figure is a ledger run-rate until Tally is re-synced.',
    };
  }
  if (row.receivables > row.bank && row.receivables > 0) {
    return {
      tone: 'watch',
      note: 'Customers owe more than the bank balance. Collection is the fastest way to fund next month.',
    };
  }
  if (row.uncommitted > 0 && row.bank > 0) {
    return {
      tone: 'ok',
      note: 'Bank covers payables and the next-month run-rate. Surplus can support a cash-tight group company if needed.',
    };
  }
  return {
    tone: 'ok',
    note: 'Bank covers the current monthly run-rate. Review payables weekly so committed dues do not surprise cash.',
  };
}

function buildCompanyFundRows({ today = new Date(), companies = [], histories = new Map() }) {
  const currentKey = currentMonthKey(today);
  const lastKey = lastCompleteMonthKey(today);
  return companies.map((company) => {
    const history = histories.get(String(company.id)) || [];
    const last = history.find((row) => row.key === lastKey);
    const rate = runRate(history, company.expenses || 0, company.revenue || 0, currentKey);
    const next = buildForecast({ cash: company.cashAndBank, rate, fromKey: currentKey, months: 1 })[0];
    const actualLast = last ? money(last.expenses) : 0;
    const lastMonthEstimated = actualLast <= 0;
    const row = {
      id: company.id,
      name: company.name,
      bank: money(company.bank),
      cash: money(company.cash),
      cashAndBank: money(company.cashAndBank),
      receivables: money(company.receivables),
      payables: money(company.payables),
      uncommitted: money(company.cashAndBank - company.payables),
      lastMonthExpenses: lastMonthEstimated ? money(rate.monthlyExpense) : actualLast,
      lastMonthInflow: last ? money(last.inflow) : 0,
      lastMonthEstimated,
      lastMonthVouchers: last ? last.expenseCount || last.voucherCount || 0 : 0,
      nextMonthNeed: money(rate.monthlyExpense),
      nextMonthFund: next ? next.closingCash : money(company.cashAndBank),
    };
    return { ...row, ...companyInsight(row) };
  });
}

function summarizeFunds({
  today = new Date(),
  bank = 0,
  cash = 0,
  receivables = 0,
  payables = 0,
  ledgerExpense = 0,
  ledgerIncome = 0,
  history = [],
  accounts = [],
  companies = [],
  histories = new Map(),
}) {
  const currentKey = currentMonthKey(today);
  const lastKey = lastCompleteMonthKey(today);
  const lastMonth = history.find((row) => row.key === lastKey) || {
    key: lastKey,
    label: monthLabel(lastKey),
    expenses: 0,
    inflow: 0,
    expenseCount: 0,
    voucherCount: 0,
  };
  const rate = runRate(history, ledgerExpense, ledgerIncome, currentKey);
  const cashAndBank = money(bank + cash);
  const forecast = buildForecast({ cash: cashAndBank, rate, fromKey: currentKey });
  const threeMonthBudget = money(rate.monthlyExpense * 3);
  const burn = money(Math.max(0, rate.monthlyExpense - rate.monthlyInflow));
  const uncommitted = money(cashAndBank - payables);
  const afterThreeMonths = forecast.length ? forecast[forecast.length - 1].closingCash : cashAndBank;

  return {
    asOf: today.toISOString().slice(0, 10),
    bank: money(bank),
    cash: money(cash),
    cashAndBank,
    receivables: money(receivables),
    payables: money(payables),
    uncommitted,
    lastMonth: {
      key: lastKey,
      label: monthLabel(lastKey),
      expenses: money(lastMonth.expenses),
      inflow: money(lastMonth.inflow),
      net: money((lastMonth.inflow || 0) - (lastMonth.expenses || 0)),
      expenseCount: lastMonth.expenseCount || 0,
      voucherCount: lastMonth.voucherCount || 0,
    },
    runRate: rate,
    threeMonthBudget,
    afterThreeMonths,
    runwayMonths: burn > 0 ? money(cashAndBank / burn) : null,
    forecast,
    history: history.map((row) => ({
      ...row,
      label: row.label || monthLabel(row.key),
      expenses: money(row.expenses),
      inflow: money(row.inflow),
      kind: 'actual',
    })),
    accounts,
    nextMonthLabel: monthLabel(shiftMonth(currentKey, 1)),
    lastMonthLabel: monthLabel(lastKey),
    byCompany: buildCompanyFundRows({ today, companies, histories }),
    methodNote:
      rate.method === 'vouchers'
        ? 'Next three months use the average Payment and Purchase amounts from complete months.'
        : 'Voucher amounts are mostly missing, so the three-month budget uses expense ledger closings for this financial year.',
  };
}

module.exports = {
  money,
  fundsOnHand,
  currentMonthKey,
  shiftMonth,
  lastCompleteMonthKey,
  monthLabel,
  fyStartKey,
  monthsElapsedInFy,
  classifyVoucher,
  runRate,
  buildForecast,
  groupHistory,
  companyInsight,
  buildCompanyFundRows,
  summarizeFunds,
};
