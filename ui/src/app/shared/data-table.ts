import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StatusDetail, StatusHint } from './status-hint';

export interface RecordLink {
  path: string;
  query?: Record<string, string | number>;
}

export interface DataColumn<T> {
  key: string;
  label: string;
  value: (row: T) => string;
  secondary?: (row: T) => string;
  link?: (row: T) => RecordLink;
  linkDisabled?: (row: T) => boolean;
  status?: (row: T) => StatusDetail | null;
  tone?: (row: T) => string;
  numeric?: boolean;
  /** Keep this field visible in the mobile summary. Other fields remain in Details. */
  primary?: boolean;
}

@Component({
  selector: 'app-data-table',
  imports: [NgTemplateOutlet, RouterLink, StatusHint],
  host: { '[class.compact]': 'compact()' },
  templateUrl: './data-table.html',
  styleUrl: './data-table.css',
})
export class DataTable<T> {
  readonly label = input.required<string>();
  readonly rows = input.required<readonly T[]>();
  readonly footerRows = input<readonly T[]>([]);
  readonly compact = input(false);
  readonly mobileRows = computed(() => [...this.rows(), ...this.footerRows()]);
  readonly columns = input.required<readonly DataColumn<T>[]>();
  readonly rowKey = input.required<(row: T) => string | number>();
  readonly loading = input(false);
  readonly error = input('');
  readonly empty = input('No records match the current selection.');
  readonly primary = computed(() => this.columns().filter((c, i) => i === 0 || c.primary));
  readonly secondary = computed(() => this.columns().filter((c, i) => i !== 0 && !c.primary));
}
