import { SourceInsights } from '../../shared/source-insights';
import {
  ProjectSummary,
  projectActivityColumns,
  reportedMoney,
} from '../../shared/finance-summary';
import { CompanySelect } from '../../shared/company-select';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DashboardService } from '../../services/dashboard';
import {
  BankAccount,
  CompanyFinancial,
  CompanyFunds,
  DashboardData,
  LedgerGroupTotal,
} from '../../models/dashboard';
import { DataColumn, DataTable } from '../../shared/data-table';
import { ChartRow, FinancialChart } from '../../shared/financial-chart';
import { KpiCard } from '../../shared/kpi-card';
import { PageHeader } from '../../shared/page-header';
import { LatestRequest } from '../../shared/latest-request';
import { balanceTone, cleanText, recordKey } from '../../shared/record-columns';
import { compactInr, fullInr } from '../../shared/money';

@Component({
  selector: 'app-dashboard',
  imports: [
    SourceInsights,
    ProjectSummary,
    CompanySelect,
    DatePipe,
    RouterLink,
    DataTable,
    FinancialChart,
    KpiCard,
    PageHeader,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private readonly api = inject(DashboardService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly request = new LatestRequest();
  readonly selectedCompany = signal('all');
  readonly companies = signal<DashboardData['companies']>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly data = signal<DashboardData | null>(null);
  readonly funds = computed(() => this.data()?.funds);
  readonly selectedLabel = computed(() =>
    this.selectedCompany() === 'all'
      ? 'All companies · combined, before eliminations'
      : this.companies().find((c) => c.id === this.selectedCompany())?.name || 'Selected company',
  );
  readonly compactInr = compactInr;
  readonly fullInr = fullInr;
  readonly recordKey = recordKey;
  readonly accountKey = (r: BankAccount) => `${r.companyId}:${r.kind}:${r.name}`;

  readonly kpis = computed(() => {
    const d = this.data();
    if (!d) return [];
    const f = d.funds;
    const hasBooks = d.books?.ledgerCount > 0;
    return [
      {
        key: 'cash',
        label: 'Cash & bank on books',
        value: f && hasBooks ? f.cashAndBank : null,
        icon: 'bank',
        hint: 'Reported ledger balances; confirm bank availability.',
        tone: 'neutral',
      },
      {
        key: 'revenue',
        label: 'Revenue on books',
        value: hasBooks ? d.kpis.revenue : null,
        icon: 'reports',
        hint: 'Sales and income ledger balances; source period.',
        tone: 'neutral',
      },
      {
        key: 'profit',
        label: 'Revenue less expenses',
        value: hasBooks ? d.kpis.profit : null,
        icon: 'overview',
        hint: 'Ledger-based result; not audited net profit.',
        tone: balanceTone(d.kpis.profit),
      },
      {
        key: 'headroom',
        label: 'Cash less payables',
        value: f && hasBooks ? f.cashAndBank - f.payables : null,
        icon: 'payables',
        hint: 'Before future spending; payment due dates unavailable.',
        tone: f ? balanceTone(f.cashAndBank - f.payables) : 'neutral',
      },
      {
        key: 'receivables',
        label: 'Receivables on books',
        value: f && hasBooks ? f.receivables : null,
        icon: 'receivables',
        hint: 'Collection opportunity; overdue amount unavailable.',
        tone: 'neutral',
      },
      {
        key: 'forecast',
        label: '3-month model balance',
        value: f && hasBooks && f.runRate.monthsUsed > 0 ? f.afterThreeMonths : null,
        icon: 'forecast',
        hint: 'Indicative run-rate estimate; not a cash-flow statement.',
        tone: f ? balanceTone(f.afterThreeMonths) : 'neutral',
      },
    ];
  });

  readonly priorities = computed(() => {
    const d = this.data();
    if (!d) return [];
    const f = d.funds;
    const rows: {
      title: string;
      detail: string;
      path: string;
      query: Record<string, string>;
      action: string;
      tone: string;
    }[] = [];
    if (!d.lastSync || !['ok', 'success', 'completed'].includes(d.lastSync.Status.toLowerCase()))
      rows.push({
        title: 'Verify data freshness',
        detail:
          'A successful latest import is not confirmed. Check the source before relying on these figures.',
        path: '/operations',
        query: {},
        action: 'Review imports',
        tone: 'warning',
      });
    if (f && f.cashAndBank < f.payables)
      rows.push({
        title: `${compactInr(f.payables - f.cashAndBank)} cash-to-payables gap`,
        detail:
          'Recorded payables exceed cash and bank balances. Review obligations and their payment dates.',
        path: '/ledgers',
        query: { company: this.selectedCompany(), q: 'Creditor' },
        action: 'Review payables',
        tone: 'negative',
      });
    if (f && f.afterThreeMonths < 0)
      rows.push({
        title: 'Model projects a funding gap',
        detail: `${fullInr(-f.afterThreeMonths)} below zero after three model months. Validate collections and spending assumptions.`,
        path: '/reports',
        query: { company: this.selectedCompany() },
        action: 'Review expenses',
        tone: 'negative',
      });
    if (f && f.receivables > 0)
      rows.push({
        title: `${compactInr(f.receivables)} to review for collection`,
        detail:
          'Customer ledger balances are not aged here. Confirm recoverability and expected receipt dates.',
        path: '/ledgers',
        query: { company: this.selectedCompany(), q: 'Debtor' },
        action: 'Review receivables',
        tone: 'neutral',
      });
    if (!f || f.runRate.method === 'ledgers')
      rows.push({
        title: 'Forecast needs source validation',
        detail: 'Monthly estimates use ledger balances because usable voucher activity is limited.',
        path: '/operations',
        query: {},
        action: 'Check data',
        tone: 'warning',
      });
    return rows;
  });

  readonly activityRows = computed<ChartRow[]>(() => {
    const f = this.funds();
    return (f?.history || []).slice(-6).map((r) => ({
      key: r.key,
      label: r.label,
      note: 'Recorded voucher activity',
      values: [
        { label: 'Receipts / sales / credit notes', value: r.inflow },
        { label: 'Payments / purchases / debit notes', value: r.expenses, tone: 'muted' },
      ],
    }));
  });
  readonly forecastRows = computed<ChartRow[]>(() =>
    (this.funds()?.forecast || [])
      .filter((r) => Number.isFinite(r.closingCash))
      .map((r) => ({
        key: r.key,
        label: r.label,
        note: 'Estimate',
        values: [{ label: 'Model closing balance', value: r.closingCash! }],
      })),
  );
  readonly companyRows = computed<ChartRow[]>(() =>
    (this.data()?.companyFinancials || [])
      .filter((r) => r.ledgerCount > 0)
      .map((r) => ({
        key: r.id,
        label: r.name,
        link: { path: '/reports', query: { company: r.id } },
        values: [
          { label: 'Revenue', value: r.revenue },
          { label: 'Expenses', value: r.expenses, tone: 'muted' },
          { label: 'Revenue less expenses', value: r.profit, tone: 'positive' },
        ],
      })),
  );
  readonly liquidityRows = computed<ChartRow[]>(() => {
    const f = this.funds();
    if (!f || !this.data()?.books.ledgerCount) return [];
    return [
      { key: 'cash', label: 'Cash & bank', values: [{ label: 'On books', value: f.cashAndBank }] },
      {
        key: 'payables',
        label: 'Payables',
        values: [{ label: 'Obligations on books', value: f.payables, tone: 'muted' }],
      },
      {
        key: 'headroom',
        label: 'Cash less payables',
        values: [
          { label: 'Before future spending', value: f.cashAndBank - f.payables, tone: 'positive' },
        ],
      },
    ];
  });
  readonly reportedMoney = reportedMoney;
  readonly projectColumns = projectActivityColumns;
  readonly groupKey = (r: LedgerGroupTotal) => r.name;
  readonly groupColumns: DataColumn<LedgerGroupTotal>[] = [
    {
      key: 'name',
      label: 'Ledger group',
      value: (r) => r.name,
      link: (r) => ({
        path: '/ledgers',
        query: { company: this.selectedCompany(), group: r.name },
      }),
    },
    { key: 'count', label: 'Ledgers', value: (r) => String(r.count), primary: true },
    {
      key: 'balance',
      label: 'Signed closing balance',
      value: (r) => fullInr(r.balance),
      numeric: true,
      primary: true,
    },
  ];
  readonly fundTotalRows = computed(() => {
    const rows = this.funds()?.byCompany || [];
    if (!rows.length) return [];
    return [
      {
        id: '__total',
        name: 'Combined company totals',
        bank: rows.reduce((n, r) => n + r.bank, 0),
        lastMonthExpenses: rows.reduce((n, r) => n + r.lastMonthExpenses, 0),
        lastMonthInflow: rows.every((r) => r.lastMonthInflow != null)
          ? rows.reduce((n, r) => n + r.lastMonthInflow!, 0)
          : undefined,
        nextMonthNeed: rows.reduce((n, r) => n + r.nextMonthNeed, 0),
      },
    ];
  });
  readonly totalColumns: DataColumn<{
    id: string;
    name: string;
    bank: number;
    lastMonthExpenses: number;
    lastMonthInflow?: number;
    nextMonthNeed: number;
  }>[] = [
    { key: 'name', label: 'Scope', value: (r) => r.name },
    {
      key: 'bank',
      label: 'Bank balance',
      value: (r) => reportedMoney(r.bank),
      numeric: true,
      primary: true,
    },
    {
      key: 'spend',
      label: 'Last-month spend / estimate',
      value: (r) => reportedMoney(r.lastMonthExpenses),
      numeric: true,
      primary: true,
    },
    {
      key: 'receipts',
      label: 'Last-month inflow activity',
      value: (r) => reportedMoney(r.lastMonthInflow),
      numeric: true,
      primary: true,
    },
    {
      key: 'need',
      label: 'Next-month spending estimate',
      value: (r) => reportedMoney(r.nextMonthNeed),
      numeric: true,
      primary: true,
    },
  ];
  readonly runway = computed(() => {
    const f = this.funds();
    if (!f || !this.data()?.books.ledgerCount || !f.runRate.monthsUsed) return 'Not available';
    if (f.cashAndBank <= 0) return '0 months';
    if (f.runRate.monthlyExpense <= f.runRate.monthlyInflow) return 'No net burn in model';
    return f.runwayMonths == null ? 'Not available' : `${f.runwayMonths.toFixed(1)} months`;
  });
  readonly fundColumns: DataColumn<CompanyFunds>[] = [
    {
      key: 'name',
      label: 'Company',
      value: (r) => r.name,
      link: (r) => ({ path: '/dashboard', query: { company: r.id } }),
    },
    {
      key: 'bank',
      label: 'Bank balance',
      value: (r) => reportedMoney(r.bank),
      numeric: true,
      primary: true,
    },
    {
      key: 'assessment',
      label: 'Funding assessment',
      value: (r) =>
        ({ ok: 'Comfortable', watch: 'Watch', risk: 'Tight' })[r.tone] || 'Not available',
      secondary: (r) => r.note,
      primary: true,
    },
    {
      key: 'inflow',
      label: 'Last-month inflow activity',
      value: (r) => reportedMoney(r.lastMonthInflow),
      numeric: true,
    },
    {
      key: 'payments',
      label: 'Expense review',
      value: () => 'Open expense report',
      link: (r) => ({ path: '/reports', query: { company: r.id } }),
    },
    {
      key: 'cash',
      label: 'Cash & bank',
      value: (r) => fullInr(r.cashAndBank),
      numeric: true,
      primary: true,
    },
    {
      key: 'headroom',
      label: 'Cash less payables',
      value: (r) => fullInr(r.cashAndBank - r.payables),
      tone: (r) => balanceTone(r.cashAndBank - r.payables),
      numeric: true,
      primary: true,
    },
    {
      key: 'next',
      label: 'Next-month model balance',
      value: (r) => fullInr(r.nextMonthFund),
      tone: (r) => balanceTone(r.nextMonthFund),
      numeric: true,
      primary: true,
    },
    {
      key: 'spend',
      label: 'Last-month activity',
      value: (r) => fullInr(r.lastMonthExpenses),
      secondary: (r) =>
        r.lastMonthEstimated
          ? 'Estimated from ledger run-rate'
          : 'Payments, purchases and debit notes',
      numeric: true,
    },
    {
      key: 'receivables',
      label: 'Receivables',
      value: (r) => fullInr(r.receivables),
      numeric: true,
    },
    { key: 'payables', label: 'Payables', value: (r) => fullInr(r.payables), numeric: true },
    {
      key: 'budget',
      label: 'Monthly model spend',
      value: (r) => fullInr(r.nextMonthNeed),
      numeric: true,
    },
  ];
  readonly accountColumns: DataColumn<BankAccount>[] = [
    // Account identity stays the first column so mobile cards retain their title.
    {
      key: 'name',
      label: 'Account',
      value: (r) => cleanText(r.name),
      secondary: (r) => r.companyName,
      link: (r) => ({
        path: '/ledgers',
        query: { company: r.companyId, q: r.name, group: r.group },
      }),
    },
    {
      key: 'value',
      label: 'Reported balance',
      value: (r) => fullInr(r.available),
      numeric: true,
      primary: true,
    },
    {
      key: 'type',
      label: 'Type',
      value: (r) => (r.kind === 'bank' ? 'Bank' : 'Cash'),
      primary: true,
    },
    {
      key: 'raw',
      label: 'Signed source balance',
      value: (r) => reportedMoney(r.rawBalance),
      secondary: () => 'Sign preserved for reconciliation; source convention must be confirmed.',
      numeric: true,
      primary: true,
    },
  ];
  readonly companyColumns: DataColumn<CompanyFinancial>[] = [
    { key: 'name', label: 'Company', value: (r) => r.name },
    ...(['revenue', 'expenses', 'profit', 'receivables', 'payables', 'cashAndBank'] as const).map(
      (key) => ({
        key,
        label: {
          revenue: 'Revenue',
          expenses: 'Expenses',
          profit: 'Revenue less expenses',
          receivables: 'Receivables',
          payables: 'Payables',
          cashAndBank: 'Cash & bank',
        }[key],
        value: (r: CompanyFinancial) => (r.ledgerCount ? fullInr(r[key]) : 'Not available'),
        numeric: true,
        primary: key === 'profit' || key === 'cashAndBank',
      }),
    ),
    { key: 'ledgers', label: 'Ledgers', value: (r) => String(r.ledgerCount) },
    { key: 'vouchers', label: 'Vouchers', value: (r) => String(r.voucherCount) },
  ];

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.selectedCompany.set(params.get('company') || 'all');
      this.load();
    });
  }
  load() {
    this.loading.set(true);
    this.error.set('');
    this.data.set(null);
    this.request.run(this.api.getDashboard(this.selectedCompany()), {
      next: (d) => {
        this.companies.set(d.companies);
        this.data.set(d);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Financial overview could not be loaded. Retry or check Data operations.');
        this.loading.set(false);
      },
    });
  }
  onCompanyChange(value: string) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { company: value },
      queryParamsHandling: 'merge',
    });
  }
}
