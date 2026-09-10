import { DatePipe, DecimalPipe, TitleCasePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { DashboardService } from '../../services/dashboard';
import { DashboardData } from '../../models/dashboard';

@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, DecimalPipe, TitleCasePipe],
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

    return [
      { key: 'revenue', label: 'Revenue', value: snapshot.kpis.revenue },
      { key: 'expenses', label: 'Expenses', value: snapshot.kpis.expenses },
      { key: 'profit', label: 'Profit', value: snapshot.kpis.profit, tone: snapshot.kpis.profit >= 0 ? 'up' : 'down' },
      { key: 'receivables', label: 'Receivables', value: snapshot.kpis.receivables },
      { key: 'payables', label: 'Payables', value: snapshot.kpis.payables },
      { key: 'cash', label: 'Cash & bank', value: snapshot.kpis.cash },
    ];
  });

  constructor() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set('');
    this.dashboardService.getDashboard(this.selectedCompany()).subscribe({
      next: (dashboard) => {
        this.data.set(dashboard);
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

  statusLabel(status: string) {
    return status.replace('-', ' ');
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

  compactInr(value: number) {
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (abs >= 10_000_000) {
      return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
    }
    if (abs >= 100_000) {
      return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
    }
    return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
  }

  fullInr(value: number) {
    return value.toLocaleString('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    });
  }
}
