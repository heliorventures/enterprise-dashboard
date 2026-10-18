import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CompanyDirectory } from '../../services/company-directory';
import { ExcelImportService, ProjectRow, ProjectSummary } from '../../services/excel-import';
import { CompanySelect } from '../../shared/company-select';
import { Icon } from '../../shared/icon';
import { KpiCard } from '../../shared/kpi-card';
import { LatestRequest } from '../../shared/latest-request';
import { PageHeader } from '../../shared/page-header';
import { importDate } from './import-columns';
import { importMoney } from './import-money';
import { ImportNav } from './import-nav';
import { ImportProjectReport } from './import-project-report';

const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);

/** One page for the VP: per project, how far it is, what is paid, what is left, and the Tally gap. */
@Component({
  providers: [CompanyDirectory],
  selector: 'app-import-project-summary',
  imports: [CompanySelect, Icon, KpiCard, PageHeader, ImportNav, ImportProjectReport, RouterLink],
  templateUrl: './import-project-summary.html',
  styleUrl: './imports.css',
})
export class ImportProjectSummary {
  private readonly api = inject(ExcelImportService);
  private readonly directory = inject(CompanyDirectory);
  private readonly request = new LatestRequest();
  readonly companies = this.directory.companies;
  readonly company = signal('all');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly summary = signal<ProjectSummary | null>(null);

  /** Real projects first, then the parties that are not in any project yet. */
  readonly rows = computed<ProjectRow[]>(() => {
    const data = this.summary();
    if (!data) return [];
    const loose = data.unassigned.parties + data.unassigned.tallyOnlyLedgers > 0 ? [data.unassigned] : [];
    return [...data.projects, ...loose];
  });

  readonly totals = computed(() => {
    const rows = this.rows();
    const add = (pick: (row: ProjectRow) => string | null) => rows.reduce((sum, row) => sum + cents(pick(row)), 0) / 100;
    return {
      billed: add((row) => row.billed),
      paid: add((row) => row.paid),
      pending: add((row) => row.pending),
      excel: add((row) => row.excelAmount),
      tally: add((row) => row.tallyAmount),
      gapCount: rows.reduce((sum, row) => sum + row.differences + row.tallyOnlyLedgers, 0),
    };
  });
  readonly paidPct = computed(() => {
    const totals = this.totals();
    return totals.billed > 0 ? Math.round((totals.paid / totals.billed) * 100) : null;
  });
  readonly net = computed(() => Math.round((this.totals().excel - this.totals().tally) * 100) / 100);

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

  onCompany(value: string) {
    this.company.set(value);
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
      },
      error: (err) => {
        this.summary.set(null);
        this.error.set(err.error?.error || 'Unable to load the project summary');
        this.loading.set(false);
      },
    });
  }

  print() {
    window.print();
  }

  money(value: unknown) {
    return importMoney(value, this.summary()?.currency);
  }

  date(value: unknown) {
    return importDate(value);
  }

  link(row: ProjectRow) {
    return ['/imports/projects', row.id || 'unassigned'];
  }

  meter(value: number | null) {
    return Math.min(100, Math.max(0, value ?? 0));
  }

  /** Plain words for the Excel vs Tally difference. */
  compare(net: unknown) {
    if (net == null || !Number.isFinite(Number(net))) return '';
    const gap = Number(net);
    if (gap === 0) return 'Excel and Tally show the same total.';
    return `Excel is ${this.money(Math.abs(gap))} ${gap > 0 ? 'higher' : 'lower'} than Tally.`;
  }

  /** How many parties differ, and how many Tally ledgers have no Excel party. */
  gapText(row: ProjectRow) {
    const parts: string[] = [];
    if (row.differences) parts.push(`${row.differences} ${row.differences === 1 ? 'party differs' : 'parties differ'}`);
    if (row.tallyOnlyLedgers) {
      parts.push(`${row.tallyOnlyLedgers} ${row.tallyOnlyLedgers === 1 ? 'Tally ledger is' : 'Tally ledgers are'} not in Excel`);
    }
    return parts.length ? `${parts.join(', and ')}.` : '';
  }

  budgetText(row: ProjectRow) {
    if (!row.id) return 'Not placed in a project yet';
    if (row.budgetUsedPct === null) return 'No budget set. Set one on the project page to see progress.';
    return `${row.budgetUsedPct}% of the ${this.money(row.budgetExpense)} budget is billed`;
  }

  budgetLabel(row: ProjectRow) {
    if (row.budgetStatus === 'ON_TRACK') return 'On track';
    if (row.budgetStatus === 'AT_RISK') return 'Budget nearly used';
    if (row.budgetStatus === 'OVER_BUDGET') return 'Over budget';
    return 'No budget set';
  }

  healthLabel(row: ProjectRow) {
    if (row.health === 'IN_SYNC') return 'Agrees with Tally';
    if (row.health === 'HAS_GAPS') return 'Differs from Tally';
    if (row.health === 'COMPARISON_UNAVAILABLE') return 'Cannot compare yet';
    return 'No parties yet';
  }
}
