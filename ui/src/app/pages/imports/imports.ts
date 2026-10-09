import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ExcelImportRow, ExcelImportService } from '../../services/excel-import';
import { DataColumn, DataTable } from '../../shared/data-table';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { recordKey } from '../../shared/record-columns';
import { ImportNav } from './import-nav';

@Component({
  selector: 'app-imports',
  imports: [RouterLink, DataTable, Icon, PageHeader, ImportNav],
  templateUrl: './imports.html',
  styleUrl: './imports.css',
})
export class Imports {
  private readonly api = inject(ExcelImportService);
  private readonly destroyRef = inject(DestroyRef);
  readonly recordKey = recordKey;
  readonly loading = signal(true);
  readonly error = signal('');
  readonly items = signal<ExcelImportRow[]>([]);
  readonly columns: DataColumn<ExcelImportRow>[] = [
    {
      key: 'file',
      label: 'File',
      value: (row) => row.file_name,
      link: (row) => ({ path: `/imports/${row.id}` }),
      primary: true,
    },
    { key: 'company', label: 'Company', value: (row) => row.company_name || row.detected_company || '—' },
    { key: 'rows', label: 'Detail rows', value: (row) => String(row.detail_rows ?? row.total_rows ?? '—'), primary: true },
    { key: 'ok', label: 'Valid', value: (row) => String(row.successful_rows ?? '—') },
    { key: 'fail', label: 'Errors', value: (row) => String(row.failed_rows ?? '—') },
    {
      key: 'status',
      label: 'Status',
      value: (row) => {
        const status = (row.status || '—').replaceAll('_', ' ');
        if (row.status === 'PROCESSING' && row.progress_percent != null) {
          return `${status} ${row.progress_percent}%`;
        }
        return status;
      },
      secondary: (row) => row.progress_message || '',
      primary: true,
    },
    {
      key: 'uploaded',
      label: 'Uploaded',
      value: (row) => (row.uploaded_at ? new Date(row.uploaded_at).toLocaleString('en-IN') : '—'),
    },
  ];

  constructor() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.items.set(rows || []);
          this.error.set('');
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.error || 'Unable to load Excel imports');
          this.loading.set(false);
        },
      });
  }
}
