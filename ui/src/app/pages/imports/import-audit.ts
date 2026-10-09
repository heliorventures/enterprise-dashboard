import { Component, inject, signal } from '@angular/core';
import { ExcelImportService, ImportRecord } from '../../services/excel-import';
import { DataTable } from '../../shared/data-table';
import { LatestRequest } from '../../shared/latest-request';
import { PageHeader } from '../../shared/page-header';
import { auditColumns, importRowKey, importText } from './import-columns';
import { ImportNav } from './import-nav';

@Component({
  selector: 'app-import-audit',
  imports: [DataTable, PageHeader, ImportNav],
  template: `
    <section class="grid-page">
      <app-page-header
        title="Import audit"
        eyebrow="Excel imports"
        description="Recorded import, mapping and exception decisions. The newest entries appear first."
      />
      <app-import-nav />
      @if (error()) {
        <p class="banner" role="alert">{{ error() }}</p>
      }
      <article class="grid-card">
        <div class="grid-toolbar">
          <div>
            <h2>Audit entries</h2>
            <p>Showing up to {{ limit() }} recent entries.</p>
          </div>
        </div>
        <form class="filter-bar" (submit)="apply($event)">
          <label class="field"
            ><span>Entity</span
            ><input
              type="text"
              maxlength="50"
              pattern="[a-z][a-z0-9_]*"
              [value]="entity()"
              (input)="onEntity($event)"
              placeholder="All, or exception / account / import_file"
          /></label>
          <label class="field"
            ><span>Entry limit</span
            ><select [value]="limit()" (change)="onLimit($event)">
              <option [value]="50">50</option>
              <option [value]="100">100</option>
              <option [value]="500">500</option>
            </select></label
          >
          <button type="submit" class="btn ghost">Apply</button>
        </form>
        <app-data-table
          label="Import audit entries"
          [rows]="rows()"
          [columns]="columns"
          [rowKey]="recordKey"
          [loading]="loading()"
          [error]="error()"
          empty="No recorded changes match this entity."
        />
      </article>
      @if (rows().length) {
        <article class="grid-card">
          <div class="grid-toolbar"><h2>Recorded values</h2></div>
          <div class="section-copy">
            @for (row of rows(); track row['id']) {
              <details class="audit-values">
                <summary>
                  {{ text(row['action']) }} · {{ text(row['entity']) }} ·
                  {{ text(row['entity_id']) }}
                </summary>
                <h3>Before</h3>
                <pre>{{ json(row['old_value']) }}</pre>
                <h3>After</h3>
                <pre>{{ json(row['new_value']) }}</pre>
              </details>
            }
          </div>
        </article>
      }
    </section>
  `,
  styleUrl: './imports.css',
})
export class ImportAudit {
  private readonly api = inject(ExcelImportService);
  private readonly request = new LatestRequest();
  readonly entity = signal('');
  readonly limit = signal(100);
  readonly rows = signal<ImportRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly columns = auditColumns;
  readonly recordKey = importRowKey;
  readonly text = importText;

  constructor() {
    this.load();
  }
  onEntity(event: Event) {
    this.entity.set((event.target as HTMLInputElement).value);
  }
  onLimit(event: Event) {
    this.limit.set(Number((event.target as HTMLSelectElement).value));
  }
  apply(event: Event) {
    event.preventDefault();
    this.load();
  }
  json(value: unknown) {
    return value == null ? '—' : JSON.stringify(value, null, 2);
  }
  load() {
    const entity = this.entity().trim();
    if ((entity && !/^[a-z][a-z0-9_]*$/.test(entity)) || ![50, 100, 500].includes(this.limit())) {
      this.request.cancel();
      this.rows.set([]);
      this.loading.set(false);
      this.error.set('Use a lowercase entity name and a limit of 50, 100 or 500.');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.rows.set([]);
    this.request.run(this.api.audit(entity, this.limit()), {
      next: (rows) => {
        this.rows.set(rows || []);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.error || 'Unable to load audit');
        this.loading.set(false);
      },
    });
  }
}
