export interface TallyStatus {
  mode?: 'push' | 'pull';
  connected: boolean;
  url: string;
  message: string;
  companies: string[];
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
  cash: number;
  source: string;
  asOfDate: string;
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
  };
  companyFinancials: CompanyFinancial[];
  work: {
    totals: {
      total: number;
      onTrack: number;
      delayed: number;
      atRisk: number;
      completed: number;
    };
    items: WorkItem[];
  };
}
