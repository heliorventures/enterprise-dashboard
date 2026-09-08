import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { LedgerRow, PagedResult, VoucherRow } from '../models/books';
import { DashboardData, TallyStatus } from '../models/dashboard';

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

  syncTally(): Observable<TallyStatus> {
    return this.http.post<TallyStatus>('/api/tally/sync', {});
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
