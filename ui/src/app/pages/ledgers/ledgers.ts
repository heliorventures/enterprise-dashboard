import { CompanyDirectory } from '../../services/company-directory';
import { FilterPanel } from '../../shared/filter-panel';
import { CompanySelect } from '../../shared/company-select';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DataTable } from '../../shared/data-table';
import { PageHeader } from '../../shared/page-header';
import { LatestRequest } from '../../shared/latest-request';
import { ledgerColumns, recordKey } from '../../shared/record-columns';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DashboardService } from '../../services/dashboard';
import { LedgerRow } from '../../models/books';
import { compactInr, drCr, fullInr } from '../../shared/money';
import { downloadCsv } from '../../shared/csv';
import { Icon } from '../../shared/icon';
import { Pager } from '../../shared/pager';

@Component({
  providers: [CompanyDirectory],
  selector: 'app-ledgers',
  imports: [FilterPanel, CompanySelect, DataTable, PageHeader, Pager, Icon],
  templateUrl: './ledgers.html',
  styleUrl: './ledgers.css',
})
export class Ledgers {
  private readonly api = inject(DashboardService);
  private readonly route = inject(ActivatedRoute);

  private readonly request = new LatestRequest();
  readonly columns = ledgerColumns;
  readonly recordKey = recordKey;

  readonly company = signal('all');
  readonly query = signal('');
  readonly search = signal('');
  readonly group = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(25);
  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly error = signal('');
  readonly total = signal(0);
  readonly items = signal<LedgerRow[]>([]);
  readonly groups = signal<string[]>([]);
  private readonly directory = inject(CompanyDirectory);
  readonly companies = this.directory.companies;

  readonly compactInr = compactInr;
  readonly fullInr = fullInr;
  readonly drCr = drCr;

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
      this.group(),
    ]
      .filter(Boolean)
      .join(' / '),
  );

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.company.set(params.get('company') || 'all');
      this.group.set(params.get('group') || '');
      this.query.set(params.get('q') || '');
      this.search.set(this.query());
      this.page.set(1);
      this.load();
    });
  }

  load() {
    this.loading.set(true);
    this.error.set('');
    this.items.set([]);
    this.total.set(0);
    this.request.run(
      this.api.getLedgers({
        company: this.company(),
        q: this.query(),
        group: this.group(),
        page: this.page(),
        pageSize: this.pageSize(),
      }),
      {
        next: (result) => {
          this.items.set(result.items);
          this.total.set(result.total);
          this.groups.set(result.groups || []);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.error || 'Unable to load ledgers.');
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
    this.group.set('');
    this.page.set(1);
    this.load();
  }

  onCompany(value: string) {
    this.company.set(value);
    this.group.set('');
    this.apply();
  }

  onGroup(event: Event) {
    this.group.set((event.target as HTMLSelectElement).value);
    this.apply();
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

  exportCsv() {
    if (this.exporting() || this.loading() || this.error()) return;
    this.exporting.set(true);
    this.api
      .getLedgers({
        company: this.company(),
        q: this.query(),
        group: this.group(),
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
            'ledgers.csv',
            ['Company', 'Ledger', 'Group', 'Closing balance', 'Dr/Cr'],
            result.items.map((row) => [
              row.companyName,
              row.name,
              row.group,
              row.balance,
              this.drCr(row.balance),
            ]),
          );
          this.exporting.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.error || 'Unable to export ledgers.');
          this.exporting.set(false);
        },
      });
  }

  abs(value: number) {
    return Math.abs(value);
  }

  clean(value: string) {
    return (value || '').replace(/\u0004/g, '').trim();
  }
}
