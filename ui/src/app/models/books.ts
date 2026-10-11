export interface CompanyOption {
  id: string;
  name: string;
}

export interface PagedResult<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
  groups?: string[];
  types?: string[];
}

export interface LedgerRow {
  currency?: string | null;
  id: number;
  companyId: string;
  companyName: string;
  name: string;
  group: string;
  balance: number;
}

export interface ExpenseLedger {
  currency?: string | null;
  id: number;
  name: string;
  group: string;
  companyId: string;
  companyName: string;
  balance: number;
}

export interface ExpenseGroup {
  name: string;
  total: number;
  ledgerCount: number;
  ledgers: ExpenseLedger[];
}

export interface ExpenseCompany {
  currency?: string | null;
  id: string;
  name: string;
  total: number;
  ledgerCount: number;
  groups: ExpenseGroup[];
}

export interface ProjectResult {
  currency?: string | null;
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  voucherCount: number;
  withAmount: number;
  invested: number;
  earned: number;
  net: number;
}

export interface ProjectCompany {
  currency?: string | null;
  id: string;
  name: string;
  voucherCount: number;
  invested: number;
  earned: number;
  net: number;
  projects: ProjectResult[];
}

export interface ProjectReport {
  currency?: string | null;
  linkedVoucherCount: number;
  projectCount: number;
  invested: number;
  earned: number;
  net: number;
  companies: ProjectCompany[];
}

export interface ExpenseReport {
  currency?: string | null;
  lastMonth: {
    key: string;
    label: string;
    from: string;
    count: number;
    withAmount: number;
    amount: number;
  };
  total: number;
  ledgerCount: number;
  companies: ExpenseCompany[];
}

export interface VoucherRow {
  currency?: string | null;
  id: number;
  companyId: string;
  companyName: string;
  date: string;
  type: string;
  number: string | null;
  party: string | null;
  project: string | null;
  amount: number;
  narration: string;
}
