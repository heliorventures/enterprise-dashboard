import { Component, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { CompanyDirectory } from '../../services/company-directory';
import { ExcelImportService } from '../../services/excel-import';
import { CompanySelect } from '../../shared/company-select';
import { DataColumn, DataTable } from '../../shared/data-table';
import { Icon } from '../../shared/icon';
import { KpiCard } from '../../shared/kpi-card';
import { fullInr } from '../../shared/money';
import { PageHeader } from '../../shared/page-header';
import { recordKey } from '../../shared/record-columns';
import { LatestRequest } from '../../shared/latest-request';
import { Pager } from '../../shared/pager';
import { ImportExport } from './import-export';
import { ImportNav } from './import-nav';
import { importDate } from './import-columns';

@Component({
  providers: [CompanyDirectory],
  selector: 'app-import-results',
  imports: [CompanySelect, DataTable, Icon, KpiCard, PageHeader, ImportNav, Pager, ImportExport],
  templateUrl: './import-results.html',
  styleUrl: './imports.css',
})
export class ImportResults {
  private readonly api = inject(ExcelImportService);
  private readonly reportsRequest = new LatestRequest();
  private readonly outstandingRequest = new LatestRequest();
  private readonly directory = inject(CompanyDirectory);
  readonly companies = this.directory.companies;
  readonly company = signal('all');
  readonly reportsLoading = signal(true);
  readonly outstandingLoading = signal(true);
  readonly loading = computed(() => this.reportsLoading() || this.outstandingLoading());
  readonly search = signal('');
  readonly query = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(50);
  readonly total = signal(0);
  private readonly reportsError = signal('');
  private readonly outstandingError = signal('');
  readonly error = computed(() => this.reportsError() || this.outstandingError());
  readonly cards = signal<Record<string, number>>({});
  readonly outstanding = signal<Record<string, unknown>[]>([]);
  readonly ageing = signal<Record<string, unknown>[]>([]);
  readonly gaps = signal<Record<string, unknown>[]>([]);
  readonly recordKey = recordKey;
  readonly fullInr = fullInr;
  readonly outstandingColumns: DataColumn<Record<string, unknown>>[] = [
    {
      key: 'account',
      label: 'Account',
      value: (row) => String(row['account_name'] || '—'),
      link: (row) => ({ path: `/imports/accounts/${row['account_id']}` }),
      primary: true,
    },
    { key: 'company', label: 'Company', value: (row) => String(row['company_name'] || '—') },
    {
      key: 'reportDate',
      label: 'Reporting date',
      value: (row) => importDate(row['reporting_date']),
    },
    {
      key: 'bill',
      label: 'Bill',
      value: (row) => fullInr(Number(row['bill_amount'] || 0)),
      numeric: true,
    },
    {
      key: 'paid',
      label: 'Paid',
      value: (row) => fullInr(Number(row['paid_amount'] || 0)),
      numeric: true,
    },
    {
      key: 'dr',
      label: 'Pending Dr',
      value: (row) => fullInr(Number(row['pending_bill_debit'] || 0)),
      numeric: true,
      primary: true,
    },
    {
      key: 'cr',
      label: 'Pending Cr',
      value: (row) => fullInr(Number(row['pending_bill_credit'] || 0)),
      numeric: true,
    },
    {
      key: 'status',
      label: 'Status',
      value: (row) => String(row['recon_status'] || '—').replaceAll('_', ' '),
      primary: true,
    },
  ];
  readonly ageingColumns: DataColumn<Record<string, unknown>>[] = [
    {
      key: 'bucket',
      label: 'Ageing',
      value: (row) => String(row['bucket_label'] || row['ageing_bucket'] || '—'),
      primary: true,
    },
    {
      key: 'debit',
      label: 'Debit',
      value: (row) => fullInr(Number(row['debit'] || 0)),
      numeric: true,
      primary: true,
    },
    {
      key: 'credit',
      label: 'Credit',
      value: (row) => fullInr(Number(row['credit'] || 0)),
      numeric: true,
    },
    {
      key: 'net',
      label: 'Net',
      value: (row) => fullInr(Number(row['net'] || 0)),
      numeric: true,
      primary: true,
    },
  ];
  readonly gapColumns: DataColumn<Record<string, unknown>>[] = [
    {
      key: 'account',
      label: 'Account',
      value: (row) => String(row['account_name'] || row['tally_ledger_name'] || '—'),
      link: (row) => ({ path: `/imports/sync/${row['id']}` }),
      primary: true,
    },
    {
      key: 'source',
      label: 'Source',
      value: (row) => fullInr(Number(row['source_amount'] || 0)),
      numeric: true,
    },
    {
      key: 'tally',
      label: 'Tally',
      value: (row) => fullInr(Number(row['tally_amount'] || 0)),
      numeric: true,
      primary: true,
    },
    {
      key: 'diff',
      label: 'Difference',
      value: (row) =>
        row['difference'] == null ? 'Unavailable' : fullInr(Number(row['difference'])),
      numeric: true,
      primary: true,
    },
    {
      key: 'status',
      label: 'Status',
      value: (row) => String(row['status'] || '—').replaceAll('_', ' '),
    },
  ];

  constructor() {
    this.load();
  }

  onCompany(value: string) {
    this.company.set(value);
    this.page.set(1);
    this.load();
  }

  applySearch(event?: Event) {
    event?.preventDefault();
    this.query.set(this.search().trim());
    this.page.set(1);
    this.loadOutstanding();
  }

  onSearch(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
  }
  onPage(page: number) {
    this.page.set(page);
    this.loadOutstanding();
  }
  onPageSize(size: number) {
    this.pageSize.set(size);
    this.page.set(1);
    this.loadOutstanding();
  }

  money(value: unknown) {
    if (this.reportsLoading() || this.reportsError()) return '—';
    return fullInr(Number(value || 0));
  }

  text(value: unknown) {
    if (this.reportsLoading() || this.reportsError()) return '—';
    return value == null || value === '' ? '0' : String(value);
  }

  rowId(row: Record<string, unknown>) {
    return String(row['id'] || row['ageing_bucket'] || row['bucket_label'] || '');
  }

  private load() {
    this.reportsLoading.set(true);
    this.reportsError.set('');
    this.cards.set({});
    this.ageing.set([]);
    this.gaps.set([]);
    const company = this.company();
    this.reportsRequest.run(
      forkJoin({
        summary: this.api.summary(company),
        ageing: this.api.ageing(company),
        gaps: this.api.reconciliation(company),
      }),
      {
        next: (data) => {
          this.cards.set(data.summary.cards || {});
          this.ageing.set(data.ageing.buckets || []);
          this.gaps.set(data.gaps || []);
          this.reportsLoading.set(false);
        },
        error: (err) => {
          this.reportsError.set(err.error?.error || 'Unable to load import reports');
          this.reportsLoading.set(false);
        },
      },
    );
    this.loadOutstanding();
  }

  private loadOutstanding() {
    this.outstandingError.set('');
    this.outstandingLoading.set(true);
    this.outstanding.set([]);
    this.outstandingRequest.run(
      this.api.outstanding({
        company: this.company(),
        q: this.query(),
        page: this.page(),
        pageSize: this.pageSize(),
      }),
      {
        next: (data) => {
          this.outstanding.set(data.items || []);
          this.total.set(data.total || 0);
          this.outstandingLoading.set(false);
        },
        error: (err) => {
          this.outstandingError.set(err.error?.error || 'Unable to load outstanding');
          this.outstandingLoading.set(false);
        },
      },
    );
  }
}
