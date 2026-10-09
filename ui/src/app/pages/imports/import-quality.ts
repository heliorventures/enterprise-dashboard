import { Component, inject, signal } from '@angular/core';
import { CompanyDirectory } from '../../services/company-directory';
import { ExcelImportService, ImportQuality } from '../../services/excel-import';
import { CompanySelect } from '../../shared/company-select';
import { DataColumn, DataTable } from '../../shared/data-table';
import { KpiCard } from '../../shared/kpi-card';
import { LatestRequest } from '../../shared/latest-request';
import { PageHeader } from '../../shared/page-header';
import { ImportExport } from './import-export';
import { ImportNav } from './import-nav';

interface QualityIssue {
  type: string;
  count: number;
}

@Component({
  providers: [CompanyDirectory],
  selector: 'app-import-quality',
  imports: [CompanySelect, DataTable, KpiCard, PageHeader, ImportNav, ImportExport],
  template: `
    <section class="grid-page">
      <app-page-header
        title="Data quality"
        eyebrow="Excel imports"
        description="Missing identifiers and payment dates in imported data."
      >
        <app-company-select
          [companies]="companies()"
          [value]="company()"
          (companyChange)="onCompany($event)"
        />
      </app-page-header>
      <app-import-nav />
      @if (error()) {
        <p class="banner" role="alert">{{ error() }}</p>
      }
      @if (loading()) {
        <p class="empty" role="status">Loading quality…</p>
      }
      <section class="kpi-grid">
        @for (metric of metrics; track metric.key) {
          <app-kpi-card [label]="metric.label" [value]="count(metric.key)" icon="warning" />
        }
      </section>
      <article class="grid-card">
        <div class="grid-toolbar">
          <div>
            <h2>Issue types</h2>
            <p>Counts from the selected company's imported data and recorded exceptions.</p>
          </div>
          <app-import-export type="quality" [company]="company()" />
        </div>
        <app-data-table
          label="Data quality issues"
          [rows]="data()?.issues || []"
          [columns]="columns"
          [rowKey]="issueKey"
          [loading]="loading()"
          [error]="error()"
          empty="No recorded data quality issues."
        />
      </article>
    </section>
  `,
  styleUrl: './imports.css',
})
export class ImportQualityView {
  private readonly api = inject(ExcelImportService);
  private readonly directory = inject(CompanyDirectory);
  private readonly request = new LatestRequest();
  readonly companies = this.directory.companies;
  readonly company = signal('all');
  readonly data = signal<ImportQuality | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly metrics = [
    { key: 'accounts', label: 'Accounts' },
    { key: 'outstanding_rows', label: 'Outstanding rows' },
    { key: 'missing_gst', label: 'Missing GST' },
    { key: 'missing_pan', label: 'Missing PAN' },
    { key: 'missing_msme', label: 'Missing MSME' },
    { key: 'missing_payment_date', label: 'Missing payment date' },
  ];
  readonly columns: DataColumn<QualityIssue>[] = [
    { key: 'type', label: 'Issue', value: (row) => row.type.replaceAll('_', ' '), primary: true },
    {
      key: 'count',
      label: 'Count',
      value: (row) => String(row.count),
      numeric: true,
      primary: true,
    },
  ];
  readonly issueKey = (row: QualityIssue) => row.type;

  constructor() {
    this.load();
  }
  count(key: string) {
    return this.loading() || this.error() ? '—' : String(this.data()?.[key] ?? 0);
  }
  onCompany(value: string) {
    this.company.set(value);
    this.load();
  }
  load() {
    this.loading.set(true);
    this.error.set('');
    this.data.set(null);
    this.request.run(this.api.quality(this.company()), {
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.error || 'Unable to load data quality');
        this.loading.set(false);
      },
    });
  }
}
