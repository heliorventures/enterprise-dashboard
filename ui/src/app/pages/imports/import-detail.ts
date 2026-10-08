import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Subscription, interval, startWith, switchMap } from 'rxjs';
import { ExcelImportService } from '../../services/excel-import';
import { DataColumn, DataTable } from '../../shared/data-table';
import { Icon } from '../../shared/icon';
import { KpiCard } from '../../shared/kpi-card';
import { fullInr } from '../../shared/money';
import { PageHeader } from '../../shared/page-header';
import { recordKey } from '../../shared/record-columns';
import { ImportNav } from './import-nav';

interface IssueRow {
  id: string;
  source_row_number: number;
  validation_status: string;
  errors: unknown;
}

@Component({
  selector: 'app-import-detail',
  imports: [DataTable, Icon, KpiCard, PageHeader, ImportNav],
  templateUrl: './import-detail.html',
  styleUrl: './imports.css',
})
export class ImportDetail {
  private readonly api = inject(ExcelImportService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly recordKey = recordKey;
  readonly fullInr = fullInr;
  readonly loading = signal(true);
  readonly error = signal('');
  readonly title = signal('Import');
  readonly companyName = signal('');
  readonly description = signal('');
  readonly batch = signal<Record<string, unknown> | null>(null);
  readonly progressPercent = signal(0);
  readonly progressLabel = signal('');
  readonly progressActive = signal(false);
  readonly reconciliation = signal<{ status: string; count: number; difference: number }[]>([]);
  readonly issues = signal<IssueRow[]>([]);
  private pollSub?: Subscription;
  readonly reconColumns: DataColumn<{ status: string; count: number; difference: number }>[] = [
    { key: 'status', label: 'Status', value: (row) => row.status.replaceAll('_', ' '), primary: true },
    { key: 'count', label: 'Count', value: (row) => String(row.count), primary: true },
    { key: 'diff', label: 'Difference', value: (row) => fullInr(row.difference), numeric: true },
  ];
  readonly issueColumns: DataColumn<IssueRow>[] = [
    { key: 'row', label: 'Row', value: (row) => String(row.source_row_number), primary: true },
    { key: 'status', label: 'Status', value: (row) => row.validation_status, primary: true },
    { key: 'errors', label: 'Errors', value: (row) => JSON.stringify(row.errors) },
  ];

  constructor() {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.destroyRef.onDestroy(() => this.pollSub?.unsubscribe());
    this.api
      .get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.title.set(String(data.file?.['fileName'] || data.file?.['file_name'] || 'Import'));
          this.companyName.set(data.companyName || '');
          this.description.set(String(data.file?.['detectedTitle'] || data.file?.['detected_title'] || ''));
          this.batch.set(data.batch || null);
          this.reconciliation.set(data.reconciliation || []);
          this.loading.set(false);
          const status = String(data.file?.['status'] || data.batch?.['status'] || '');
          if (status === 'PROCESSING') this.watchProgress(id);
        },
        error: (err) => {
          this.error.set(err.error?.error || 'Unable to load import');
          this.loading.set(false);
        },
      });
    this.api
      .errors(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) =>
          this.issues.set(
            (rows || []).map((row, index) => ({
              id: String(row.source_row_number) + '-' + index,
              ...row,
            })),
          ),
      });
  }

  private watchProgress(id: string) {
    this.pollSub?.unsubscribe();
    this.progressActive.set(true);
    this.pollSub = interval(900)
      .pipe(
        startWith(0),
        switchMap(() => this.api.progress(id)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (state) => {
          this.progressPercent.set(state.percent);
          this.progressLabel.set(state.message || state.status);
          if (state.batch) this.batch.set(state.batch);
          if (state.reconciliation?.length) this.reconciliation.set(state.reconciliation);
          if (state.status === 'COMPLETED' || state.batchStatus === 'COMPLETED' || state.status === 'FAILED') {
            this.progressActive.set(false);
            this.pollSub?.unsubscribe();
            if (state.status === 'FAILED') this.error.set(state.error || 'Processing failed');
          }
        },
      });
  }

  number(value: unknown) {
    return Number(value || 0);
  }

  text(value: unknown) {
    return value == null || value === '' ? '0' : String(value);
  }
}
