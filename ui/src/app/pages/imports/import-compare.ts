import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, interval, startWith, switchMap } from 'rxjs';
import {
  ExcelImportProgress,
  ExcelImportRow,
  ExcelImportService,
  ExcelValidationIssue,
  ImportRecord,
  ImportReconciliationSummary,
} from '../../services/excel-import';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { ImportNav } from './import-nav';
import { importMoney } from './import-money';
import { KpiCard } from '../../shared/kpi-card';

interface ImportComparison {
  file: Record<string, unknown>;
  companyName?: string;
  currency?: string | null;
  batch?: Record<string, unknown>;
  reconciliation?: ImportReconciliationSummary[];
  accounts?: ImportRecord[];
  tallyOnly?: ImportRecord[];
  notes?: string[];
}

@Component({
  selector: 'app-import-compare',
  imports: [Icon, KpiCard, PageHeader, ImportNav, RouterLink],
  templateUrl: './import-compare.html',
  styleUrl: './imports.css',
})
export class ImportCompare {
  private readonly api = inject(ExcelImportService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private pollSub?: Subscription;

  readonly files = signal<ExcelImportRow[]>([]);
  readonly selectedFileId = signal('');
  readonly comparison = signal<ImportComparison | null>(null);
  readonly validationIssues = signal<ExcelValidationIssue[]>([]);
  readonly loadingFiles = signal(true);
  readonly busy = signal(false);
  readonly progress = signal<ExcelImportProgress | null>(null);
  readonly error = signal('');
  readonly notice = signal('');
  readonly accountSearch = signal('');
  readonly categoryFilter = signal('all');
  readonly statusFilter = signal('all');
  readonly differencesOnly = signal(false);
  readonly accountRows = computed(() => this.comparison()?.accounts || []);
  readonly categories = computed(() => [...new Set(
    this.accountRows()
      .map((row) => String(row['level_1_category'] || '').trim())
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b)));
  readonly filteredRows = computed(() => {
    const query = this.accountSearch().trim().toLocaleLowerCase();
    const category = this.categoryFilter();
    const status = this.statusFilter();
    return this.accountRows().filter((row) => {
      const accountName = String(row['account_name'] || '').toLocaleLowerCase();
      const tallyName = String(row['tally_ledger_name'] || '').toLocaleLowerCase();
      const rowCategory = String(row['level_1_category'] || '');
      const rowStatus = String(row['status'] || 'COMPARISON_UNAVAILABLE');
      return (!query || accountName.includes(query) || tallyName.includes(query))
        && (category === 'all' || rowCategory === category)
        && (status === 'all' || rowStatus === status)
        && (!this.differencesOnly() || rowStatus !== 'MATCHED');
    });
  });
  readonly countByStatus = computed(() => {
    const counts = new Map<string, number>();
    for (const row of this.accountRows()) {
      const status = String(row['status'] || 'COMPARISON_UNAVAILABLE');
      counts.set(status, (counts.get(status) || 0) + 1);
    }
    return [...counts.entries()].map(([status, count]) => ({ status, count }));
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.pollSub?.unsubscribe());
    this.selectedFileId.set(this.route.snapshot.queryParamMap.get('file') || '');
    this.loadFiles();
  }

  loadFiles() {
    this.loadingFiles.set(true);
    this.error.set('');
    this.api.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (files) => {
        this.files.set(files || []);
        this.loadingFiles.set(false);
        if (!this.selectedFileId() && files?.length) {
          this.selectedFileId.set(files[0].id);
        }
      },
      error: (err) => {
        this.loadingFiles.set(false);
        this.error.set(err.error?.error || 'Unable to load uploaded files.');
      },
    });
  }

  selectFile(event: Event) {
    this.selectedFileId.set((event.target as HTMLSelectElement).value);
    this.comparison.set(null);
    this.validationIssues.set([]);
    this.progress.set(null);
    this.notice.set('');
    this.error.set('');
    this.clearFilters();
  }

  compare() {
    const id = this.selectedFileId();
    if (!id || this.busy()) return;
    this.pollSub?.unsubscribe();
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    this.comparison.set(null);
    this.validationIssues.set([]);
    this.progress.set({ fileId: id, status: 'ANALYZED', percent: 5, message: 'Preparing comparison…' });
    this.api.get(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        if (data.batch?.['status'] === 'COMPLETED') {
          this.showComparison(data);
          this.busy.set(false);
          return;
        }
        this.validateAndProcess(id);
      },
      error: (err) => this.fail(err, 'Unable to load the selected workbook.'),
    });
  }

  private validateAndProcess(id: string) {
    this.progress.set({ fileId: id, status: 'VALIDATED', percent: 25, message: 'Checking workbook accounts…' });
    this.api.validate(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (validation) => {
        this.validationIssues.set(validation.issues || []);
        if (!validation.canProcess || validation.errors > 0 || validation.missingRequired?.length || validation.total <= 0) {
          this.busy.set(false);
          this.progress.set(null);
          this.error.set(validation.errors
            ? `${validation.errors} workbook row(s) need correction before comparison.`
            : 'This workbook is missing required account or balance columns.');
          return;
        }
        this.progress.set({ fileId: id, status: 'PROCESSING', percent: 40, message: 'Comparing with the Tally snapshot…' });
        this.api.process(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (state) => {
            this.applyProgress(state);
            if (state.status === 'COMPLETED' || state.batchStatus === 'COMPLETED') this.loadComparison(id);
            else if (state.status === 'FAILED' || state.batchStatus === 'FAILED') {
              this.busy.set(false);
              this.error.set(state.error || 'Comparison failed.');
            } else this.watchProgress(id);
          },
          error: (err) => this.fail(err, 'Unable to start the comparison.'),
        });
      },
      error: (err) => this.fail(err, 'Unable to validate the selected workbook.'),
    });
  }

  private watchProgress(id: string) {
    this.pollSub?.unsubscribe();
    this.pollSub = interval(900).pipe(
      startWith(0),
      switchMap(() => this.api.progress(id)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (state) => {
        this.applyProgress(state);
        if (state.status === 'COMPLETED' || state.batchStatus === 'COMPLETED') {
          this.pollSub?.unsubscribe();
          this.loadComparison(id);
        } else if (state.status === 'FAILED' || state.batchStatus === 'FAILED') {
          this.pollSub?.unsubscribe();
          this.busy.set(false);
          this.error.set(state.error || 'Comparison failed.');
        }
      },
      error: (err) => {
        this.pollSub?.unsubscribe();
        this.fail(err, 'Unable to follow comparison progress.');
      },
    });
  }

  private applyProgress(state: ExcelImportProgress) {
    this.progress.set(state);
  }

  private loadComparison(id: string) {
    this.api.get(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.showComparison(data);
        this.busy.set(false);
        this.progress.set(null);
      },
      error: (err) => this.fail(err, 'Comparison finished, but its results could not be loaded.'),
    });
  }

  private showComparison(data: ImportComparison) {
    this.comparison.set(data);
    this.progress.set(null);
    const rows = data.accounts || [];
    const incomparable = rows.filter((row) => row['status'] === 'COMPARISON_UNAVAILABLE').length;
    this.notice.set(`${rows.length} Excel accounts compared with ${data.companyName || 'the selected company'}${incomparable ? `. ${incomparable} account comparisons are unavailable because their dates or currencies do not match.` : '.'}`);
  }

  private fail(err: { error?: { error?: string } }, fallback: string) {
    this.busy.set(false);
    this.progress.set(null);
    this.error.set(err.error?.error || fallback);
  }

  money(value: unknown, currency?: unknown) {
    return importMoney(value, currency || this.comparison()?.currency || null);
  }

  label(status: unknown) {
    const value = String(status || 'COMPARISON_UNAVAILABLE');
    if (value === 'MATCHED') return 'In sync';
    if (value === 'AMOUNT_MISMATCH') return 'Amount differs';
    if (value === 'MISSING_IN_TALLY') return 'Missing in Tally';
    if (value === 'MISSING_IN_SOURCE') return 'Missing in Excel';
    if (value === 'PARTIALLY_MATCHED') return 'Possible match';
    if (value === 'COMPARISON_UNAVAILABLE') return 'Cannot compare';
    return value.replaceAll('_', ' ');
  }

  setSearch(event: Event) {
    this.accountSearch.set((event.target as HTMLInputElement).value);
  }

  setCategory(event: Event) {
    this.categoryFilter.set((event.target as HTMLSelectElement).value);
  }

  setStatus(event: Event) {
    this.statusFilter.set((event.target as HTMLSelectElement).value);
  }

  toggleDifferences(event: Event) {
    this.differencesOnly.set((event.target as HTMLInputElement).checked);
  }

  clearFilters() {
    this.accountSearch.set('');
    this.categoryFilter.set('all');
    this.statusFilter.set('all');
    this.differencesOnly.set(false);
  }

  get hasFilters() {
    return Boolean(this.accountSearch().trim())
      || this.categoryFilter() !== 'all'
      || this.statusFilter() !== 'all'
      || this.differencesOnly();
  }

  basisMessage() {
    const row = this.accountRows().find((item) => item['status'] === 'COMPARISON_UNAVAILABLE');
    if (!row) return '';
    const excelDate = row['reporting_date'] ? String(row['reporting_date']).slice(0, 10) : 'not stated';
    const tallyDate = row['tally_balance_date'] ? String(row['tally_balance_date']).slice(0, 10) : 'not recorded';
    const excelCurrency = row['source_currency'] || 'unspecified';
    const tallyCurrency = row['tally_currency'] || 'unspecified';
    return `Some differences are withheld: Excel is dated ${excelDate} (${excelCurrency}); Tally is dated ${tallyDate} (${tallyCurrency}). Comparisons require matching dates and confirmed currencies.`;
  }

  fileLabel(file: ExcelImportRow) {
    const uploaded = file.uploaded_at ? new Date(file.uploaded_at).toLocaleString('en-IN') : 'date unknown';
    return `${file.file_name} · ${file.company_name || file.detected_company || 'Company unknown'} · ${uploaded} · ${file.status.replaceAll('_', ' ')}`;
  }
}
