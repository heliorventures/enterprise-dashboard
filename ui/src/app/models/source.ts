export interface SourceCompany {
  id: string;
  name: string;
  batch_id: string | null;
  currency: string | null;
  captured_at: string | null;
  books_from: string | null;
  starting_from: string | null;
  coverage: {
    uniformCurrency?: boolean;
    postingsComplete?: boolean;
    vouchers?: number;
    vouchersWithPostings?: number;
  } | null;
  issue_count: number;
}
export interface SourceAmount {
  category_name?: string | null;
  company_id: string;
  name: string;
  amount: string | null;
  count: number;
  valued?: number;
}
export interface SourceOverview {
  period?: { fromMonth: string; toMonth: string };
  companies: SourceCompany[];
  groups: SourceAmount[];
  allocations: SourceAmount[];
  inventory: SourceAmount[];
  postings: SourceAmount[];
  masters: { company_id: string; collection: string; count: number }[];
}
export interface ArchiveRow {
  id: string;
  company_name: string;
  captured_at: string;
  received_at: string;
  coverage_status: string;
  sync_status: string | null;
  issue_count: number;
  diagnostic_count?: number;
  exporter?: {version: string; contract: string; buildHash: string};
  collections: { name: string; count: number; status: string; readiness?: {status: string; errorCount: number; warningCount: number} }[];
}
export interface ValidationIssue {
  id: string;
  company_name: string;
  batch_id: string;
  collection: string;
  ordinal: number | null;
  field: string;
  severity: string;
  code: string;
  message: string;
}
export interface SourceMaster {
  id: string;
  company_name: string;
  collection: string;
  name: string;
  parent_name: string | null;
  category_name: string | null;
  base_units: string | null;
  batch_id: string;
  ordinal: number;
}
export interface SourcePage<T> {
  items: T[];
  total: number | null;
  hasMore?: boolean;
  nextCursor?: string | null;
  page: number;
  pageSize: number;
}
