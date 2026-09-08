import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { DashboardService } from '../../services/dashboard';
import { CompanyOption, VoucherRow } from '../../models/books';
import { compactInr, fullInr } from '../../shared/money';
import { downloadCsv } from '../../shared/csv';
import { Pager } from '../../shared/pager';

@Component({
  selector: 'app-transactions',
  imports: [DatePipe, Pager],
  templateUrl: './transactions.html',
  styleUrl: './transactions.css',
})
export class Transactions {
  private readonly api = inject(DashboardService);

  readonly company = signal('all');
  readonly query = signal('');
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
  readonly companies = signal<CompanyOption[]>([]);

  readonly compactInr = compactInr;
  readonly fullInr = fullInr;

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
      .getVouchers({
        company: this.company(),
        q: this.query(),
        type: this.type(),
        from: this.from(),
        to: this.to(),
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .subscribe({
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
    this.type.set('');
    this.from.set('');
    this.to.set('');
    this.page.set(1);
    this.load();
  }

  onCompany(event: Event) {
    this.company.set((event.target as HTMLSelectElement).value);
    this.type.set('');
    this.apply();
  }

  onType(event: Event) {
    this.type.set((event.target as HTMLSelectElement).value);
    this.apply();
  }

  onQuery(event: Event) {
    this.query.set((event.target as HTMLInputElement).value);
    this.apply();
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

  exportCsv() {
    this.exporting.set(true);
    this.api
      .getVouchers({
        company: this.company(),
        q: this.query(),
        type: this.type(),
        from: this.from(),
        to: this.to(),
        page: 1,
        pageSize: 5000,
      })
      .subscribe({
        next: (result) => {
          downloadCsv(
            'transactions.csv',
            ['Date', 'Voucher type', 'Voucher no', 'Company', 'Party', 'Project', 'Narration', 'Amount'],
            result.items.map((row) => [
              String(row.date || '').slice(0, 10),
              row.type,
              row.number,
              row.companyName,
              row.party,
              row.project,
              row.narration,
              row.amount,
            ])
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
