import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CompanyDirectory } from '../../services/company-directory';
import { ExcelImportService } from '../../services/excel-import';
import { CompanySelect } from '../../shared/company-select';
import { DataColumn, DataTable } from '../../shared/data-table';
import { Icon } from '../../shared/icon';
import { KpiCard } from '../../shared/kpi-card';
import { fullInr } from '../../shared/money';
import { PageHeader } from '../../shared/page-header';
import { recordKey } from '../../shared/record-columns';
import { ImportNav } from './import-nav';

@Component({
  providers: [CompanyDirectory],
  selector: 'app-import-results',
  imports: [CompanySelect, DataTable, Icon, KpiCard, PageHeader, ImportNav],
  templateUrl: './import-results.html',
  styleUrl: './imports.css',
})
export class ImportResults {
  private readonly api = inject(ExcelImportService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly directory = inject(CompanyDirectory);
  readonly companies = this.directory.companies;
  readonly company = signal('all');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly cards = signal<Record<string, number>>({});
  readonly outstanding = signal<Record<string, unknown>[]>([]);
  readonly ageing = signal<Record<string, unknown>[]>([]);
  readonly gaps = signal<Record<string, unknown>[]>([]);
  readonly recordKey = recordKey;
  readonly fullInr = fullInr;
  readonly outstandingColumns: DataColumn<Record<string, unknown>>[] = [
    { key: 'account', label: 'Account', value: (row) => String(row['account_name'] || '—'), primary: true },
    { key: 'company', label: 'Company', value: (row) => String(row['company_name'] || '—') },
    { key: 'bill', label: 'Bill', value: (row) => fullInr(Number(row['bill_amount'] || 0)), numeric: true },
    { key: 'paid', label: 'Paid', value: (row) => fullInr(Number(row['paid_amount'] || 0)), numeric: true },
    {
      key: 'dr',
      label: 'Pending Dr',
      value: (row) => fullInr(Number(row['pending_bill_debit'] || 0)),
      numeric: true,
      primary: true,
    },
    { key: 'cr', label: 'Pending Cr', value: (row) => fullInr(Number(row['pending_bill_credit'] || 0)), numeric: true },
    {
      key: 'status',
      label: 'Status',
      value: (row) => String(row['recon_status'] || '—').replaceAll('_', ' '),
      primary: true,
    },
  ];
  readonly ageingColumns: DataColumn<Record<string, unknown>>[] = [
    { key: 'bucket', label: 'Ageing', value: (row) => String(row['bucket_label'] || row['ageing_bucket'] || '—'), primary: true },
    { key: 'debit', label: 'Debit', value: (row) => fullInr(Number(row['debit'] || 0)), numeric: true, primary: true },
    { key: 'credit', label: 'Credit', value: (row) => fullInr(Number(row['credit'] || 0)), numeric: true },
    { key: 'net', label: 'Net', value: (row) => fullInr(Number(row['net'] || 0)), numeric: true, primary: true },
  ];
  readonly gapColumns: DataColumn<Record<string, unknown>>[] = [
    {
      key: 'account',
      label: 'Account',
      value: (row) => String(row['account_name'] || row['tally_ledger_name'] || '—'),
      link: (row) => ({ path: `/imports/sync/${row['id']}` }),
      primary: true,
    },
    { key: 'source', label: 'Source', value: (row) => fullInr(Number(row['source_amount'] || 0)), numeric: true },
    { key: 'tally', label: 'Tally', value: (row) => fullInr(Number(row['tally_amount'] || 0)), numeric: true, primary: true },
    { key: 'diff', label: 'Difference', value: (row) => fullInr(Number(row['difference'] || 0)), numeric: true, primary: true },
    { key: 'status', label: 'Status', value: (row) => String(row['status'] || '—').replaceAll('_', ' ') },
  ];

  constructor() {
    this.load();
  }

  onCompany(value: string) {
    this.company.set(value);
    this.load();
  }

  money(value: unknown) {
    return fullInr(Number(value || 0));
  }

  text(value: unknown) {
    return value == null || value === '' ? '0' : String(value);
  }

  rowId(row: Record<string, unknown>) {
    return String(row['id'] || row['ageing_bucket'] || row['bucket_label'] || '');
  }

  private load() {
    this.loading.set(true);
    const company = this.company();
    this.api
      .summary(company)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.cards.set(data.cards || {});
          this.error.set('');
        },
        error: (err) => this.error.set(err.error?.error || 'Unable to load import results'),
      });
    this.api
      .outstanding({ company, pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => this.outstanding.set((data.items || []) as Record<string, unknown>[]),
        error: (err) => {
          this.error.set(err.error?.error || 'Unable to load outstanding');
          this.loading.set(false);
        },
      });
    this.api
      .ageing(company)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => this.ageing.set((data.buckets || []) as Record<string, unknown>[]),
      });
    this.api
      .reconciliation(company)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.gaps.set(rows || []);
          this.loading.set(false);
        },
      });
  }
}
