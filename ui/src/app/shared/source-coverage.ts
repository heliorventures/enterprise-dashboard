import { Component, effect, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SourceCompany, SourceOverview } from '../models/source';
import { DataColumn, DataTable } from './data-table';
@Component({
  selector: 'app-source-coverage',
  imports: [DataTable],
  template: `<article class="panel">
    <header>
      <div>
        <h2>Company reporting coverage</h2>
        <p>Validation and currency checks for the latest published company snapshot.</p>
      </div>
    </header>
    <app-data-table
      label="Company reporting coverage"
      [rows]="companies()"
      [columns]="columns"
      [rowKey]="companyKey"
      [loading]="loading()"
      [error]="error()"
    />
  </article>`,
})
export class SourceCoverage {
  private readonly http = inject(HttpClient);
  readonly refreshKey = input('');
  readonly companies = signal<SourceCompany[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly companyKey = (row: SourceCompany) => row.id;
  readonly columns: DataColumn<SourceCompany>[] = [
    { key: 'name', label: 'Company', value: (r) => r.name },
    {
      key: 'source',
      label: 'Reporting model',
      value: (r) => (r.batch_id ? 'Validated snapshot' : 'Unavailable'),
      primary: true,
    },
    {
      key: 'currency',
      label: 'Currency',
      value: (r) => r.currency || 'Unavailable',
      primary: true,
    },
    {
      key: 'postings',
      label: 'Vouchers with postings',
      value: (r) =>
        r.coverage
          ? `${r.coverage.vouchersWithPostings ?? 0} / ${r.coverage.vouchers ?? 0}`
          : 'Unavailable',
    },
    {
      key: 'issues',
      label: 'Validation issues',
      value: (r) => (r.batch_id ? String(r.issue_count || 0) : 'Not evaluated'),
      link: (r) => ({ path: '/operations', query: r.batch_id ? { batch: r.batch_id } : undefined }),
    },
  ];

  constructor() {
    effect((onCleanup) => {
      this.refreshKey();
      this.loading.set(true);
      this.error.set('');
      this.companies.set([]);
      const request = this.http
        .get<SourceOverview>('/api/reports/source', { params: { company: 'all' } })
        .subscribe({
          next: (report) => {
            this.companies.set(report.companies);
            this.loading.set(false);
          },
          error: () => {
            this.error.set('Unable to load reporting coverage. Use Refresh status to retry.');
            this.loading.set(false);
          },
        });
      onCleanup(() => request.unsubscribe());
    });
  }
}
