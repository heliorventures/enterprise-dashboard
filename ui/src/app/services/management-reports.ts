import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

export interface ReportFilters {
  company?: string;
  type?: string;
  from?: string;
  to?: string;
  minAmount?: string | number;
}

export interface ReportRow {
  [key: string]: unknown;
  vouchers?: number;
  withAmount?: number;
  turnover?: number;
  inflow?: number;
  outflow?: number;
  net?: number;
}

export interface ReportResult {
  period: { from: string; to: string };
  types?: string[];
  cards?: ReportRow;
  minAmount?: number;
  items?: ReportRow[];
}

@Injectable({
  providedIn: 'root',
})
export class ManagementReportsService {
  private readonly http = inject(HttpClient);

  get(kind: string, filters: ReportFilters) {
    return this.http.get<ReportResult>(`/api/management-reports/${kind}`, {
      params: this.params(filters),
    });
  }

  private params(filters: ReportFilters) {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === '') return;
      params = params.set(key, String(value));
    });
    return params;
  }
}
