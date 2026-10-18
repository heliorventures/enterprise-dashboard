import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { ExcelImportService, ImportRecord, ProjectDetail, ProjectHistoryItem } from '../../services/excel-import';
import { Icon } from '../../shared/icon';
import { LatestRequest } from '../../shared/latest-request';
import { PageHeader } from '../../shared/page-header';
import { comparisonMoney, importDate } from './import-columns';
import { importMoney } from './import-money';
import { ImportNav } from './import-nav';

@Component({
  selector: 'app-import-project-detail',
  imports: [Icon, PageHeader, ImportNav, RouterLink],
  templateUrl: './import-project-detail.html',
  styleUrl: './imports.css',
})
export class ImportProjectDetail {
  private readonly api = inject(ExcelImportService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly request = new LatestRequest();
  readonly projectId = this.route.snapshot.paramMap.get('id') || 'unassigned';
  readonly company = this.route.snapshot.queryParamMap.get('company') || 'all';
  readonly isUnassigned = this.projectId === 'unassigned';

  readonly detail = signal<ProjectDetail | null>(null);
  readonly history = signal<ProjectHistoryItem[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly status = signal('differences');
  readonly search = signal('');
  readonly query = signal('');

  readonly name = signal('');
  readonly tallyProjectId = signal('');
  readonly budget = signal('');
  readonly target = signal('');
  readonly keyword = signal('');

  readonly title = computed(() => this.detail()?.project?.name || 'Not assigned to a project');
  readonly statuses = [
    { id: 'differences', label: 'Gaps only' },
    { id: 'all', label: 'All parties' },
    { id: 'AMOUNT_MISMATCH', label: 'Amount differs' },
    { id: 'MISSING_IN_TALLY', label: 'Not in Tally' },
    { id: 'PARTIALLY_MATCHED', label: 'Needs confirmation' },
    { id: 'MATCHED', label: 'In sync' },
  ];

  constructor() {
    this.load();
  }

  date(value: unknown) {
    return importDate(value);
  }

  /** Progress by upload: this project as it stood in every Excel file imported. */
  private loadHistory() {
    this.api.projectHistory(this.company, this.projectId).subscribe({
      next: (data) => this.history.set(data.items),
      error: () => this.history.set([]),
    });
  }

  histMoney(value: unknown, row: ProjectHistoryItem) {
    return importMoney(value, row.currency);
  }

  money(value: unknown, currency: unknown) {
    return importMoney(value, currency);
  }

  gap(value: unknown, currency: unknown) {
    return comparisonMoney(value, currency);
  }

  statusLabel(status: unknown) {
    const value = String(status || '');
    if (value === 'MATCHED') return 'Same in Excel and Tally';
    if (value === 'AMOUNT_MISMATCH') return 'Amount differs';
    if (value === 'MISSING_IN_TALLY') return 'In Excel, not in Tally';
    if (value === 'MISSING_IN_SOURCE') return 'In Tally, not in Excel';
    if (value === 'PARTIALLY_MATCHED') return 'Needs confirmation';
    if (value === 'COMPARISON_UNAVAILABLE') return 'Comparison unavailable';
    return value ? value.replaceAll('_', ' ') : '—';
  }

  sourceLabel(row: ImportRecord) {
    if (row['project_source'] === 'MANUAL') return 'Moved by you';
    if (row['project_source'] === 'RULE') return 'By keyword';
    return '—';
  }

  load() {
    this.loading.set(true);
    this.error.set('');
    this.loadHistory();
    this.request.run(
      this.api.projectDetail(this.company, this.projectId, {
        status: this.status(),
        q: this.query(),
      }),
      {
        next: (detail) => {
          this.detail.set(detail);
          const project = detail.project;
          if (project) {
            this.name.set(project.name);
            this.tallyProjectId.set(project.tally_project_id ? String(project.tally_project_id) : '');
            this.budget.set(project.budget_expense ?? '');
            this.target.set(project.target_revenue ?? '');
          }
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.error || 'Unable to load this project');
          this.loading.set(false);
        },
      },
    );
  }

  onStatus(id: string) {
    this.status.set(id);
    this.load();
  }

  onSearch(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
  }

  applySearch(event?: Event) {
    event?.preventDefault();
    this.query.set(this.search());
    this.load();
  }

  setField(field: 'name' | 'tallyProjectId' | 'budget' | 'target' | 'keyword', event: Event) {
    this[field].set((event.target as HTMLInputElement | HTMLSelectElement).value);
  }

  private act<T>(action: Observable<T>, message: string, after?: () => void) {
    this.busy.set(true);
    this.error.set('');
    action.subscribe({
      next: () => {
        this.notice.set(message);
        this.busy.set(false);
        if (after) after();
        else this.load();
      },
      error: (err) => {
        this.error.set(err.error?.error || 'Unable to save the change');
        this.busy.set(false);
      },
    });
  }

  save(event?: Event) {
    event?.preventDefault();
    const project = this.detail()?.project;
    if (!project) return;
    this.act(
      this.api.updateProject(project.id, {
        name: this.name(),
        tallyProjectId: this.tallyProjectId() ? Number(this.tallyProjectId()) : null,
        budgetExpense: this.budget() || null,
        targetRevenue: this.target() || null,
      }),
      'Project saved.',
    );
  }

  addKeyword(event?: Event) {
    event?.preventDefault();
    const project = this.detail()?.project;
    if (!project || !this.keyword().trim()) return;
    const word = this.keyword().trim();
    this.act(this.api.addProjectRule(project.id, word), `Keyword “${word}” added. Matching parties moved into this project.`, () => {
      this.keyword.set('');
      this.load();
    });
  }

  removeKeyword(ruleId: string, word: string) {
    this.act(this.api.deleteProjectRule(ruleId), `Keyword “${word}” removed.`);
  }

  move(row: ImportRecord, event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    this.act(
      this.api.assignProject(String(row['account_id']), value || null),
      value ? `Moved ${row['account_name']}.` : `${row['account_name']} now follows the keywords.`,
    );
  }

  remove() {
    const project = this.detail()?.project;
    if (!project) return;
    if (!window.confirm(`Delete project “${project.name}”? Its parties return to “Not assigned”.`)) return;
    this.act(this.api.deleteProject(project.id), 'Project deleted.', () =>
      this.router.navigate(['/imports/projects']),
    );
  }

  rowId(row: ImportRecord) {
    return String(row['account_id'] ?? row['reconciliation_id']);
  }
}
