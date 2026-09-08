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
  id: number;
  companyId: string;
  companyName: string;
  name: string;
  group: string;
  balance: number;
}

export interface VoucherRow {
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
