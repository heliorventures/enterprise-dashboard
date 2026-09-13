export interface TallyStatus {
  mode?: 'push' | 'pull' | 'archive';
  connected: boolean;
  url: string;
  message: string;
  companies: string[];
  current?: SourceSyncRun | null;
}

export interface SourceSyncCounts {
  insert: number;
  update: number;
  unchanged: number;
  remove: number;
}

export interface SourceSyncCompany {
  id: number;
  companyExternalId: string;
  companyName: string;
  batchId: string | null;
  status: 'pending' | 'running' | 'ok' | 'skipped' | 'error';
  message: string;
  progress: number;
  ledgers: SourceSyncCounts;
  vouchers: SourceSyncCounts;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SourceSyncRun {
  id: number;
  status: 'running' | 'ok' | 'error';
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
  companyTotal: number;
  companyDone: number;
  progress: number;
  message: string;
  companies: SourceSyncCompany[];
}

export interface SourceSyncHistory {
  current: SourceSyncRun | null;
  runs: SourceSyncRun[];
}

export interface CompanyOption {
  id: string;
  name: string;
  workAdapter: string;
}

export interface CompanyFinancial {
  id: string;
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
  receivables: number;
  payables: number;
  bank: number;
  cash: number;
  cashAndBank: number;
  ledgerCount: number;
  voucherCount: number;
  source: string;
  asOfDate: string;
}

export interface FundMonth {
  key: string;
  label: string;
  expenses: number;
  inflow: number;
  net?: number;
  closingCash?: number;
  expenseCount?: number;
  voucherCount?: number;
  kind?: 'actual' | 'forecast';
}

export interface BankAccount {
  companyId: string;
  companyName: string;
  name: string;
  group: string;
  available: number;
  kind: 'bank' | 'cash';
}

export interface CompanyFunds {
  id: string;
  name: string;
  bank: number;
  cash: number;
  cashAndBank: number;
  receivables: number;
  payables: number;
  uncommitted: number;
  lastMonthExpenses: number;
  lastMonthInflow?: number;
  lastMonthEstimated?: boolean;
  lastMonthVouchers?: number;
  nextMonthNeed: number;
  nextMonthFund: number;
  tone: 'ok' | 'watch' | 'risk';
  note: string;
}

export interface FundsOverview {
  asOf: string;
  bank: number;
  cash: number;
  cashAndBank: number;
  receivables: number;
  payables: number;
  uncommitted: number;
  lastMonth: FundMonth;
  runRate: {
    monthlyExpense: number;
    monthlyInflow: number;
    method: 'vouchers' | 'ledgers';
    monthsUsed: number;
  };
  threeMonthBudget: number;
  afterThreeMonths: number;
  runwayMonths: number | null;
  forecast: FundMonth[];
  history: FundMonth[];
  accounts: BankAccount[];
  byCompany: CompanyFunds[];
  lastMonthLabel?: string;
  nextMonthLabel?: string;
  methodNote: string;
}

export interface LedgerGroupTotal {
  name: string;
  count: number;
  balance: number;
}

export interface WorkItem {
  id: number;
  companyId: string;
  companyName: string;
  name: string;
  status: string;
  progress: number;
  owner: string;
  dueDate: string;
  source: string;
  voucherCount?: number;
  invested?: number;
  earned?: number;
  net?: number;
}

export interface DashboardData {
  generatedAt: string;
  tally: TallyStatus;
  lastSync: { Source: string; Status: string; Message: string; SyncedAt: string } | null;
  selectedCompany: string;
  companies: CompanyOption[];
  kpis: {
    revenue: number;
    expenses: number;
    profit: number;
    receivables: number;
    payables: number;
    cash: number;
    bank?: number;
  };
  funds: FundsOverview;
  companyFinancials: CompanyFinancial[];
  books: {
    ledgerCount: number;
    voucherCount: number;
    groups: LedgerGroupTotal[];
  };
  work: {
    totals: {
      total: number;
      onTrack: number;
      delayed: number;
      atRisk: number;
      completed: number;
      voucherCount?: number;
      invested?: number;
      earned?: number;
      net?: number;
    };
    items: WorkItem[];
  };
}
