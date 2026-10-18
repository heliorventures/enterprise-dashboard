import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { CompanyDirectory } from '../../services/company-directory';
import {
  ExcelImportService,
  ProjectRow,
  ProjectSuggestion,
  ProjectSummary,
} from '../../services/excel-import';
import { CompanySelect } from '../../shared/company-select';
import { Icon } from '../../shared/icon';
import { KpiCard } from '../../shared/kpi-card';
import { LatestRequest } from '../../shared/latest-request';
import { PageHeader } from '../../shared/page-header';
import { importDate } from './import-columns';
import { importMoney } from './import-money';
import { ImportNav } from './import-nav';
import { ImportProjectReport } from './import-project-report';

@Component({
  providers: [CompanyDirectory],
  selector: 'app-import-projects',
  imports: [CompanySelect, Icon, KpiCard, PageHeader, ImportNav, ImportProjectReport, RouterLink],
  templateUrl: './import-projects.html',
  styleUrl: './imports.css',
})
export class ImportProjects {
  private readonly api = inject(ExcelImportService);
  private readonly directory = inject(CompanyDirectory);
  private readonly request = new LatestRequest();
  readonly companies = this.directory.companies;
  readonly company = signal('all');
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly summary = signal<ProjectSummary | null>(null);
  readonly suggestions = signal<ProjectSuggestion[]>([]);

  readonly name = signal('');
  readonly tallyProjectId = signal('');
  readonly budget = signal('');
  readonly target = signal('');
  readonly keywords = signal('');

  readonly rows = computed<ProjectRow[]>(() => {
    const data = this.summary();
    return data ? [...data.projects, data.unassigned] : [];
  });
  readonly gapParties = computed(() =>
    this.rows().reduce((sum, row) => sum + row.differences + row.tallyOnlyLedgers, 0),
  );
  readonly coveragePct = computed(() => {
    const coverage = this.summary()?.coverage;
    return coverage && coverage.total ? Math.round((coverage.assigned / coverage.total) * 100) : 0;
  });

  constructor() {
    effect(() => {
      const list = this.companies();
      untracked(() => {
        if (this.company() === 'all' && list.length) {
          this.company.set(list[0].id);
          this.load();
        }
      });
    });
  }

  money(value: unknown) {
    return importMoney(value, this.summary()?.currency);
  }

  date(value: unknown) {
    return importDate(value);
  }

  budgetLabel(row: ProjectRow) {
    if (row.budgetStatus === 'ON_TRACK') return 'On track';
    if (row.budgetStatus === 'AT_RISK') return 'Budget nearly used';
    if (row.budgetStatus === 'OVER_BUDGET') return 'Over budget';
    return 'No budget set';
  }

  healthLabel(row: ProjectRow) {
    if (row.health === 'IN_SYNC') return 'In sync with Tally';
    if (row.health === 'HAS_GAPS') return 'Gaps to review';
    if (row.health === 'COMPARISON_UNAVAILABLE') return 'Comparison unavailable';
    return 'No parties yet';
  }

  meter(row: ProjectRow) {
    return Math.min(100, Math.max(0, row.budgetUsedPct ?? 0));
  }

  link(row: ProjectRow) {
    return ['/imports/projects', row.id || 'unassigned'];
  }

  onCompany(value: string) {
    this.company.set(value);
    this.notice.set('');
    this.load();
  }

  load() {
    if (this.company() === 'all') return;
    this.loading.set(true);
    this.error.set('');
    this.request.run(this.api.projects(this.company()), {
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
        this.api.projectSuggestions(this.company()).subscribe({
          next: (items) => this.suggestions.set(items),
          error: () => this.suggestions.set([]),
        });
      },
      error: (err) => {
        this.summary.set(null);
        this.suggestions.set([]);
        this.error.set(err.error?.error || 'Unable to load projects');
        this.loading.set(false);
      },
    });
  }

  setField(field: 'name' | 'tallyProjectId' | 'budget' | 'target' | 'keywords', event: Event) {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this[field].set(value);
  }

  private run<T>(action: Observable<T>, done: (result: T) => string) {
    this.busy.set(true);
    this.error.set('');
    action.subscribe({
      next: (result) => {
        this.notice.set(done(result));
        this.busy.set(false);
        this.load();
      },
      error: (err) => {
        this.error.set(err.error?.error || 'Unable to save the project');
        this.busy.set(false);
      },
    });
  }

  create(event?: Event) {
    event?.preventDefault();
    const keywords = this.keywords()
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    this.run(
      this.api.createProject(this.company(), {
        name: this.name(),
        tallyProjectId: this.tallyProjectId() ? Number(this.tallyProjectId()) : null,
        budgetExpense: this.budget() || null,
        targetRevenue: this.target() || null,
        keywords,
      }),
      (result) => {
        this.name.set('');
        this.tallyProjectId.set('');
        this.budget.set('');
        this.target.set('');
        this.keywords.set('');
        return `Project created. ${result.assigned} Excel parties were placed in projects by keyword.`;
      },
    );
  }

  createFromSuggestion(item: ProjectSuggestion) {
    const name = item.tallyProjectName || item.keyword;
    this.run(
      this.api.createProject(this.company(), {
        name,
        tallyProjectId: item.tallyProjectId ?? null,
        keywords: [item.keyword],
      }),
      (result) => `Created “${name}”. ${result.assigned} Excel parties were placed in it.`,
    );
  }

  applyRules() {
    this.run(this.api.applyProjectRules(this.company()), (result) =>
      result.changed
        ? `Updated ${result.changed} parties from the keywords.`
        : 'Everything already follows the keywords.',
    );
  }
}