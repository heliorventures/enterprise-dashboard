import { Component, computed, inject, signal } from '@angular/core';
import { CompanyDirectory } from '../../services/company-directory';
import { ExcelImportService } from '../../services/excel-import';
import { CompanySelect } from '../../shared/company-select';
import { DataColumn, DataTable } from '../../shared/data-table';
import { FilterPanel } from '../../shared/filter-panel';
import { Icon } from '../../shared/icon';
import { KpiCard } from '../../shared/kpi-card';
import { LatestRequest } from '../../shared/latest-request';
import { fullInr } from '../../shared/money';
import { PageHeader } from '../../shared/page-header';
import { Pager } from '../../shared/pager';
import { ImportNav } from './import-nav';
import { comparisonMoney, importDate } from './import-columns';

@Component({
  providers: [CompanyDirectory],
  selector: 'app-import-sync',
  imports: [CompanySelect, DataTable, FilterPanel, Icon, KpiCard, PageHeader, Pager, ImportNav],
  templateUrl: './import-sync.html',
  styleUrl: './imports.css',
})
export class ImportSync {
  private readonly api = inject(ExcelImportService);
  private readonly directory = inject(CompanyDirectory);
  private readonly request = new LatestRequest();
  readonly companies = this.directory.companies;
  readonly company = signal('all');
  readonly search = signal('');
  readonly query = signal('');
  readonly status = signal('differences');
  readonly mapped = signal('');
  readonly minDifference = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(50);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly items = signal<Record<string, unknown>[]>([]);
  readonly total = signal(0);
  readonly counts = signal<Record<string, number>>({});
  readonly fullInr = fullInr;
  readonly columns: DataColumn<Record<string, unknown>>[] = [
    {
      key: 'account',
      label: 'Excel account',
      value: (row) => String(row['account_name'] || 'Not in Excel'),
      secondary: (row) => String(row['company_name'] || ''),
      link: (row) => ({ path: `/imports/sync/${row['id']}` }),
      primary: true,
    },
    {
      key: 'tally',
      label: 'Tally ledger',
      value: (row) => String(row['tally_ledger_name'] || 'Not mapped'),
      secondary: (row) => this.mappingLabel(row),
      primary: true,
    },
    {
      key: 'excelAmt',
      label: 'Excel pending',
      value: (row) => fullInr(Number(row['source_amount'] || 0)),
      numeric: true,
    },
    {
      key: 'tallyAmt',
      label: 'Tally balance',
      value: (row) => (row['tally_amount'] == null ? '—' : fullInr(Number(row['tally_amount']))),
      numeric: true,
      primary: true,
    },
    {
      key: 'diff',
      label: 'Difference',
      value: (row) => comparisonMoney(row['difference']),
      numeric: true,
      primary: true,
      tone: (row) => (Math.abs(Number(row['difference'] || 0)) > 1000 ? 'negative' : 'neutral'),
    },
    {
      key: 'status',
      label: 'Status',
      value: (row) => this.statusLabel(String(row['status'] || '')),
      primary: true,
    },
    { key: 'reportDate', label: 'Excel date', value: (row) => importDate(row['reporting_date']) },
    {
      key: 'tallyDate',
      label: 'Tally balance date',
      value: (row) => importDate(row['tally_balance_date']),
    },
  ];
  readonly filterSummary = computed(() =>
    [
      this.company() === 'all'
        ? 'All companies'
        : this.companies().find((item) => item.id === this.company())?.name,
      this.status() === 'differences'
        ? 'Differences only'
        : this.status() === 'all'
          ? 'All statuses'
          : this.status().replaceAll('_', ' '),
      this.query() ? `Search “${this.query()}”` : '',
      this.minDifference() ? `Gap ≥ ${this.minDifference()}` : '',
      this.mapped() ? this.mapped() : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );
  readonly statuses = [
    { id: 'differences', label: 'Differences' },
    { id: 'all', label: 'All' },
    { id: 'AMOUNT_MISMATCH', label: 'Amount mismatch' },
    { id: 'MISSING_IN_TALLY', label: 'Missing in Tally' },
    { id: 'MISSING_IN_SOURCE', label: 'Missing in Excel' },
    { id: 'PARTIALLY_MATCHED', label: 'Needs confirmation' },
    { id: 'MATCHED', label: 'In sync' },
    { id: 'COMPARISON_UNAVAILABLE', label: 'Comparison unavailable' },
  ];

  constructor() {
    this.load();
  }

  count(status: string) {
    if (status === 'all') {
      return Object.values(this.counts()).reduce((sum, value) => sum + value, 0);
    }
    if (status === 'differences') {
      return Object.entries(this.counts())
        .filter(([key]) => key !== 'MATCHED')
        .reduce((sum, [, value]) => sum + value, 0);
    }
    return this.counts()[status] || 0;
  }

  textCount(status: string) {
    return String(this.count(status));
  }

  statusLabel(status: string) {
    if (status === 'MATCHED') return 'Same in Excel and Tally';
    if (status === 'AMOUNT_MISMATCH') return 'Amount differs';
    if (status === 'MISSING_IN_TALLY') return 'In Excel, not in Tally';
    if (status === 'MISSING_IN_SOURCE') return 'In Tally, not in Excel';
    if (status === 'PARTIALLY_MATCHED') return 'Needs confirmation';
    if (status === 'COMPARISON_UNAVAILABLE') return 'Comparison unavailable';
    return status.replaceAll('_', ' ') || '—';
  }

  load() {
    this.loading.set(true);
    this.error.set('');
    this.items.set([]);
    this.counts.set({});
    this.total.set(0);
    this.request.run(
      this.api.sync({
        company: this.company(),
        status: this.status(),
        q: this.query(),
        minDifference: this.minDifference(),
        mapped: this.mapped(),
        page: this.page(),
        pageSize: this.pageSize(),
      }),
      {
        next: (result) => {
          this.items.set(result.items || []);
          this.total.set(result.total || 0);
          this.counts.set(result.counts || {});
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.error || 'Unable to load Tally mapping');
          this.loading.set(false);
        },
      },
    );
  }

  apply(event?: Event) {
    event?.preventDefault();
    this.query.set(this.search());
    this.page.set(1);
    this.load();
  }

  clear() {
    this.company.set('all');
    this.search.set('');
    this.query.set('');
    this.status.set('differences');
    this.mapped.set('');
    this.minDifference.set('');
    this.page.set(1);
    this.load();
  }

  onCompany(value: string) {
    this.company.set(value);
    this.apply();
  }

  onStatus(id: string) {
    this.status.set(id);
    this.apply();
  }

  onMapped(event: Event) {
    this.mapped.set((event.target as HTMLSelectElement).value);
    this.apply();
  }

  onMin(event: Event) {
    this.minDifference.set((event.target as HTMLInputElement).value);
  }

  onQuery(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
  }

  onPage(page: number) {
    this.page.set(page);
    this.load();
  }

  onPageSize(size: number) {
    this.pageSize.set(size);
    this.page.set(1);
    this.load();
  }

  mappingLabel(row: Record<string, unknown>) {
    if (row['mapping_source'] === 'MANUAL') return 'Mapped by user';
    if (row['tally_ledger_id']) return String(row['match_method'] || 'Auto').replaceAll('_', ' ');
    return 'Unmapped';
  }

  rowId(row: Record<string, unknown>) {
    return String(row['id']);
  }
}
