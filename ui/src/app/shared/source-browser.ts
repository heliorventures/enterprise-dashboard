import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DataColumn, DataTable } from './data-table';
import { SourcePage } from '../models/source';
type Row = Record<string, unknown>;
const text = (row: Row, field: string) => (row[field] == null ? 'Unavailable' : String(row[field]));

@Component({
  selector: 'app-source-browser',
  imports: [DataTable],
  template: `<section class="source-browser">
    <header>
      <h2>{{ title() }}</h2>
      <p>{{ description() }}</p>
    </header>
    @if ((mode() === 'issues' || mode() === 'diagnostics') && batch()) {
      <p>
        Batch: {{ batch() }}
        <button class="btn ghost" type="button" (click)="clearBatch()">Show all batches</button>
      </p>
    }
    @if (mode() === 'masters') {
      <label class="field"
        >Collection
        <select [value]="collection()" (change)="chooseCollection($event)">
          <option value="">All master collections</option>
          @for (name of collections; track name) {
            <option [value]="name">{{ name }}</option>
          }
        </select></label
      >
    }
    <app-data-table
      [label]="title()"
      [rows]="rows()"
      [columns]="columns()"
      [rowKey]="rowKey"
      [loading]="loading()"
      [error]="error()"
      empty="No records are available for this selection."
    />
    @if (error()) {
      <button class="btn ghost" type="button" (click)="retry()">
        {{ staleCursor() ? 'Reload first page' : 'Retry loading records' }}
      </button>
    }
    <nav class="source-pager" [attr.aria-label]="title() + ' pages'">
      <button
        type="button"
        class="btn ghost"
        [disabled]="
          loading() || (mode() === 'details' ? !params().get('detailsCursor') : page() <= 1)
        "
        (click)="go(page() - 1)"
      >
        Previous
      </button>
      <span aria-live="polite">
        @if (loading()) {
          Loading records
        } @else if (error()) {
          Records unavailable
        } @else if (mode() === 'details') {
          {{ rows().length }} records on this page
        } @else {
          Page {{ page() }} · {{ total() }} records
        }
      </span>
      <button
        type="button"
        class="btn ghost"
        [disabled]="loading() || (mode() === 'details' ? !nextCursor() : page() * 25 >= total())"
        (click)="go(page() + 1)"
      >
        Next
      </button>
    </nav>
  </section>`,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .source-browser {
      display: grid;
      gap: 14px;
      padding-block: 20px;
    }
    p {
      overflow-wrap: anywhere;
    }
    .source-pager {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    label {
      display: grid;
      gap: 6px;
      max-width: 340px;
    }
    select {
      max-width: 100%;
      min-height: 44px;
    }
  `,
})
export class SourceBrowser {
  readonly mode = input.required<'archives' | 'issues' | 'masters' | 'details' | 'diagnostics'>();
  readonly title = input.required<string>();
  readonly description = input('');
  readonly refreshKey = input('');
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly batch = computed(() => this.params().get('batch') || '');
  readonly collection = computed(() => this.params().get('masterCollection') || '');
  readonly page = computed(() => {
    const n = Number(this.params().get(this.mode() + 'Page') || 1);
    return Number.isSafeInteger(n) && n > 0 ? n : 1;
  });
  readonly collections = [
    'GROUP',
    'VOUCHERTYPE',
    'CURRENCY',
    'COSTCATEGORY',
    'COSTCENTRE',
    'STOCKGROUP',
    'STOCKCATEGORY',
    'STOCKITEM',
    'UNIT',
    'GODOWN',
  ];
  readonly rows = signal<Row[]>([]);
  readonly total = signal(0);
  readonly nextCursor = signal<string | null>(null);
  private cursorParents = new Map<string, string>();
  readonly staleCursor = signal(false);
  private readonly revision = signal(0);
  private lastScope = '';
  readonly loading = signal(false);
  readonly error = signal('');
  readonly rowKey = (r: Row) => String(r['id']);
  readonly columns = computed<DataColumn<Row>[]>(() => {
    if (this.mode() === 'diagnostics') return [
      { key: 'company', label: 'Company / time', value: r => String(r['company_name'] || 'Before company selection'),
        secondary: r => new Date(String(r['occurred_at'])).toLocaleString('en-IN') },
      { key: 'failure', label: 'Failure', value: r => text(r, 'message'), primary: true,
        secondary: r => `${r['event']} · ${r['collection'] || 'Run'} · ${r['severity']}` },
      { key: 'context', label: 'Location and cause', value: r => this.diagnosticContext(r),
        secondary: r => String((r['details'] as Row)?.['tallyMessage'] || '') },
      { key: 'action', label: 'Suggested action', value: r => String((r['details'] as Row)?.['action'] || 'Review the failure and source location.'), primary: true },
      { key: 'reference', label: 'References', value: r => `Error ${r['id']} · Batch ${r['batch_id'] || 'not created'}`,
        secondary: r => `Run ${r['run_id'] || 'API'} · Exporter ${(r['exporter'] as Row)?.['version'] || 'unknown'} · Build ${(r['exporter'] as Row)?.['buildHash'] || 'unknown'}` },
    ];
    if (this.mode() === 'archives')
      return [
        {
          key: 'company',
          label: 'Company',
          value: (r) => text(r, 'company_name'),
          secondary: (r) => text(r, 'id'),
        },
        {
          key: 'export',
          label: 'Export coverage',
          value: (r) => text(r, 'coverage_status'),
          primary: true,
        },
        {
          key: 'sync',
          label: 'Latest sync',
          value: (r) => (r['sync_status'] ? String(r['sync_status']) : 'Not run'),
          primary: true,
        },
        {
          key: 'date',
          label: 'Captured',
          value: (r) => new Date(String(r['captured_at'])).toLocaleString('en-IN'),
        },
        {
          key: 'collections',
          label: 'Collection coverage',
          value: (r) =>
            ((r['collections'] as { name: string; count: number; status: string }[]) || [])
              .map((c) => `${c.name}: ${c.count} (${c.status})`)
              .join('; '),
        },
        {
          key: 'diagnostics', label: 'Export diagnostics',
          value: r => `${r['diagnostic_count'] ?? 0} saved diagnostics`,
          link: r => ({ path: '/operations', query: { batch: String(r['id']), diagnosticsPage: 1 } }),
        },
        {
          key: 'issues',
          label: 'Validation history',
          value: (r) => `${r['issue_count']} issues`,
          link: (r) => ({ path: '/operations', query: { batch: String(r['id']), issuesPage: 1 } }),
        },
      ];
    if (this.mode() === 'issues')
      return [
        {
          key: 'company',
          label: 'Company',
          value: (r) => text(r, 'company_name'),
          secondary: (r) => text(r, 'batch_id'),
        },
        {
          key: 'severity',
          label: 'Severity',
          value: (r) => text(r, 'severity'),
          primary: true,
          tone: (r) => (r['severity'] === 'error' ? 'negative' : 'neutral'),
        },
        {
          key: 'field',
          label: 'Source location',
          value: (r) => `${r['collection']} #${r['ordinal'] ?? 'collection'} · ${r['field']}`,
          primary: true,
        },
        {
          key: 'message',
          label: 'Issue',
          value: (r) => text(r, 'message'),
          secondary: (r) => text(r, 'code'),
        },
        {
          key: 'record',
          label: 'Evidence',
          value: (r) => (r['ordinal'] === null ? 'Collection-level issue' : 'Open archived record'),
          link: (r) =>
            r['ordinal'] === null
              ? { path: '/operations', query: { batch: String(r['batch_id']) } }
              : this.sourceLink(r),
        },
      ];
    if (this.mode() === 'details')
      return [
        { key: 'company', label: 'Company', value: (r) => text(r, 'company_name') },
        {
          key: 'name',
          label: 'Account / item',
          value: (r) => text(r, 'name'),
          primary: true,
          link: (r) => this.sourceLink(r),
        },
        {
          key: 'amount',
          label: 'Signed amount',
          value: (r) =>
            r['amount'] == null
              ? 'Unavailable'
              : `${r['amount']} ${r['currency'] || '(currency unspecified)'}`,
          primary: true,
        },
        { key: 'date', label: 'Voucher date', value: (r) => text(r, 'voucher_date') },
        { key: 'context', label: 'Group / type / quantity', value: (r) => text(r, 'context') },
      ];
    return [
      { key: 'company', label: 'Company', value: (r) => text(r, 'company_name') },
      {
        key: 'name',
        label: 'Master',
        value: (r) => text(r, 'name'),
        primary: true,
        link: (r) => this.sourceLink(r),
      },
      {
        key: 'collection',
        label: 'Collection',
        value: (r) => text(r, 'collection'),
        primary: true,
      },
      { key: 'parent', label: 'Parent', value: (r) => text(r, 'parent_name') },
      { key: 'category', label: 'Category', value: (r) => text(r, 'category_name') },
      { key: 'unit', label: 'Base units', value: (r) => text(r, 'base_units') },
    ];
  });
  constructor() {
    effect((onCleanup) => {
      this.refreshKey();
      this.revision();
      const mode = this.mode();
      const params: Record<string, string | number> = { page: this.page(), pageSize: 25 };
      const company = this.params().get('company');
      if (company) params['company'] = company;
      if ((mode === 'issues' || mode === 'diagnostics') && this.batch()) params['batch'] = this.batch();
      if (mode === 'masters' && this.collection()) params['collection'] = this.collection();
      if (mode === 'details') {
        delete params['page'];
        const scope = JSON.stringify(
          ['company', 'detailType', 'sourceName', 'fromMonth', 'toMonth'].map((k) =>
            this.params().get(k),
          ),
        );
        if (scope !== this.lastScope) {
          this.cursorParents.clear();
          this.lastScope = scope;
        }
        const cursor = this.params().get('detailsCursor');
        if (cursor) params['cursor'] = cursor;
        for (const key of ['fromMonth', 'toMonth']) {
          const value = this.params().get(key);
          if (value) params[key] = value;
        }
        params['company'] = this.params().get('company') || 'all';
        params['detailType'] = this.params().get('detailType') || 'posting';
        const name = this.params().get('sourceName');
        if (name) params['name'] = name;
      }
      this.nextCursor.set(null);
      this.rows.set([]);
      this.total.set(0);
      this.loading.set(true);
      this.error.set('');
      this.staleCursor.set(false);
      const endpoint = ['masters', 'details'].includes(mode)
        ? `/api/reports/source/${mode}`
        : `/api/tally/${mode}`;
      const request = this.http.get<SourcePage<Row>>(endpoint, { params }).subscribe({
        next: (r) => {
          this.rows.set(r.items);
          this.total.set(r.total || 0);
          this.nextCursor.set(r.nextCursor || null);
          this.loading.set(false);
        },
        error: (error) => {
          this.error.set(
            error.status === 409
              ? 'The published data or filters changed. Reload the first page to continue.'
              : 'Unable to load source records. Retry loading this selection.',
          );
          this.staleCursor.set(error.status === 409);
          if (error.status === 409) this.cursorParents.clear();
          this.loading.set(false);
        },
      });
      onCleanup(() => request.unsubscribe());
    });
  }
  retry() {
    if (this.staleCursor() && this.params().get('detailsCursor')) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { detailsCursor: null, detailsPage: null },
        queryParamsHandling: 'merge',
      });
    } else this.revision.update((n) => n + 1);
  }
  private diagnosticContext(r: Row): string {
    const d = (r['details'] || {}) as Row;
    return [d['stage'], d['phase'], d['operation'], d['httpStatus'] ? `HTTP ${d['httpStatus']}` : '',
      Array.isArray(d['errorCodes']) ? d['errorCodes'].join(', ') : '', d['xmlPath'],
      d['xmlLine'] != null ? `line ${d['xmlLine']}, column ${d['xmlColumn'] ?? '?'}` : '',
      d['from'] ? `${d['from']} to ${d['to']}` : '',
      d['recordsReceived'] != null ? `${d['recordsReceived']} records received` : '',
      d['bytesReceived'] != null ? `${d['bytesReceived']} bytes` : '',
      d['requestId'] ? `Request ${d['requestId']}` : '',
      d['serverDiagnosticId'] ? `Server error ${d['serverDiagnosticId']}` : '',
      d['constraint'], d['table'],
      d['stackLocation'],
    ].filter(Boolean).join(' · ') || 'No additional location was available.';
  }
  private sourceLink(r: Row) {
    return {
      path: '/operations',
      query: {
        batch: String(r['batch_id']),
        sourceCollection: String(r['collection']),
        sourceOrdinal: Number(r['ordinal']),
      },
    };
  }
  go(page: number) {
    if (this.mode() === 'details') {
      let cursor: string | null;
      if (page > this.page()) {
        cursor = this.nextCursor();
        if (!cursor) return;
        this.cursorParents.set(cursor, this.params().get('detailsCursor') || '');
      } else cursor = this.cursorParents.get(this.params().get('detailsCursor') || '') || null;
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { detailsCursor: cursor || null, detailsPage: null },
        queryParamsHandling: 'merge',
      });
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [this.mode() + 'Page']: page },
      queryParamsHandling: 'merge',
    });
  }
  clearBatch() {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { batch: null, issuesPage: 1, diagnosticsPage: 1, sourceCollection: null, sourceOrdinal: null },
      queryParamsHandling: 'merge',
    });
  }
  chooseCollection(event: Event) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        masterCollection: (event.target as HTMLSelectElement).value || null,
        mastersPage: 1,
      },
      queryParamsHandling: 'merge',
    });
  }
}
