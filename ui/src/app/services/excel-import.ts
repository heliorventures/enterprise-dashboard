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
  errors: { code: string; field?: string; label?: string; column?: string }[];
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
  reconciliation?: { status: string; count: number; difference: number }[];
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

  mapping(id: string, mappings: { sourceHeader: string; targetField: string | null }[]) {
    return this.http.put(`/api/imports/${id}/mapping`, { mappings });
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
      batch?: Record<string, unknown>;
      reconciliation?: { status: string; count: number; difference: number }[];
    }>('/api/imports/' + id);
  }

  errors(id: string) {
    return this.http.get<
      { source_row_number: number; validation_status: string; errors: unknown }[]
    >(`/api/imports/${id}/errors`);
  }

  summary(company = 'all') {
    return this.http.get<{
      cards: Record<string, number>;
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

  tallyLedgers(company: string, q = '') {
    return this.http.get<{ id: number; name: string; groupName?: string; balance: number }[]>(
      '/api/imports/tally-ledgers',
      { params: this.params({ company, q }) },
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
