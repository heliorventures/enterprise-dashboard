import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ExpenseReport, LedgerRow, PagedResult, ProjectReport, VoucherRow } from '../models/books';
import { DashboardData, SourceSyncHistory, SourceSyncRun, TallyStatus } from '../models/dashboard';

@Injectable({
  providedIn: 'root',
})
export class DashboardService {
  private readonly http = inject(HttpClient);

  getDashboard(company = 'all'): Observable<DashboardData> {
    return this.http.get<DashboardData>('/api/dashboard', {
      params: { company },
    });
  }

  getLedgers(filters: {
    company?: string;
    q?: string;
    group?: string;
    page?: number;
    pageSize?: number;
  }): Observable<PagedResult<LedgerRow>> {
    return this.http.get<PagedResult<LedgerRow>>('/api/ledgers', {
      params: this.toParams(filters),
    });
  }

  getVouchers(filters: {
    company?: string;
    q?: string;
    type?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }): Observable<PagedResult<VoucherRow>> {
    return this.http.get<PagedResult<VoucherRow>>('/api/vouchers', {
      params: this.toParams(filters),
    });
  }

  getExpenseReport(company = 'all'): Observable<ExpenseReport> {
    return this.http.get<ExpenseReport>('/api/reports/expenses', {
      params: { company },
    });
  }

  getProjectReport(company = 'all'): Observable<ProjectReport> {
    return this.http.get<ProjectReport>('/api/reports/projects', {
      params: { company },
    });
  }

  getTallyStatus(): Observable<TallyStatus> {
    return this.http.get<TallyStatus>('/api/tally/status');
  }

  getTallyCompanies() {
    return this.http.get<{ source: string; companies: { name: string }[] }>('/api/tally/companies');
  }

  getTallyLedgers(company?: string) {
    return this.http.get<{ source: string; company: string; count: number; items: unknown[] }>(
      '/api/tally/ledgers',
      { params: this.toParams({ company }) },
    );
  }

  getTallyVouchers(company?: string, from?: string, to?: string) {
    return this.http.get<{ source: string; company: string; count: number; items: unknown[] }>(
      '/api/tally/vouchers',
      { params: this.toParams({ company, from, to }) },
    );
  }

  getSourceSync(): Observable<SourceSyncHistory> {
    return this.http.get<SourceSyncHistory>('/api/tally/sync');
  }

  startSourceSync(): Observable<SourceSyncRun> {
    return this.http.post<SourceSyncRun>('/api/tally/sync', {});
  }

  private toParams(filters: Record<string, string | number | undefined>) {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === '') {
        return;
      }
      params = params.set(key, String(value));
    });
    return params;
  }
}
