import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { Subscription, interval, startWith, switchMap } from 'rxjs';
import { CompanyDirectory } from '../../services/company-directory';
import {
  ExcelColumn,
  ExcelField,
  ExcelImportProgress,
  ExcelImportService,
  ExcelUploadResult,
  ExcelValidation,
} from '../../services/excel-import';
import { Icon } from '../../shared/icon';
import { fullInr } from '../../shared/money';
import { PageHeader } from '../../shared/page-header';
import { ImportNav } from './import-nav';

@Component({
  providers: [CompanyDirectory],
  selector: 'app-import-wizard',
  imports: [RouterLink, Icon, PageHeader, ImportNav],
  templateUrl: './import-wizard.html',
  styleUrl: './imports.css',
})
export class ImportWizard {
  private readonly api = inject(ExcelImportService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly directory = inject(CompanyDirectory);
  readonly companies = this.directory.companies;
  readonly step = signal(1);
  readonly companyId = signal('');
  readonly fileName = signal('');
  readonly busy = signal('');
  readonly error = signal('');
  readonly progressPercent = signal(0);
  readonly progressLabel = signal('');
  readonly progressActive = signal(false);
  readonly result = signal<ExcelUploadResult | null>(null);
  readonly fields = signal<ExcelField[]>([]);
  readonly validation = signal<ExcelValidation | null>(null);
  readonly processed = signal<{
    file: { id: string };
    batch: Record<string, unknown>;
    reconciliation: { status: string; count: number; difference: number }[];
  } | null>(null);
  private file: File | null = null;
  private pollSub?: Subscription;
  readonly fullInr = fullInr;
  readonly steps = [
    { id: 1, label: 'Choose company and file' },
    { id: 2, label: 'Check, then import' },
    { id: 3, label: 'See what matched' },
  ];
  readonly currentTitle = computed(() => this.steps[this.step() - 1]?.label || 'Upload Excel');
  readonly accountNameColumn = computed(
    () =>
      this.result()?.analysis.columns?.find((col) => col.target === 'account_name')?.canonical ||
      '',
  );
  readonly sampleNames = computed(() => {
    const analysis = this.result()?.analysis;
    const key = this.accountNameColumn();
    return (analysis?.preview || [])
      .slice(0, 8)
      .map((row) => String((key ? row.raw[key] : '') ?? '—'));
  });
  readonly canImport = computed(() => Boolean(this.accountNameColumn()) && !this.busy());

  constructor() {
    this.api
      .fields()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (rows) => this.fields.set(rows || []) });
    this.destroyRef.onDestroy(() => this.stopPoll());
  }

  onCompany(event: Event) {
    this.companyId.set((event.target as HTMLSelectElement).value);
  }

  onFile(event: Event) {
    this.file = (event.target as HTMLInputElement).files?.[0] || null;
    this.fileName.set(this.file?.name || '');
  }

  analysis() {
    return this.result()?.analysis;
  }

  reconLabel(status: string) {
    if (status === 'MATCHED') return 'Same in Excel and Tally';
    if (status === 'AMOUNT_MISMATCH') return 'Amount differs';
    if (status === 'MISSING_IN_TALLY') return 'In Excel, not in Tally';
    if (status === 'MISSING_IN_SOURCE') return 'In Tally, not in Excel';
    if (status === 'PARTIALLY_MATCHED') return 'Partly matched';
    return status.replaceAll('_', ' ');
  }

  totalLabel(status: unknown) {
    const value = String(status || '');
    if (value === 'SOURCE_TOTAL_VALIDATED') return 'Excel total matches the rows';
    if (value === 'SOURCE_TOTAL_MISMATCH') return 'Excel total does not match the rows';
    if (value === 'SOURCE_TOTAL_ABSENT') return 'File has no total row';
    return value.replaceAll('_', ' ') || 'Imported';
  }

  issueText(code: string, field?: string, label?: string) {
    const name = label || field || 'field';
    if (code === 'UNMAPPED_REQUIRED') return `Choose the column for ${name}`;
    if (code === 'REQUIRED_FIELD') return `Missing ${name.replaceAll('_', ' ')}`;
    if (code === 'INVALID_DECIMAL') return `Invalid number in ${name.replaceAll('_', ' ')}`;
    if (code === 'INVALID_DATE') return `Invalid date in ${name.replaceAll('_', ' ')}`;
    if (code === 'INVALID_INTEGER') return `Invalid integer in ${name.replaceAll('_', ' ')}`;
    if (code === 'MISSING_GST') return 'GST number is required by the current rule';
    return code.replaceAll('_', ' ');
  }

  private ensureAccountMapping(data: ExcelUploadResult): ExcelUploadResult {
    const columns = data.analysis?.columns || [];
    if (columns.some((col) => col.target === 'account_name')) return data;
    const named = columns.find((col) =>
      /particular|ledger|party|account|name/i.test(col.canonical),
    );
    const pick = named || columns[0];
    if (pick) {
      pick.target = 'account_name';
      pick.unmapped = false;
    }
    return data;
  }

  private setProgress(percent: number, label: string, active = true) {
    this.progressPercent.set(Math.max(0, Math.min(100, percent)));
    this.progressLabel.set(label);
    this.progressActive.set(active);
    this.busy.set(active ? label : '');
  }

  private stopPoll() {
    this.pollSub?.unsubscribe();
    this.pollSub = undefined;
  }

  startOver() {
    if (this.busy()) return;
    this.stopPoll();
    this.step.set(1);
    this.result.set(null);
    this.validation.set(null);
    this.processed.set(null);
    this.error.set('');
    this.setProgress(0, '', false);
  }

  upload() {
    if (this.busy()) return;
    if (!this.companyId()) {
      this.error.set('Choose the company this Excel belongs to.');
      return;
    }
    if (!this.file) {
      this.error.set('Choose the Excel file.');
      return;
    }
    this.error.set('');
    this.validation.set(null);
    this.setProgress(8, 'Reading Excel…');
    this.api
      .upload(this.file, this.companyId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          if (event.phase !== 'done') {
            this.setProgress(event.percent, event.message);
            return;
          }
          const data = event.result;
          if (!data) {
            this.setProgress(0, '', false);
            this.error.set('The file could not be read.');
            return;
          }
          this.result.set(this.ensureAccountMapping(data));
          this.step.set(2);
          this.setProgress(0, '', false);
          if (data.companyMismatch) {
            this.error.set(
              `The file header says "${data.analysis?.company?.company || 'another company'}". The import will still use ${data.selectedCompany?.name}, which you selected.`,
            );
          }
        },
        error: (err) => {
          this.setProgress(0, '', false);
          this.error.set(err.error?.error || 'The file could not be read.');
        },
      });
  }

  setAccountNameColumn(event: Event) {
    if (this.busy()) return;
    this.validation.set(null);
    const canonical = (event.target as HTMLSelectElement).value;
    this.result.update((current) => {
      if (!current?.analysis.columns) return current;
      for (const col of current.analysis.columns) {
        if (col.canonical === canonical) {
          col.target = 'account_name';
          col.unmapped = false;
        } else if (col.target === 'account_name') {
          col.target = null;
          col.unmapped = true;
        }
      }
      return { ...current };
    });
  }

  setTarget(col: ExcelColumn, event: Event) {
    if (this.busy()) return;
    this.validation.set(null);
    const target = (event.target as HTMLSelectElement).value || null;
    this.result.update((current) => {
      if (!current?.analysis.columns) return current;
      for (const item of current.analysis.columns) {
        if (item === col) {
          item.target = target;
          item.unmapped = !target;
        } else if (target === 'account_name' && item.target === 'account_name') {
          item.target = null;
          item.unmapped = true;
        }
      }
      return { ...current };
    });
  }

  importFile() {
    if (this.busy() || this.processed()) return;
    const current = this.result();
    if (!current) return;
    if (!this.accountNameColumn()) {
      this.error.set('Choose which Excel column has the party or ledger names.');
      return;
    }
    const mappings = (current.analysis.columns || []).map((col) => ({
      sourceHeader: col.canonical,
      targetField: col.target || null,
    }));
    this.error.set('');
    this.setProgress(40, 'Checking the rows…');
    this.api
      .mapping(current.file.id, mappings)
      .pipe(
        switchMap(() => this.api.validate(current.file.id)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (value) => {
          this.validation.set(value);
          if (
            !value.canProcess ||
            value.errors > 0 ||
            value.missingRequired?.length ||
            value.total <= 0
          ) {
            this.setProgress(0, '', false);
            this.error.set(
              value.errors
                ? `${value.errors} row(s) need a fix before this file can be imported.`
                : 'Choose which column has the party or ledger names.',
            );
            return;
          }
          this.setProgress(70, 'Importing and comparing with Tally…');
          this.api
            .process(current.file.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (state) => {
                this.applyProgress(state);
                if (this.busy()) this.watchProcess(current.file.id);
              },
              error: (err) => {
                this.setProgress(0, '', false);
                this.error.set(err.error?.error || 'Import failed.');
              },
            });
        },
        error: (err) => {
          this.setProgress(0, '', false);
          this.error.set(err.error?.error || 'The file could not be checked.');
        },
      });
  }

  private watchProcess(id: string) {
    this.stopPoll();
    this.pollSub = interval(900)
      .pipe(
        startWith(0),
        switchMap(() => this.api.progress(id)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (state) => this.applyProgress(state),
        error: (err) => {
          this.setProgress(0, '', false);
          this.error.set(err.error?.error || 'Could not follow import progress.');
        },
      });
  }

  private applyProgress(state: ExcelImportProgress) {
    const overall = 70 + Math.round((Number(state.percent) || 0) * 0.3);
    this.setProgress(state.status === 'COMPLETED' ? 100 : overall, state.message || 'Importing…');
    if (state.validation) this.validation.set(state.validation);
    if (state.status === 'COMPLETED' || state.batchStatus === 'COMPLETED') {
      this.stopPoll();
      this.processed.set({
        file: { id: state.fileId },
        batch: state.batch || {},
        reconciliation: state.reconciliation || [],
      });
      this.step.set(3);
      this.setProgress(100, 'Import finished', false);
      return;
    }
    if (state.status === 'FAILED' || state.batchStatus === 'FAILED') {
      this.stopPoll();
      this.setProgress(100, state.error || 'Import failed', false);
      this.error.set(state.error || 'Import failed.');
    }
  }

  openImport() {
    const id = this.processed()?.file?.id || this.result()?.file?.id;
    if (id) void this.router.navigate(['/imports', id]);
  }
}
