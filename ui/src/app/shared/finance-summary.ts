import { Component, input } from '@angular/core';
import { KpiCard } from './kpi-card';
import { DataColumn } from './data-table';
import { compactInr, fullInr } from './money';

export interface ProjectActivity {
  id: string | number;
  name: string;
  companyId: string;
  companyName: string;
  voucherCount?: number;
  withAmount?: number;
  invested?: number;
  earned?: number;
  net?: number;
}
export function reportedMoney(value: number | undefined | null) {
  return typeof value === 'number' && Number.isFinite(value) ? fullInr(value) : 'Not available';
}
export const projectActivityColumns: DataColumn<ProjectActivity>[] = [
  {
    key: 'name',
    label: 'Project',
    value: (r) => r.name,
    secondary: (r) => r.companyName,
    link: (r) => ({ path: '/transactions', query: { company: r.companyId, q: r.name } }),
  },
  {
    key: 'vouchers',
    label: 'Linked vouchers',
    value: (r) => (r.voucherCount == null ? 'Not available' : String(r.voucherCount)),
    primary: true,
  },
  {
    key: 'net',
    label: 'Model net',
    value: (r) => (r.withAmount === 0 ? 'Not available' : reportedMoney(r.net)),
    tone: (r) => ((r.net ?? 0) < 0 ? 'negative' : 'neutral'),
    primary: true,
    numeric: true,
  },
  {
    key: 'invested',
    label: 'Invested (voucher activity)',
    value: (r) => (r.withAmount === 0 ? 'Not available' : reportedMoney(r.invested)),
    numeric: true,
  },
  {
    key: 'earned',
    label: 'Earned (voucher activity)',
    value: (r) => (r.withAmount === 0 ? 'Not available' : reportedMoney(r.earned)),
    numeric: true,
  },
  {
    key: 'coverage',
    label: 'Non-zero amounts',
    value: (r) =>
      r.withAmount == null
        ? 'Coverage not reported'
        : `${r.withAmount} of ${r.voucherCount} vouchers`,
  },
];

@Component({
  selector: 'app-project-summary',
  imports: [KpiCard],
  template: `<section class="kpi-grid" aria-label="Project activity totals">
    <app-kpi-card
      label="Linked projects"
      [value]="count() == null ? 'Not available' : '' + count()"
      [hint]="
        (vouchers() == null ? 'Voucher count unavailable' : vouchers() + ' linked vouchers') +
        '. Selected company scope.'
      "
    />
    @for (metric of metrics; track metric.key) {
      <app-kpi-card
        [label]="metric.label"
        [value]="amount(metric.key)"
        [detail]="exact(metric.key)"
        hint="Reported voucher activity; totals may include missing amounts or overlapping invoice/settlement activity."
      />
    }
  </section>`,
})
export class ProjectSummary {
  readonly count = input<number>();
  readonly vouchers = input<number>();
  readonly totals = input.required<{ invested?: number; earned?: number; net?: number }>();
  readonly metrics = [
    { key: 'invested' as const, label: 'Total invested' },
    { key: 'earned' as const, label: 'Total earned' },
    { key: 'net' as const, label: 'Total model net' },
  ];
  amount(key: 'invested' | 'earned' | 'net') {
    const value = this.totals()[key];
    return value == null || !Number.isFinite(value) ? 'Not available' : compactInr(value);
  }
  exact(key: 'invested' | 'earned' | 'net') {
    return reportedMoney(this.totals()[key]);
  }
}
