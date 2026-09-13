import { Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { compactInr, fullInr } from './money';
import { RecordLink } from './data-table';

export interface ChartRow {
  key: string;
  label: string;
  note?: string;
  link?: RecordLink;
  values: {
    label: string;
    value: number;
    displayValue?: string;
    tone?: 'accent' | 'positive' | 'negative' | 'muted';
  }[];
}

/** A common scale and a zero baseline preserve the direction of negative balances. */
export function chartDomain(rows: readonly ChartRow[]) {
  const values = rows
    .flatMap((row) => row.values.map((item) => item.value))
    .filter(Number.isFinite);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  return { min, max, span, zero: (-min / span) * 100 };
}

@Component({
  selector: 'app-financial-chart',
  host: { '[class.compact]': 'compact()' },
  imports: [RouterLink],
  templateUrl: './financial-chart.html',
  styleUrl: './financial-chart.css',
})
export class FinancialChart {
  readonly compact = input(false);
  readonly title = input.required<string>();
  readonly description = input('');
  readonly unit = input('INR');
  readonly rows = input.required<readonly ChartRow[]>();
  readonly empty = input('No financial data is available for this selection.');
  readonly domain = computed(() => chartDomain(this.rows()));
  readonly expanded = signal(false);
  readonly visibleRows = computed(() => (this.expanded() ? this.rows() : this.rows().slice(0, 6)));
  readonly compactInr = (value: number) => this.format(value, true);
  readonly fullInr = (value: number) => this.format(value, false);
  private format(value: number, compact: boolean) {
    if (this.unit() === 'INR') return compact ? compactInr(value) : fullInr(value);
    const options: Intl.NumberFormatOptions = {
      maximumFractionDigits: 2,
      notation: compact ? 'compact' : 'standard',
    };
    if (/^[A-Z]{3}$/.test(this.unit()))
      return new Intl.NumberFormat('en-IN', {
        ...options,
        style: 'currency',
        currency: this.unit(),
      }).format(value);
    return new Intl.NumberFormat('en-IN', options).format(value) + ' ' + this.unit();
  }
  width(value: number) {
    return Number.isFinite(value) ? (Math.abs(value) / this.domain().span) * 100 : 0;
  }
  left(value: number) {
    return value < 0 ? this.domain().zero - this.width(value) : this.domain().zero;
  }
}
