import { HttpClient, HttpEventType, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, filter, map } from 'rxjs';

export interface ExcelImportRow {
  id: string;
  file_name: string;
  status: string;
  uploaded_at: string;
  detected_company?: string;
  company_name?: string;
  source_name?: string;
  total_rows?: number;
  successful_rows?: number;
  failed_rows?: number;
  warning_rows?: number;
  detail_rows?: number;
  source_total_status?: string;
  progress_percent?: number;
  progress_message?: string;
}

export interface ExcelColumn {
  index: number;
  canonical: string;
  target?: string | null;
  unmapped?: boolean;
}

export interface ExcelUploadResult {
  file: { id: string; fileName?: string; file_name?: string; status: string };
  selectedCompany?: { id: string; name: string };
  companyMismatch?: boolean;
  duplicate?: { uploaded_at: string } | null;
  analysis: {
    currency?: string | null;
    title?: string;
    company?: { company?: string };
    period?: { from?: string; to?: string };
    counts?: { dataRows?: number; groupRows?: number; totalRows?: number };
    columns?: ExcelColumn[];
    preview?: {
      sourceRowNumber: number;
      raw: Record<string, unknown>;
      categoryPath?: string[];
      rowType: string;
    }[];
  };
}

export interface ExcelField {
  field_key: string;
  label: string;
  required?: boolean;
}

export interface ExcelValidationIssue {
  row: number | null;
  account?: string | null;
  errors: { code: string; field?: string; label?: string; column?: string; firstRow?: number }[];
}

export interface ExcelValidation {
  total: number;
  valid: number;
  warnings: number;
  errors: number;
  canProcess: boolean;
  missingRequired?: { field_key: string; label: string }[];
  unmappedColumns?: string[];
  issues?: ExcelValidationIssue[];
}

export interface ExcelImportProgress {
  fileId: string;
  fileName?: string;
  status: string;
  batchStatus?: string | null;
  percent: number;
  message: string;
  error?: string | null;
  running?: boolean;
  validation?: ExcelValidation | null;
  canProcess?: boolean;
  batch?: Record<string, unknown> | null;
  reconciliation?: ImportReconciliationSummary[];
}

export interface ImportReconciliationSummary {
  status: string;
  count: number;
  difference: number | string | null;
  currency?: string | null;
}

export type ImportRecord = Record<string, unknown>;
export type ImportReportType = 'outstanding' | 'reconciliation' | 'exceptions' | 'quality';
export interface ImportReportFilters {
  company?: string;
  status?: string;
  q?: string;
}
export interface ImportAccountDetail {
  account: ImportRecord;
  outstanding: ImportRecord[];
  ageing: ImportRecord[];
  exceptions: ImportRecord[];
  audit: ImportRecord[];
}
export interface ImportQuality extends ImportRecord {
  issues: { type: string; count: number }[];
}

export interface ProjectRule {
  id: string;
  keyword: string;
}

export interface ProjectRow {
  id: string | null;
  name: string;
  tallyProjectId: number | null;
  tallyProjectName: string | null;
  budgetExpense: string | null;
  targetRevenue: string | null;
  rules: ProjectRule[];
  parties: number;
  billed: string | null;
  paid: string | null;
  pending: string | null;
  paidPct: number | null;
  matched: number;
  differences: number;
  unavailable: number;
  tallyOnlyLedgers: number;
  gap: string | null;
  excelAmount: string | null;
  tallyAmount: string | null;
  /** Excel minus Tally. */
  netDifference: string | null;
  budgetUsedPct: number | null;
  budgetStatus: 'NO_BUDGET' | 'ON_TRACK' | 'AT_RISK' | 'OVER_BUDGET';
  tallyVouchers: number | null;
  tallyVouchersWithAmount: number | null;
  tallyLastVoucherDate: string | null;
  health: 'IN_SYNC' | 'HAS_GAPS' | 'COMPARISON_UNAVAILABLE' | 'EMPTY';
}

export interface ProjectSummary {
  company: { id: string; name: string; tallyCompanyId: number };
  currency: string | null;
  monetaryAvailable: boolean;
  currencyMessage: string | null;
  /** Assumptions the comparison made (company currency, undated Tally balances). */
  notes: string[];
  projects: ProjectRow[];
  unassigned: ProjectRow;
  tallyProjects: { id: number; name: string }[];
  coverage: { assigned: number; total: number };
  tally: { vouchers: number; vouchersWithAmount: number; amountsAvailable: boolean };
  latestImport: {
    id: string;
    file_name: string;
    status: string;
    reporting_date: string | null;
    published_at: string;
    detail_rows: number;
  } | null;
}

export interface ProjectSuggestion {
  keyword: string;
  count: number;
  tallyProjectId?: number;
  tallyProjectName?: string;
  source: 'TALLY_PROJECT' | 'NAME_SUFFIX';
}

export interface ProjectInput {
  name?: string;
  tallyProjectId?: number | null;
  budgetExpense?: string | null;
  targetRevenue?: string | null;
  keywords?: string[];
}

export interface ProjectDetail {
  company: { id: string; name: string };
  project: {
    id: string;
    name: string;
    budget_expense: string | null;
    target_revenue: string | null;
    tally_project_id: number | null;
    tally_project_name: string | null;
    rules: ProjectRule[];
  } | null;
  projectChoices: { id: string; name: string }[];
  tallyProjects: { id: number; name: string }[];
  items: ImportRecord[];
  total: number;
  page: number;
  pageSize: number;
  tallyOnly: ImportRecord[];
}

/** What one project looked like when one Excel file was imported. */
export interface ProjectHistoryItem {
  importId: string;
  batchId: string;
  fileName: string;
  generation: number;
  importedAt: string | null;
  reportingDate: string | null;
  current: boolean;
  projectId: string | null;
  projectName: string;
  currency: string | null;
  parties: number;
  billed: string | null;
  paid: string | null;
  pending: string | null;
  paidPct: number | null;
  matched: number;
  differences: number;
  unavailable: number;
  tallyOnlyLedgers: number;
  gap: string | null;
}

export interface ProjectHistory {
  company: { id: string; name: string };
  items: ProjectHistoryItem[];
}

/** An Excel party and the Tally ledger it was matched to, if any. */
export interface PresenceExcelRow {
  account_id: string;
  account_name: string;
  level_1_category: string | null;
  project_name: string;
  tally_ledger_id: number | null;
  tally_ledger_name: string | null;
  match_method: string | null;
  source_amount: string | null;
  tally_amount: string | null;
  tally_group: string | null;
}

/** A Tally ledger with a balance that no Excel party was matched to. */
export interface PresenceTallyRow {
  tally_ledger_id: number;
  tally_ledger_name: string;
  tally_amount: string | null;
  tally_group: string | null;
  project_name: string;
}

export interface Presence {
  company: { id: string; name: string };
  latestImport: { file_name: string; reporting_date: string | null } | null;
  summary: {
    excelParties: number;
    found: number;
    possible: number;
    missingInTally: number;
    missingInExcel: number;
  };
  missingInTally: PresenceExcelRow[];
  possible: PresenceExcelRow[];
  found: PresenceExcelRow[];
  missingInExcel: PresenceTallyRow[];
}

export interface ExcelUploadProgress {
  phase: 'upload' | 'analyze' | 'done';
  percent: number;
  message: string;
  result?: ExcelUploadResult;
}

@Injectable({
  providedIn: 'root',
})
export class ExcelImportService {
  private readonly http = inject(HttpClient);

  list() {
    return this.http.get<ExcelImportRow[]>('/api/imports');
  }

  fields() {
    return this.http.get<ExcelField[]>('/api/imports/fields');
  }

  upload(file: File, companyId: string): Observable<ExcelUploadProgress> {
    const body = new FormData();
    body.append('file', file);
    body.append('companyId', companyId);
    return this.http
      .post<ExcelUploadResult>('/api/imports/upload', body, {
        reportProgress: true,
        observe: 'events',
      })
      .pipe(
        map((event) => {
          if (event.type === HttpEventType.UploadProgress) {
            const percent = event.total ? Math.round((event.loaded / event.total) * 80) : 12;
            return { phase: 'upload' as const, percent, message: 'Uploading file…' };
          }
          if (event.type === HttpEventType.Response) {
            return {
              phase: 'done' as const,
              percent: 100,
              message: 'File analyzed',
              result: event.body as ExcelUploadResult,
            };
          }
          if (
            event.type === HttpEventType.ResponseHeader ||
            event.type === HttpEventType.DownloadProgress
          ) {
            return { phase: 'analyze' as const, percent: 88, message: 'Analyzing workbook…' };
          }
          return { phase: 'upload' as const, percent: 8, message: 'Uploading file…' };
        }),
        filter((event) => event.percent >= 0),
      );
  }

  preview(id: string) {
    return this.http.get<{
      preview: ExcelUploadResult['analysis']['preview'];
      columns: ExcelColumn[];
      counts: ExcelUploadResult['analysis']['counts'];
    }>(`/api/imports/${id}/preview`);
  }

  mapping(id: string, mappings: { sourceHeader: string; targetField: string | null }[], currency?: string | null) {
    return this.http.put(`/api/imports/${id}/mapping`, { mappings,...(currency!==undefined ? {currency} : {}) });
  }

  validate(id: string) {
    return this.http.post<ExcelValidation>('/api/imports/' + id + '/validate', {});
  }

  progress(id: string) {
    return this.http.get<ExcelImportProgress>(`/api/imports/${id}/progress`);
  }

  process(id: string) {
    return this.http.post<ExcelImportProgress>('/api/imports/' + id + '/process', {});
  }

  get(id: string) {
    return this.http.get<{
      file: Record<string, unknown>;
      companyName?: string;
      currency?: string | null;
      batch?: Record<string, unknown>;
      reconciliation?: ImportReconciliationSummary[];
    }>('/api/imports/' + id);
  }

  errors(id: string) {
    return this.http.get<
      { source_row_number: number; validation_status: string; errors: unknown }[]
    >(`/api/imports/${id}/errors`);
  }

  summary(company = 'all') {
    return this.http.get<{
      cards: Record<string, number | null>;
      currency?: string | null;
      currencyMessage?: string | null;
      ageing: { bucket: string; label: string; net: number; pct?: number }[];
      byCompany: { id: string; name: string; outstanding: number; gap: number }[];
      topAccounts: Record<string, unknown>[];
    }>('/api/imports/summary', { params: this.params({ company }) });
  }

  outstanding(filters: { company?: string; q?: string; page?: number; pageSize?: number }) {
    return this.http.get<{ items: Record<string, unknown>[]; total: number }>(
      '/api/imports/outstanding',
      {
        params: this.params(filters),
      },
    );
  }

  ageing(company = 'all') {
    return this.http.get<{ buckets: Record<string, unknown>[] }>('/api/imports/ageing', {
      params: this.params({ company }),
    });
  }

  reconciliation(company = 'all') {
    return this.http.get<Record<string, unknown>[]>('/api/imports/reconciliation', {
      params: this.params({ company }),
    });
  }

  sync(filters: {
    company?: string;
    status?: string;
    q?: string;
    minDifference?: string | number;
    mapped?: string;
    page?: number;
    pageSize?: number;
  }) {
    return this.http.get<{
      items: Record<string, unknown>[];
      total: number;
      page: number;
      pageSize: number;
      counts: Record<string, number>;
    }>('/api/imports/sync', { params: this.params(filters) });
  }

  syncDetail(id: string) {
    return this.http.get<Record<string, unknown>>(`/api/imports/sync/${id}`);
  }

  mapLedger(id: string, tallyLedgerId: number | null) {
    return this.http.put<Record<string, unknown>>(`/api/imports/sync/${id}/map`, { tallyLedgerId });
  }

  tallyLedgers(reconciliationId: string, q = '') {
    return this.http.get<{ id: number; name: string; groupName?: string; balance: string | number }[]>(
      `/api/imports/sync/${reconciliationId}/ledgers`,
      { params: this.params({ q }) },
    );
  }

  account(id: string) {
    return this.http.get<ImportAccountDetail>(`/api/imports/accounts/${encodeURIComponent(id)}`);
  }

  exceptions(filters: ImportReportFilters & { page?: number; pageSize?: number }) {
    return this.http.get<{ items: ImportRecord[]; total: number; page: number; pageSize: number }>(
      '/api/imports/exceptions',
      {
        params: this.params({ ...filters }),
      },
    );
  }

  decideException(id: string, status: 'RESOLVED' | 'REJECTED', comment: string) {
    return this.http.put<ImportRecord>(`/api/imports/exceptions/${encodeURIComponent(id)}`, {
      status,
      comment,
    });
  }

  quality(company = 'all') {
    return this.http.get<ImportQuality>('/api/imports/quality', {
      params: this.params({ company }),
    });
  }

  audit(entity = '', limit = 100) {
    return this.http.get<ImportRecord[]>('/api/imports/audit', {
      params: this.params({ entity, limit }),
    });
  }

  projects(company: string) {
    return this.http.get<ProjectSummary>('/api/imports/projects', { params: this.params({ company }) });
  }

  projectSuggestions(company: string) {
    return this.http.get<ProjectSuggestion[]>('/api/imports/projects/suggestions', {
      params: this.params({ company }),
    });
  }

  projectDetail(company: string, id: string, filters: { q?: string; status?: string } = {}) {
    return this.http.get<ProjectDetail>(`/api/imports/projects/${encodeURIComponent(id)}`, {
      params: this.params({ company, ...filters, pageSize: 500 }),
    });
  }

  createProject(company: string, input: ProjectInput) {
    return this.http.post<{ id: string; assigned: number }>('/api/imports/projects', { company, ...input });
  }

  updateProject(id: string, input: Omit<ProjectInput, 'keywords'>) {
    return this.http.put(`/api/imports/projects/${encodeURIComponent(id)}`, input);
  }

  deleteProject(id: string) {
    return this.http.delete(`/api/imports/projects/${encodeURIComponent(id)}`);
  }

  addProjectRule(id: string, keyword: string) {
    return this.http.post<{ assigned: number }>(`/api/imports/projects/${encodeURIComponent(id)}/rules`, { keyword });
  }

  deleteProjectRule(ruleId: string) {
    return this.http.delete(`/api/imports/projects/rules/${encodeURIComponent(ruleId)}`);
  }

  applyProjectRules(company: string) {
    return this.http.post<{ changed: number; assigned: number }>('/api/imports/projects/apply', { company });
  }

  assignProject(accountId: string, projectId: string | null) {
    return this.http.put(`/api/imports/accounts/${encodeURIComponent(accountId)}/project`, { projectId });
  }

  /** Which Excel parties exist in Tally and which Tally ledgers are not in the Excel (by name). */
  missing(company: string) {
    return this.http.get<Presence>('/api/imports/missing', { params: this.params({ company }) });
  }

  missingReport(company: string, format: 'xlsx' | 'csv') {
    return this.http.get(`/api/imports/missing/report/${format}`, {
      params: this.params({ company }),
      responseType: 'blob',
    });
  }

  projectHistory(company: string, project?: string) {
    return this.http.get<ProjectHistory>('/api/imports/projects/history', {
      params: this.params({ company, project }),
    });
  }

  /** Tally vs Excel difference report grouped by project. */
  projectReport(company: string, format: 'xlsx' | 'csv') {
    return this.http.get(`/api/imports/projects/report/${format}`, {
      params: this.params({ company }),
      responseType: 'blob',
    });
  }

  reportCsv(type: ImportReportType, filters: ImportReportFilters) {
    return this.http.get(`/api/imports/reports/${type}.csv`, {
      params: this.params({ ...filters }),
      responseType: 'blob',
    });
  }

  private params(filters: Record<string, string | number | undefined>) {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === '') return;
      params = params.set(key, String(value));
    });
    return params;
  }
}
