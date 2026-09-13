import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

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
  tone?: (row: T) => string;
  numeric?: boolean;
  /** Keep this field visible in the mobile summary. Other fields remain in Details. */
  primary?: boolean;
}

@Component({
  selector: 'app-data-table',
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './data-table.html',
  styleUrl: './data-table.css',
})
export class DataTable<T> {
  readonly label = input.required<string>();
  readonly rows = input.required<readonly T[]>();
  readonly columns = input.required<readonly DataColumn<T>[]>();
  readonly rowKey = input.required<(row: T) => string | number>();
  readonly loading = input(false);
  readonly error = input('');
  readonly empty = input('No records match the current selection.');
  readonly primary = computed(() => this.columns().filter((c, i) => i === 0 || c.primary));
  readonly secondary = computed(() => this.columns().filter((c, i) => i !== 0 && !c.primary));
}
