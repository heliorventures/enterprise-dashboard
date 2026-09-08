import { Component, computed, inject, signal } from '@angular/core';
import { DashboardService } from '../../services/dashboard';
import { CompanyOption, LedgerRow } from '../../models/books';
import { compactInr, drCr, fullInr } from '../../shared/money';
import { downloadCsv } from '../../shared/csv';
import { Pager } from '../../shared/pager';

@Component({
  selector: 'app-ledgers',
  imports: [Pager],
  templateUrl: './ledgers.html',
  styleUrl: './ledgers.css',
})
export class Ledgers {
  private readonly api = inject(DashboardService);

  readonly company = signal('all');
  readonly query = signal('');
  readonly group = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(25);
  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly error = signal('');
  readonly total = signal(0);
  readonly items = signal<LedgerRow[]>([]);
  readonly groups = signal<string[]>([]);
  readonly companies = signal<CompanyOption[]>([]);

  readonly compactInr = compactInr;
  readonly fullInr = fullInr;
  readonly drCr = drCr;

  readonly selectedCompanyName = computed(() => {
    if (this.company() === 'all') {
      return '';
    }
    return this.companies().find((item) => item.id === this.company())?.name || '';
  });

  constructor() {
    this.api.getDashboard('all').subscribe({
      next: (dashboard) => this.companies.set(dashboard.companies),
      error: () => undefined,
    });
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set('');
    this.api
      .getLedgers({
        company: this.company(),
        q: this.query(),
        group: this.group(),
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .subscribe({
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
      });
  }

  apply(event?: Event) {
    event?.preventDefault();
    this.page.set(1);
    this.load();
  }

  clear() {
    this.company.set('all');
    this.query.set('');
    this.group.set('');
    this.page.set(1);
    this.load();
  }

  onCompany(event: Event) {
    this.company.set((event.target as HTMLSelectElement).value);
    this.group.set('');
    this.apply();
  }

  onGroup(event: Event) {
    this.group.set((event.target as HTMLSelectElement).value);
    this.apply();
  }

  onQuery(event: Event) {
    this.query.set((event.target as HTMLInputElement).value);
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

  exportCsv() {
    this.exporting.set(true);
    this.api
      .getLedgers({
        company: this.company(),
        q: this.query(),
        group: this.group(),
        page: 1,
        pageSize: 5000,
      })
      .subscribe({
        next: (result) => {
          downloadCsv(
            'ledgers.csv',
            ['Company', 'Ledger', 'Group', 'Closing balance', 'Dr/Cr'],
            result.items.map((row) => [
              row.companyName,
              row.name,
              row.group,
              row.balance,
              this.drCr(row.balance),
            ])
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
}
