import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { combineLatest } from 'rxjs';
import { CompanyDirectory } from '../../services/company-directory';
import { ManagementReportsService, ReportRow } from '../../services/management-reports';
import { CompanySelect } from '../../shared/company-select';
import { downloadCsv } from '../../shared/csv';
import { DataColumn, DataTable } from '../../shared/data-table';
import { FilterPanel } from '../../shared/filter-panel';
import { Icon } from '../../shared/icon';
import { KpiCard } from '../../shared/kpi-card';
import { LatestRequest } from '../../shared/latest-request';
import { compactInr, fullInr } from '../../shared/money';
import { PageHeader } from '../../shared/page-header';
import { ReportNav } from './report-nav';

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

const CATALOG: Record<string, { title: string; description: string }> = {
  daily: {
    title: 'Daily transactions',
    description: 'One row per voucher date. Open a day to inspect the underlying transactions.',
  },
  weekly: {
    title: 'Weekly transactions',
    description: 'ISO weeks (Monday to Sunday) for receipts, payments and net movement.',
  },
  monthly: {
    title: 'Monthly trend',
    description: 'Month-wise turnover from imported Tally vouchers.',
  },
  types: {
    title: 'Voucher mix',
    description: 'How Payment, Receipt, Sales, Purchase and other types contribute to the period.',
  },
  parties: {
    title: 'Top counterparties',
    description: 'Highest-value parties in the selected period. Blank party names are grouped.',
  },
  large: {
    title: 'Large vouchers',
    description: 'Transactions at or above the amount threshold, for exception review.',
  },
  companies: {
    title: 'Company activity',
    description: 'Compare companies on voucher volume, receipts and payments.',
  },
};

@Component({
  providers: [CompanyDirectory],
  selector: 'app-report-view',
  imports: [CompanySelect, DataTable, FilterPanel, Icon, KpiCard, PageHeader, ReportNav],
  templateUrl: './report-view.html',
  styleUrl: '../imports/imports.css',
})
export class ReportView {
  private readonly api = inject(ManagementReportsService);
  private readonly route = inject(ActivatedRoute);
  private readonly directory = inject(CompanyDirectory);
  private readonly request = new LatestRequest();
  private readonly summaryRequest = new LatestRequest();
  readonly companies = this.directory.companies;
  readonly kind = signal('daily');
  readonly company = signal('all');
  readonly type = signal('');
  readonly from = signal(isoDate(new Date(Date.now() - 90 * 86400000)));
  readonly to = signal(isoDate(new Date()));
  readonly minAmount = signal('100000');
  readonly types = signal<string[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly exporting = signal(false);
  readonly cards = signal<ReportRow>({});
  readonly items = signal<ReportRow[]>([]);
  readonly period = signal({ from: '', to: '' });
  readonly compactInr = compactInr;
  readonly fullInr = fullInr;
  readonly meta = computed(() => CATALOG[this.kind()] || CATALOG['daily']);
  readonly filterSummary = computed(() =>
    [
      this.company() === 'all'
        ? 'All companies'
        : this.companies().find((row) => row.id === this.company())?.name,
      this.from() && this.to() ? `${this.from()} to ${this.to()}` : '',
      this.type() || 'All voucher types',
      this.kind() === 'large' ? `≥ ${this.minAmount()}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );
  readonly columns = computed(() => this.columnsFor(this.kind()));

  constructor() {
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed())
      .subscribe(([params, query]) => {
        this.company.set(query.get('company') || 'all');
        this.type.set(query.get('type') || '');
        if (query.has('from')) this.from.set(query.get('from') || '');
        if (query.has('to')) this.to.set(query.get('to') || '');
        this.kind.set(params.get('kind') || 'daily');
        this.load();
      });
  }

  onCompany(value: string) {
    this.company.set(value);
    this.load();
  }

  onType(event: Event) {
    this.type.set((event.target as HTMLSelectElement).value);
    this.load();
  }

  onFrom(event: Event) {
    this.from.set((event.target as HTMLInputElement).value);
  }

  onTo(event: Event) {
    this.to.set((event.target as HTMLInputElement).value);
  }

  onMin(event: Event) {
    this.minAmount.set((event.target as HTMLInputElement).value);
  }

  apply(event?: Event) {
    event?.preventDefault();
    this.load();
  }

  clear() {
    this.company.set('all');
    this.type.set('');
    this.from.set(isoDate(new Date(Date.now() - 90 * 86400000)));
    this.to.set(isoDate(new Date()));
    this.minAmount.set('100000');
    this.load();
  }

  money(value: unknown) {
    return compactInr(Number(value || 0));
  }

  netTone() {
    return Number(this.cards()['net'] || 0) < 0 ? 'negative' : 'positive';
  }

  text(value: unknown) {
    return value == null ? '0' : String(value);
  }

  load() {
    this.summaryRequest.cancel();
    if (this.from() && this.to() && this.from() > this.to()) {
      this.request.cancel();
      this.items.set([]);
      this.cards.set({});
      this.loading.set(false);
      this.error.set('From date must be on or before To date.');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.items.set([]);
    this.cards.set({});
    this.request.run(
      this.api.get(this.kind(), {
        company: this.company(),
        type: this.type(),
        from: this.from(),
        to: this.to(),
        minAmount: this.kind() === 'large' ? this.minAmount() : undefined,
      }),
      {
        next: (result) => {
          this.items.set(result.items || []);
          this.cards.set(result.cards || {});
          this.period.set(result.period);
          if (result.types) this.types.set(result.types);
          this.loading.set(false);
          if (!result.cards) this.loadSummary();
        },
        error: (err) => {
          this.error.set(err.error?.error || 'Unable to load report');
          this.loading.set(false);
        },
      },
    );
  }

  private loadSummary() {
    this.summaryRequest.run(
      this.api.get('summary', {
        company: this.company(),
        type: this.type(),
        from: this.from(),
        to: this.to(),
      }),
      {
        next: (result) => {
          this.cards.set(result.cards || {});
          if (result.types) this.types.set(result.types);
        },
      },
    );
  }

  exportCsv() {
    if (this.exporting() || this.loading() || this.error()) return;
    const columns = this.columns();
    this.exporting.set(true);
    downloadCsv(
      `${this.kind()}-report.csv`,
      columns.map((column) => column.label),
      this.items().map((row) => columns.map((column) => column.value(row))),
    );
    this.exporting.set(false);
  }

  rowId(row: ReportRow, index = 0) {
    return String(
      row['id'] ||
        row['date'] ||
        row['week_label'] ||
        row['month_key'] ||
        row['voucher_type'] ||
        row['party'] ||
        row['company_id'] ||
        index,
    );
  }

  private columnsFor(kind: string): DataColumn<ReportRow>[] {
    const amount = (key: string): DataColumn<ReportRow> => ({
      key,
      label:
        key === 'turnover'
          ? 'Turnover'
          : key === 'inflow'
            ? 'Receipts / sales'
            : key === 'outflow'
              ? 'Payments / purchases'
              : 'Net',
      value: (row) => fullInr(Number(row[key] || 0)),
      numeric: true,
      primary: true,
    });
    if (kind === 'daily') {
      return [
        {
          key: 'date',
          label: 'Date',
          value: (row) => String(row['date'] || '—'),
          link: (row) => ({
            path: '/transactions',
            query: {
              company: this.company(),
              type: this.type(),
              from: String(row['date']),
              to: String(row['date']),
            },
          }),
          primary: true,
        },
        {
          key: 'vouchers',
          label: 'Vouchers',
          value: (row) => String(row.vouchers || 0),
          primary: true,
        },
        amount('inflow'),
        amount('outflow'),
        amount('net'),
        amount('turnover'),
      ];
    }
    if (kind === 'weekly') {
      return [
        {
          key: 'week',
          label: 'Week',
          value: (row) => String(row['week_label'] || '—'),
          primary: true,
        },
        {
          key: 'range',
          label: 'From / to',
          value: (row) => `${row['week_start'] || ''} – ${row['week_end'] || ''}`,
        },
        {
          key: 'vouchers',
          label: 'Vouchers',
          value: (row) => String(row.vouchers || 0),
          primary: true,
        },
        amount('inflow'),
        amount('outflow'),
        amount('net'),
      ];
    }
    if (kind === 'monthly') {
      return [
        {
          key: 'month',
          label: 'Month',
          value: (row) => String(row['month_label'] || row['month_key'] || '—'),
          primary: true,
        },
        {
          key: 'vouchers',
          label: 'Vouchers',
          value: (row) => String(row.vouchers || 0),
          primary: true,
        },
        amount('inflow'),
        amount('outflow'),
        amount('net'),
        amount('turnover'),
      ];
    }
    if (kind === 'types') {
      return [
        {
          key: 'type',
          label: 'Voucher type',
          value: (row) => String(row['voucher_type'] || '—'),
          primary: true,
        },
        { key: 'flow', label: 'Class', value: (row) => String(row['flow'] || 'other') },
        {
          key: 'vouchers',
          label: 'Vouchers',
          value: (row) => String(row.vouchers || 0),
          primary: true,
        },
        amount('turnover'),
        amount('net'),
      ];
    }
    if (kind === 'parties') {
      return [
        {
          key: 'party',
          label: 'Party',
          value: (row) => String(row['party'] || '—'),
          link: (row) => ({
            path: '/transactions',
            query: {
              company: this.company(),
              type: this.type(),
              q: String(row['party'] || ''),
              from: this.from(),
              to: this.to(),
            },
          }),
          primary: true,
        },
        {
          key: 'vouchers',
          label: 'Vouchers',
          value: (row) => String(row.vouchers || 0),
          primary: true,
        },
        amount('inflow'),
        amount('outflow'),
        amount('turnover'),
      ];
    }
    if (kind === 'companies') {
      return [
        {
          key: 'company',
          label: 'Company',
          value: (row) => String(row['company_name'] || '—'),
          link: (row) => ({
            path: '/management-reports/daily',
            query: {
              company: String(row['companyId'] || row['company_id']),
              type: this.type(),
              from: this.from(),
              to: this.to(),
            },
          }),
          primary: true,
        },
        {
          key: 'vouchers',
          label: 'Vouchers',
          value: (row) => String(row.vouchers || 0),
          primary: true,
        },
        amount('inflow'),
        amount('outflow'),
        amount('net'),
        amount('turnover'),
      ];
    }
    return [
      { key: 'date', label: 'Date', value: (row) => String(row['date'] || '—'), primary: true },
      { key: 'company', label: 'Company', value: (row) => String(row['company_name'] || '—') },
      {
        key: 'type',
        label: 'Type',
        value: (row) => String(row['voucher_type'] || '—'),
        primary: true,
      },
      { key: 'party', label: 'Party', value: (row) => String(row['party'] || '—'), primary: true },
      { key: 'number', label: 'Number', value: (row) => String(row['voucher_number'] || '—') },
      {
        key: 'amount',
        label: 'Amount',
        value: (row) => fullInr(Number(row['turnover'] || row['amount'] || 0)),
        numeric: true,
        primary: true,
      },
    ];
  }
}
