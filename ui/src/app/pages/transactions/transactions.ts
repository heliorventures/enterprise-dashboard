import { CompanyDirectory } from '../../services/company-directory';
import { FilterPanel } from '../../shared/filter-panel';
import { CompanySelect } from '../../shared/company-select';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DataTable } from '../../shared/data-table';
import { PageHeader } from '../../shared/page-header';
import { LatestRequest } from '../../shared/latest-request';
import { voucherColumns, recordKey } from '../../shared/record-columns';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DashboardService } from '../../services/dashboard';
import { VoucherRow } from '../../models/books';
import { compactInr, fullInr } from '../../shared/money';
import { downloadCsv } from '../../shared/csv';
import { Icon } from '../../shared/icon';
import { Pager } from '../../shared/pager';

@Component({
  providers: [CompanyDirectory],
  selector: 'app-transactions',
  imports: [FilterPanel, CompanySelect, DataTable, PageHeader, Pager, Icon],
  templateUrl: './transactions.html',
  styleUrl: './transactions.css',
})
export class Transactions {
  private readonly api = inject(DashboardService);
  private readonly route = inject(ActivatedRoute);

  private readonly request = new LatestRequest();
  readonly columns = voucherColumns;
  readonly recordKey = recordKey;

  readonly company = signal('all');
  readonly query = signal('');
  readonly search = signal('');
  readonly type = signal('');
  readonly from = signal('');
  readonly to = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(25);
  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly error = signal('');
  readonly total = signal(0);
  readonly items = signal<VoucherRow[]>([]);
  readonly types = signal<string[]>([]);
  private readonly directory = inject(CompanyDirectory);
  readonly companies = this.directory.companies;

  readonly compactInr = compactInr;
  readonly fullInr = fullInr;

  readonly selectedCompanyName = computed(() => {
    if (this.company() === 'all') {
      return '';
    }
    return this.companies().find((item) => item.id === this.company())?.name || '';
  });

  readonly filterSummary = computed(() =>
    [
      this.selectedCompanyName() ||
        (this.company() === 'all' ? 'All companies' : 'Selected company'),
      this.query(),
      this.type(),
      this.from(),
      this.to(),
    ]
      .filter(Boolean)
      .join(' / '),
  );

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.company.set(params.get('company') || 'all');
      this.query.set(params.get('q') || '');
      this.search.set(this.query());
      this.type.set(params.get('type') || '');
      this.from.set(params.get('from') || '');
      this.to.set(params.get('to') || '');
      this.page.set(1);
      this.load();
    });
  }

  load() {
    if (this.from() && this.to() && this.from() > this.to()) {
      this.request.cancel();
      this.items.set([]);
      this.total.set(0);
      this.loading.set(false);
      this.error.set('From date must be on or before To date.');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.items.set([]);
    this.total.set(0);
    this.request.run(
      this.api.getVouchers({
        company: this.company(),
        q: this.query(),
        type: this.type(),
        from: this.from(),
        to: this.to(),
        page: this.page(),
        pageSize: this.pageSize(),
      }),
      {
        next: (result) => {
          this.items.set(result.items);
          this.total.set(result.total);
          this.types.set(result.types || []);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.error || 'Unable to load transactions.');
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
    this.query.set('');
    this.search.set('');
    this.type.set('');
    this.from.set('');
    this.to.set('');
    this.page.set(1);
    this.load();
  }

  onCompany(value: string) {
    this.company.set(value);
    this.type.set('');
    this.apply();
  }

  onType(event: Event) {
    this.type.set((event.target as HTMLSelectElement).value);
    this.apply();
  }

  onQuery(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
  }

  onFrom(event: Event) {
    this.from.set((event.target as HTMLInputElement).value);
    this.apply();
  }

  onTo(event: Event) {
    this.to.set((event.target as HTMLInputElement).value);
    this.apply();
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

  clean(value: string) {
    return (value || '').replace(/\u0004/g, '').trim();
  }

  exportCsv() {
    if (this.exporting() || this.loading() || this.error()) return;
    this.exporting.set(true);
    this.api
      .getVouchers({
        company: this.company(),
        q: this.query(),
        type: this.type(),
        from: this.from(),
        to: this.to(),
        page: 1,
        pageSize: 20000,
      })
      .subscribe({
        next: (result) => {
          if (result.total > result.items.length) {
            this.error.set(
              'Export exceeds the 20,000-row limit. Narrow the filters to export a complete file; no partial file was downloaded.',
            );
            this.exporting.set(false);
            return;
          }
          downloadCsv(
            'transactions.csv',
            [
              'Date',
              'Voucher type',
              'Voucher no',
              'Company',
              'Party',
              'Project',
              'Narration',
              'Amount',
            ],
            result.items.map((row) => [
              String(row.date || '').slice(0, 10),
              row.type,
              row.number,
              row.companyName,
              row.party,
              row.project,
              row.narration,
              row.amount,
            ]),
          );
          this.exporting.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.error || 'Unable to export transactions.');
          this.exporting.set(false);
        },
      });
  }
}
