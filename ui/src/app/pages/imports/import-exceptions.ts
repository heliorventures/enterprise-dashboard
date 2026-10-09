import { Component, inject, signal } from '@angular/core';
import { CompanyDirectory } from '../../services/company-directory';
import { ExcelImportService, ImportRecord } from '../../services/excel-import';
import { CompanySelect } from '../../shared/company-select';
import { LatestRequest } from '../../shared/latest-request';
import { PageHeader } from '../../shared/page-header';
import { Pager } from '../../shared/pager';
import { importText } from './import-columns';
import { ImportExport } from './import-export';
import { ImportNav } from './import-nav';

@Component({
  providers: [CompanyDirectory],
  selector: 'app-import-exceptions',
  imports: [CompanySelect, PageHeader, Pager, ImportNav, ImportExport],
  template: `
    <section class="grid-page">
      <app-page-header
        title="Exception queue"
        eyebrow="Excel vs Tally"
        description="Review financial and data issues, then record a resolution or rejection."
      />
      <app-import-nav />
      @if (error()) {
        <p class="banner" role="alert">{{ error() }}</p>
      }
      @if (notice()) {
        <p class="banner info" role="status">{{ notice() }}</p>
      }
      <article class="grid-card">
        <div class="grid-toolbar">
          <h2>Exceptions</h2>
          <app-import-export
            type="exceptions"
            [company]="company()"
            [status]="status()"
            [q]="query()"
          />
        </div>
        <form class="filter-bar" (submit)="apply($event)">
          <fieldset class="import-filter-fields" [disabled]="saving()">
            <app-company-select
              [companies]="companies()"
              [value]="company()"
              (companyChange)="onCompany($event)"
            />
            <label class="field"
              ><span>Status</span
              ><select [value]="status()" (change)="onStatus($event)">
                <option value="OPEN">Open</option>
                <option value="RESOLVED">Resolved</option>
                <option value="REJECTED">Rejected</option>
                <option value="all">All</option>
              </select></label
            >
            <label class="field search"
              ><span>Search</span
              ><input
                type="search"
                maxlength="200"
                [value]="search()"
                (input)="onSearch($event)"
                placeholder="Account or issue"
            /></label>
            <button class="btn ghost" type="submit">Search</button>
          </fieldset>
        </form>
        @if (loading()) {
          <p class="empty" role="status">Loading exceptions…</p>
        } @else if (!rows().length) {
          <p class="empty">No exceptions match these filters.</p>
        }
        <div class="exception-list">
          @for (row of rows(); track row['id']) {
            <article class="exception-item">
              <div>
                <h3>{{ text(row['title'] || row['type']).replaceAll('_', ' ') }}</h3>
                <p>{{ text(row['account_name']) }} · {{ text(row['company_name']) }}</p>
                <p>{{ text(row['detail']) }}</p>
                <p class="muted">
                  {{ text(row['severity']) }} · {{ text(row['status']) }} · Owner:
                  {{ text(row['owner']) }}
                </p>
              </div>
              @if (row['status'] === 'OPEN') {
                <button class="btn ghost" type="button" [disabled]="saving()" (click)="review(row)">
                  Review
                </button>
              }
              @if (selected()?.['id'] === row['id']) {
                <div class="exception-decision">
                  <label class="field"
                    ><span>Decision comment</span
                    ><textarea
                      maxlength="2000"
                      rows="3"
                      [disabled]="saving()"
                      [value]="comment()"
                      (input)="onComment($event)"
                    ></textarea>
                  </label>
                  <div class="row-actions">
                    <button
                      class="btn primary"
                      type="button"
                      [disabled]="saving()"
                      (click)="decide('RESOLVED')"
                    >
                      {{ saving() ? 'Saving…' : 'Resolve' }}
                    </button>
                    <button
                      class="btn ghost"
                      type="button"
                      [disabled]="saving()"
                      (click)="decide('REJECTED')"
                    >
                      Reject
                    </button>
                    <button
                      class="btn ghost"
                      type="button"
                      [disabled]="saving()"
                      (click)="selected.set(null)"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              }
            </article>
          }
        </div>
        <app-pager
          [total]="total()"
          [page]="page()"
          [pageSize]="pageSize()"
          [busy]="loading() || saving()"
          (pageChange)="onPage($event)"
          (pageSizeChange)="setPageSize($event)"
        />
      </article>
    </section>
  `,
  styleUrl: './imports.css',
})
export class ImportExceptions {
  private readonly api = inject(ExcelImportService);
  private readonly directory = inject(CompanyDirectory);
  private readonly request = new LatestRequest();
  private readonly decisionRequest = new LatestRequest();
  readonly companies = this.directory.companies;
  readonly company = signal('all');
  readonly status = signal('OPEN');
  readonly search = signal('');
  readonly query = signal('');
  readonly rows = signal<ImportRecord[]>([]);
  readonly page = signal(1);
  readonly pageSize = signal(50);
  readonly total = signal(0);
  readonly selected = signal<ImportRecord | null>(null);
  readonly comment = signal('');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly text = importText;

  constructor() {
    this.load();
  }
  onCompany(value: string) {
    if (this.saving()) return;
    this.company.set(value);
    this.apply();
  }
  onStatus(event: Event) {
    if (this.saving()) return;
    this.status.set((event.target as HTMLSelectElement).value);
    this.apply();
  }
  onSearch(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
  }
  onComment(event: Event) {
    this.comment.set((event.target as HTMLTextAreaElement).value);
  }
  setPageSize(size: number) {
    if (this.saving()) return;
    this.pageSize.set(size);
    this.page.set(1);
    this.load();
  }
  onPage(page: number) {
    if (this.saving()) return;
    this.page.set(page);
    this.load();
  }
  apply(event?: Event) {
    event?.preventDefault();
    if (this.saving()) return;
    this.query.set(this.search().trim());
    this.page.set(1);
    this.load();
  }
  load(preserveNotice = false) {
    this.loading.set(true);
    this.error.set('');
    if (!preserveNotice) this.notice.set('');
    this.rows.set([]);
    this.selected.set(null);
    this.request.run(
      this.api.exceptions({
        company: this.company(),
        status: this.status(),
        q: this.query(),
        page: this.page(),
        pageSize: this.pageSize(),
      }),
      {
        next: (result) => {
          this.rows.set(result.items || []);
          this.total.set(result.total || 0);
          this.page.set(result.page);
          this.pageSize.set(result.pageSize);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.error || 'Unable to load exceptions');
          this.loading.set(false);
        },
      },
    );
  }
  review(row: ImportRecord) {
    if (this.saving()) return;
    this.selected.set(row);
    this.comment.set('');
    this.error.set('');
  }
  decide(status: 'RESOLVED' | 'REJECTED') {
    const selected = this.selected();
    if (!selected || selected['status'] !== 'OPEN' || this.saving() || this.comment().length > 2000)
      return;
    this.saving.set(true);
    this.error.set('');
    this.decisionRequest.run(
      this.api.decideException(String(selected['id']), status, this.comment().trim()),
      {
        next: (updated) => {
          const leavesFilter = this.status() !== 'all' && updated['status'] !== this.status();
          const remaining = Math.max(0, this.total() - (leavesFilter ? 1 : 0));
          this.page.set(Math.min(this.page(), Math.max(1, Math.ceil(remaining / this.pageSize()))));
          this.selected.set(null);
          this.saving.set(false);
          this.notice.set(`Exception ${status.toLowerCase()}.`);
          this.load(true);
        },
        error: (err) => {
          this.error.set(err.error?.error || 'Unable to record decision');
          this.saving.set(false);
        },
      },
    );
  }
}
