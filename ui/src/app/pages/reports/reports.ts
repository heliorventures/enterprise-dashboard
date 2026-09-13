import { NgTemplateOutlet } from '@angular/common';
import { PageDrawer } from '../../shared/page-drawer';
import { CompanyDirectory } from '../../services/company-directory';
import { SourceInsights } from '../../shared/source-insights';
import { ProjectSummary, projectActivityColumns } from '../../shared/finance-summary';
import { CompanySelect } from '../../shared/company-select';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ExpenseReport, ProjectReport, ProjectResult, VoucherRow } from '../../models/books';
import { DashboardService } from '../../services/dashboard';
import { DataColumn, DataTable, RecordLink } from '../../shared/data-table';
import { ChartRow, FinancialChart } from '../../shared/financial-chart';
import { KpiCard } from '../../shared/kpi-card';
import { PageHeader } from '../../shared/page-header';
import { LatestRequest } from '../../shared/latest-request';
import {
  balanceTone,
  cleanText,
  monthEnd,
  recordKey,
  voucherColumns,
} from '../../shared/record-columns';
import { compactInr, fullInr } from '../../shared/money';

interface ExpenseView {
  id: string;
  name: string;
  amount: number;
  ledgers: number;
  groups?: number;
  payments?: RecordLink;
  link: RecordLink;
}

@Component({
  providers: [CompanyDirectory],
  selector: 'app-reports',
  imports: [
    SourceInsights,
    NgTemplateOutlet,
    PageDrawer,
    ProjectSummary,
    CompanySelect,
    RouterLink,
    DataTable,
    FinancialChart,
    KpiCard,
    PageHeader,
  ],
  templateUrl: './reports.html',
  styleUrl: './reports.css',
})
export class Reports {
  private readonly api = inject(DashboardService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly reportRequest = new LatestRequest();
  private readonly projectRequest = new LatestRequest();
  private readonly voucherRequest = new LatestRequest();
  readonly refreshKey = signal(0);
  readonly company = signal('all');
  readonly group = signal('');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly report = signal<ExpenseReport | null>(null);
  readonly projects = signal<ProjectReport | null>(null);
  readonly projectError = signal('');
  readonly loadingProjects = signal(true);
  readonly vouchers = signal<VoucherRow[]>([]);
  readonly voucherTotal = signal(0);
  readonly loadingVouchers = signal(false);
  readonly voucherError = signal('');
  private readonly directory = inject(CompanyDirectory);
  readonly companies = this.directory.companies;
  readonly compactInr = compactInr;
  readonly fullInr = fullInr;
  readonly lastMonthEnd = monthEnd;
  readonly recordKey = recordKey;
  readonly voucherColumns = voucherColumns;
  readonly selectedCompany = computed(() =>
    this.report()?.companies.find((r) => r.id === this.company()),
  );
  readonly selectedGroup = computed(() =>
    this.selectedCompany()?.groups.find((r) => r.name === this.group()),
  );
  readonly level = computed(() =>
    this.group() ? 'ledgers' : this.company() !== 'all' ? 'groups' : 'companies',
  );
  readonly expenseRows = computed<ExpenseView[]>(() => {
    if (this.group())
      return (this.selectedGroup()?.ledgers || []).map((r) => ({
        id: String(r.id),
        name: cleanText(r.name),
        amount: r.balance,
        ledgers: 1,
        payments: {
          path: '/transactions',
          query: {
            company: r.companyId,
            q: r.name,
            from: this.report()!.lastMonth.from,
            to: monthEnd(this.report()!.lastMonth.from),
          },
        },
        link: { path: '/ledgers', query: { company: r.companyId, group: r.group, q: r.name } },
      }));
    if (this.company() !== 'all')
      return (this.selectedCompany()?.groups || []).map((r) => ({
        id: r.name,
        name: cleanText(r.name),
        amount: r.total,
        ledgers: r.ledgerCount,
        link: { path: '/reports', query: { company: this.company(), group: r.name } },
      }));
    return (this.report()?.companies || []).map((r) => ({
      id: r.id,
      name: r.name,
      amount: r.total,
      ledgers: r.ledgerCount,
      groups: r.groups.length,
      link: { path: '/reports', query: { company: r.id } },
    }));
  });
  readonly expenseTotal = computed(() => this.expenseRows().reduce((sum, r) => sum + r.amount, 0));
  readonly expenseChart = computed<ChartRow[]>(() => {
    const rows = [...this.expenseRows()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const result: ChartRow[] = rows.slice(0, 6).map((r) => ({
      key: r.id,
      label: r.name,
      link: r.link,
      values: [{ label: 'On books', value: r.amount }],
    }));
    if (rows.length > 6)
      result.push({
        key: '__remaining',
        label: `Remaining ${rows.length - 6} entries`,
        values: [
          {
            label: 'Combined on books',
            value: rows.slice(6).reduce((sum, r) => sum + r.amount, 0),
            tone: 'muted',
          },
        ],
      });
    return result;
  });
  readonly projectRows = computed(
    () => this.projects()?.companies.flatMap((c) => c.projects) || [],
  );
  readonly projectChart = computed<ChartRow[]>(() =>
    [...this.projectRows()]
      .filter((r) => r.withAmount > 0)
      .sort((a, b) => a.net - b.net)
      .slice(0, 6)
      .map((r) => ({
        key: r.id,
        label: r.name,
        note: `${r.companyName} · ${r.withAmount}/${r.voucherCount} vouchers have non-zero amounts`,
        link: { path: '/transactions', query: { company: r.companyId, q: r.name } },
        values: [{ label: 'Earned less invested (voucher model)', value: r.net, tone: 'positive' }],
      })),
  );
  readonly expenseColumns = computed<DataColumn<ExpenseView>[]>(() => [
    { key: 'name', label: 'Company / group / ledger', value: (r) => r.name, link: (r) => r.link },
    ...(this.level() === 'companies'
      ? [
          {
            key: 'groups',
            label: 'Groups',
            value: (r: ExpenseView) => String(r.groups),
            primary: true,
          },
        ]
      : []),
    {
      key: 'amount',
      label: 'On books',
      value: (r) => fullInr(r.amount),
      numeric: true,
      primary: true,
    },
    { key: 'ledgers', label: 'Ledgers', value: (r) => String(r.ledgers), primary: true },
    ...(this.level() === 'ledgers'
      ? [
          {
            key: 'payments',
            label: 'Payments / activity',
            value: () => 'Review matching vouchers',
            link: (r: ExpenseView) => r.payments!,
            primary: true,
          },
        ]
      : []),
  ]);
  readonly projectColumns = projectActivityColumns;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.reportRequest.cancel();
      this.projectRequest.cancel();
      this.voucherRequest.cancel();
    });

    let previousCompany: string | undefined;
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const company = params.get('company') || 'all';
      this.company.set(company);
      this.group.set(params.get('group') || '');
      if (company === previousCompany) return;
      previousCompany = company;
      this.load();
    });
  }
  load() {
    this.refreshKey.update((value) => value + 1);
    this.loading.set(true);
    this.error.set('');
    this.report.set(null);
    this.projects.set(null);
    this.vouchers.set([]);
    this.voucherTotal.set(0);
    this.voucherError.set('');
    this.voucherRequest.cancel();
    this.reportRequest.run(this.api.getExpenseReport(this.company()), {
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
        this.loadVouchers(report);
      },
      error: () => {
        this.error.set('Expense data could not be loaded. Retry to view this selection.');
        this.loading.set(false);
      },
    });
    this.loadingProjects.set(true);
    this.projectError.set('');
    this.projectRequest.run(this.api.getProjectReport(this.company()), {
      next: (report) => {
        this.projects.set(report);
        this.loadingProjects.set(false);
      },
      error: () => {
        this.projectError.set('Project data could not be loaded.');
        this.loadingProjects.set(false);
      },
    });
  }
  private loadVouchers(report: ExpenseReport) {
    this.loadingVouchers.set(true);
    this.voucherRequest.run(
      this.api.getVouchers({
        company: this.company(),
        from: report.lastMonth.from,
        to: monthEnd(report.lastMonth.from),
        page: 1,
        pageSize: 25,
      }),
      {
        next: (result) => {
          this.vouchers.set(result.items);
          this.voucherTotal.set(result.total);
          this.loadingVouchers.set(false);
        },
        error: () => {
          this.voucherError.set('Voucher activity could not be loaded.');
          this.loadingVouchers.set(false);
        },
      },
    );
  }
  onCompany(value: string) {
    void this.router.navigate(['/reports'], { queryParams: { company: value } });
  }
}
