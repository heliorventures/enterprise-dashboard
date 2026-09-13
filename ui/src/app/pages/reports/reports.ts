import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CompanyOption, ExpenseCompany, ExpenseGroup, ExpenseLedger, ExpenseReport, ProjectReport, ProjectResult, VoucherRow } from '../../models/books';
import { DashboardService } from '../../services/dashboard';
import { Icon } from '../../shared/icon';
import { compactInr, fullInr } from '../../shared/money';

@Component({
  selector: 'app-reports',
  imports: [DatePipe, RouterLink, Icon],
  templateUrl: './reports.html',
  styleUrl: './reports.css',
})
export class Reports {
  private readonly api = inject(DashboardService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly company = signal('all');
  readonly group = signal('');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly report = signal<ExpenseReport | null>(null);
  readonly projects = signal<ProjectReport | null>(null);
  readonly vouchers = signal<VoucherRow[]>([]);
  readonly voucherTotal = signal(0);
  readonly loadingVouchers = signal(false);
  readonly companies = signal<CompanyOption[]>([]);

  readonly compactInr = compactInr;
  readonly fullInr = fullInr;

  readonly selectedCompany = computed(() => {
    const id = this.company();
    if (id === 'all') return null;
    return this.report()?.companies.find((row) => row.id === id) || null;
  });

  readonly selectedGroup = computed(() => {
    const name = this.group();
    if (!name) return null;
    return this.selectedCompany()?.groups.find((row) => row.name === name) || null;
  });

  readonly rows = computed(() => {
    const company = this.selectedCompany();
    const group = this.selectedGroup();
    if (group) return group.ledgers;
    if (company) return company.groups;
    return this.report()?.companies || [];
  });

  readonly projectRows = computed(() => {
    return this.projects()?.companies.flatMap((company) => company.projects) || [];
  });

  readonly level = computed(() => {
    if (this.selectedGroup()) return 'ledgers';
    if (this.selectedCompany()) return 'groups';
    return 'companies';
  });

  constructor() {
    this.api.getDashboard('all').subscribe({
      next: (dashboard) => this.companies.set(dashboard.companies),
      error: () => undefined,
    });
    this.route.queryParamMap.subscribe((params) => {
      this.company.set(params.get('company') || 'all');
      this.group.set(params.get('group') || '');
      this.load();
    });
  }

  load() {
    this.loading.set(true);
    this.error.set('');
    this.api.getExpenseReport(this.company()).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
        this.loadProjects();
        this.loadVouchers();
      },
      error: (err) => {
        this.error.set(err.error?.error || 'Unable to load the expense report. Confirm the API is running on port 3000.');
        this.loading.set(false);
      },
    });
  }

  loadProjects() {
    this.api.getProjectReport(this.company()).subscribe({
      next: (report) => this.projects.set(report),
      error: () => this.projects.set(null),
    });
  }

  openProject(row: ProjectResult) {
    this.router.navigate(['/transactions'], {
      queryParams: { company: row.companyId, q: row.name },
    });
  }

  loadVouchers() {
    const report = this.report();
    if (!report) {
      this.vouchers.set([]);
      return;
    }
    this.loadingVouchers.set(true);
    this.api
      .getVouchers({
        company: this.company(),
        from: report.lastMonth.from,
        to: this.lastMonthEnd(report.lastMonth.from),
        page: 1,
        pageSize: 25,
      })
      .subscribe({
        next: (result) => {
          this.vouchers.set(result.items);
          this.voucherTotal.set(result.total);
          this.loadingVouchers.set(false);
        },
        error: () => {
          this.vouchers.set([]);
          this.loadingVouchers.set(false);
        },
      });
  }

  openCompany(row: ExpenseCompany) {
    this.router.navigate(['/reports'], { queryParams: { company: row.id } });
  }

  openGroup(row: ExpenseGroup) {
    const company = this.selectedCompany();
    if (!company) return;
    this.router.navigate(['/reports'], { queryParams: { company: company.id, group: row.name } });
  }

  openLedger(row: ExpenseLedger) {
    this.router.navigate(['/ledgers'], {
      queryParams: { company: row.companyId, group: row.group, q: row.name },
    });
  }

  openPayments(row?: ExpenseLedger) {
    const report = this.report();
    this.router.navigate(['/transactions'], {
      queryParams: {
        company: row?.companyId || this.company(),
        q: row?.name || this.group(),
        from: report?.lastMonth.from || '',
        to: report ? this.lastMonthEnd(report.lastMonth.from) : '',
      },
    });
  }

  onCompany(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    this.router.navigate(['/reports'], { queryParams: value === 'all' ? {} : { company: value } });
  }

  up() {
    if (this.group()) {
      this.router.navigate(['/reports'], { queryParams: { company: this.company() } });
      return;
    }
    this.router.navigate(['/reports']);
  }

  clean(value: string) {
    return (value || '').replace(/\u0004/g, '').trim();
  }

  lastMonthEnd(from: string) {
    const date = new Date(`${from}T00:00:00`);
    date.setMonth(date.getMonth() + 1);
    date.setDate(0);
    return date.toISOString().slice(0, 10);
  }
}
