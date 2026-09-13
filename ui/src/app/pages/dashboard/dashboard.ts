import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardService } from '../../services/dashboard';
import { DashboardData, FundsOverview } from '../../models/dashboard';
import { Icon } from '../../shared/icon';
import { compactInr, fullInr } from '../../shared/money';

const emptyFunds: FundsOverview = {
  asOf: '',
  bank: 0,
  cash: 0,
  cashAndBank: 0,
  receivables: 0,
  payables: 0,
  uncommitted: 0,
  lastMonth: { key: '', label: 'Last month', expenses: 0, inflow: 0, expenseCount: 0, voucherCount: 0 },
  runRate: { monthlyExpense: 0, monthlyInflow: 0, method: 'ledgers', monthsUsed: 0 },
  threeMonthBudget: 0,
  afterThreeMonths: 0,
  runwayMonths: null,
  forecast: [],
  history: [],
  accounts: [],
  byCompany: [],
  lastMonthLabel: 'Last month',
  nextMonthLabel: 'Next month',
  methodNote: '',
};

@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, RouterLink, Icon],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private readonly dashboardService = inject(DashboardService);

  readonly selectedCompany = signal('all');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly data = signal<DashboardData | null>(null);

  readonly selectedLabel = computed(() => {
    const snapshot = this.data();
    if (!snapshot || this.selectedCompany() === 'all') {
      return 'All companies';
    }
    return snapshot.companies.find((company) => company.id === this.selectedCompany())?.name || 'Company';
  });

  readonly kpis = computed(() => {
    const snapshot = this.data();
    if (!snapshot) {
      return [];
    }

    const funds = snapshot.funds || emptyFunds;
    return [
      { key: 'bank', icon: 'bank', label: 'Bank balance', value: funds.bank, hint: 'Money sitting in bank ledgers today' },
      { key: 'lastMonth', icon: 'spend', label: `Spent in ${funds.lastMonth.label || 'last month'}`, value: funds.lastMonth.expenses, hint: funds.lastMonth.expenseCount ? `${funds.lastMonth.expenseCount} payment and purchase vouchers` : 'Payment and purchase vouchers' },
      { key: 'budget', icon: 'budget', label: 'Next 3-month budget', value: funds.threeMonthBudget, hint: `${compactInr(funds.runRate.monthlyExpense)} typical monthly spend` },
      { key: 'projected', icon: 'forecast', label: 'Cash after 3 months', value: funds.afterThreeMonths, tone: funds.afterThreeMonths >= 0 ? 'up' : 'down', hint: funds.runwayMonths == null ? 'No monthly burn on current run-rate' : `${funds.runwayMonths.toFixed(1)} months of runway` },
      { key: 'receivables', icon: 'receivables', label: 'Receivables', value: funds.receivables, hint: 'Money customers still owe' },
      { key: 'payables', icon: 'payables', label: 'Payables', value: funds.payables, hint: 'Already committed to vendors' },
    ];
  });

  readonly funds = computed(() => this.data()?.funds || emptyFunds);

  readonly fundTotals = computed(() => {
    return this.funds().byCompany.reduce(
      (sum, row) => ({
        bank: sum.bank + row.bank,
        lastMonthExpenses: sum.lastMonthExpenses + row.lastMonthExpenses,
        lastMonthInflow: sum.lastMonthInflow + (row.lastMonthInflow || 0),
        nextMonthNeed: sum.nextMonthNeed + row.nextMonthNeed,
      }),
      { bank: 0, lastMonthExpenses: 0, lastMonthInflow: 0, nextMonthNeed: 0 },
    );
  });

  readonly cashflowChart = computed(() => {
    const funds = this.funds();
    const rows = [
      ...funds.history.slice(-6).map((row) => ({ ...row, kind: row.kind || 'actual' })),
      ...funds.forecast,
    ];
    const peak = Math.max(1, ...rows.flatMap((row) => [row.expenses, row.inflow]));
    return {
      max: peak,
      mid: peak / 2,
      columns: rows.map((row) => ({
        ...row,
        short: (row.label || row.key).replace(/ 20\d\d/, ''),
        expensePct: (row.expenses / peak) * 100,
        inflowPct: (row.inflow / peak) * 100,
      })),
    };
  });

  readonly companyChart = computed(() => {
    const rows = this.data()?.companyFinancials || [];
    const peak = Math.max(
      1,
      ...rows.flatMap((row) => [row.revenue, row.expenses, Math.abs(row.profit)]),
    );

    return {
      max: peak,
      mid: peak / 2,
      columns: rows.map((row) => ({
        id: row.id,
        name: row.name,
        short: this.shortLabel(row.name),
        revenue: row.revenue,
        expenses: row.expenses,
        profit: row.profit,
        revenuePct: (row.revenue / peak) * 100,
        expensesPct: (row.expenses / peak) * 100,
        profitPct: (Math.abs(row.profit) / peak) * 100,
      })),
    };
  });

  readonly mixChart = computed(() => {
    const kpis = this.data()?.kpis;
    const items = [
      { key: 'receivables', label: 'Receivables', value: Math.max(0, kpis?.receivables || 0), color: '#3b6fd4' },
      { key: 'payables', label: 'Payables', value: Math.max(0, kpis?.payables || 0), color: '#c24b4b' },
      { key: 'cash', label: 'Cash & bank', value: Math.max(0, this.funds().cashAndBank || kpis?.cash || 0), color: '#1f8a5b' },
    ];
    const total = items.reduce((sum, item) => sum + item.value, 0);
    const gap = items.filter((item) => item.value > 0).length > 1 ? 0.08 : 0;
    let angle = -Math.PI / 2;

    return {
      total,
      segments: items.map((item) => {
        const fraction = total ? item.value / total : 0;
        const sweep = Math.max(0, fraction * 2 * Math.PI - gap);
        const start = angle;
        const end = start + sweep;
        angle += fraction * 2 * Math.PI;
        return {
          ...item,
          pct: Math.round(fraction * 100),
          d: this.describeArc(80, 80, 56, start, end),
        };
      }),
    };
  });

  constructor() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set('');
    this.dashboardService.getDashboard(this.selectedCompany()).subscribe({
      next: (dashboard) => {
        this.data.set({
          ...dashboard,
          books: dashboard.books || { ledgerCount: 0, voucherCount: 0, groups: [] },
          funds: dashboard.funds || emptyFunds,
        });
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.error || 'Unable to load dashboard. Confirm the API is running on port 3000.');
        this.loading.set(false);
      },
    });
  }

  onCompanyChange(event: Event) {
    this.selectedCompany.set((event.target as HTMLSelectElement).value);
    this.load();
  }

  toneLabel(tone: string) {
    return ({ ok: 'Comfortable', watch: 'Watch', risk: 'Tight' } as Record<string, string>)[tone] || tone;
  }

  toneIcon(tone: string) {
    return ({ ok: 'check', watch: 'warning', risk: 'warning' } as Record<string, string>)[tone] || 'info';
  }

  initials(name: string) {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
  }

  compactInr = compactInr;
  fullInr = fullInr;

  clean(value: string) {
    return (value || '').replace(/\u0004/g, '').trim();
  }

  private shortLabel(name: string) {
    return this.clean(name)
      .replace(/\s+(LLP|PVT\.?|LTD\.?|LIMITED|ENTERPRISES|AND PROJECTS)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 2)
      .join(' ');
  }

  private describeArc(cx: number, cy: number, radius: number, start: number, end: number) {
    const delta = end - start;
    if (delta <= 0.01) {
      return '';
    }

    const polar = (angle: number) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];

    if (delta >= Math.PI * 2 - 0.01) {
      const [x1, y1] = polar(start);
      const [x2, y2] = polar(start + Math.PI);
      return `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2} A ${radius} ${radius} 0 1 1 ${x1} ${y1}`;
    }

    const [x1, y1] = polar(start);
    const [x2, y2] = polar(end);
    const large = delta > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
  }
}
