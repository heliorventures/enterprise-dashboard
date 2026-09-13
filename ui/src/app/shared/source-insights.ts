import { SourceBrowser } from './source-browser';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { SourceAmount, SourceCompany, SourceOverview } from '../models/source';
import { ChartRow, FinancialChart } from './financial-chart';
import { DataColumn, DataTable } from './data-table';

@Component({
  selector: 'app-source-insights',
  imports: [SourceBrowser, DatePipe, RouterLink, FinancialChart, DataTable],
  template: ` <section aria-label="Source-backed financial analysis" class="source-section">
    <header>
      <h2>Financial detail &amp; data coverage</h2>
      <button
        class="btn ghost"
        type="button"
        [disabled]="loading()"
        (click)="revision.update(nextRevision)"
      >
        Refresh analysis
      </button>
      <p>
        Figures below use the last validated source model. Signed balances retain their source
        direction.
      </p>
    </header>
    <form class="period-filter" (submit)="applyPeriod($event)">
      <label
        >From month
        <input
          type="month"
          autocomplete="off"
          name="fromMonth"
          required
          [value]="draftFrom() ?? (params().get('fromMonth') || data()?.period?.fromMonth || '')"
          (input)="draftFrom.set($any($event.target).value)"
      /></label>
      <label
        >To month
        <input
          type="month"
          autocomplete="off"
          name="toMonth"
          required
          [value]="draftTo() ?? (params().get('toMonth') || data()?.period?.toMonth || '')"
          (input)="draftTo.set($any($event.target).value)"
      /></label>
      <button class="btn ghost" type="submit" [disabled]="loading()">Apply period</button>
      <button class="btn ghost" type="button" (click)="resetPeriod()" [disabled]="loading()">
        Latest 12 months
      </button>
    </form>
    @if (data()?.period; as period) {
      <p class="meta">
        Movements: {{ period.fromMonth }} to {{ period.toMonth }}. Ledger balances remain as at the
        source capture date.
      </p>
    }
    @if (loading()) {
      <p role="status">Loading source analysis…</p>
    }
    @if (error()) {
      <p class="banner" role="alert">{{ error() }}</p>
    }
    @if (data(); as report) {
      <app-data-table
        label="Company reporting coverage"
        [rows]="report.companies"
        [columns]="columns"
        [rowKey]="companyKey"
      />
      @if (unpublished()) {
        <p class="banner">
          Some companies have no validated source model. Existing summaries may contain older,
          unreconciled imports.
        </p>
      }
      @if (company() === 'all') {
        <p class="meta">
          Choose a company in the page filter to examine its classified balances, postings and cost
          allocations. Companies are kept separate to avoid combining unknown currencies or
          accounting periods.
        </p>
      }
      @if (selected(); as selected) {
        @if (!selected.batch_id) {
          <p class="banner">
            Source analysis is unavailable until a complete export passes sync validation. Existing
            summaries have not been reconciled by this model.
          </p>
        } @else {
          <p class="meta">
            Capture: {{ selected.captured_at | date: 'dd MMM yyyy, HH:mm' }} · Books from:
            {{ selected.books_from || 'Unavailable' }} · Currency:
            {{ selected.currency || 'Unavailable' }}
          </p>
          <a routerLink="/operations" [queryParams]="{ batch: selected.batch_id }"
            >Investigate this source batch</a
          >
          @if (!selected.coverage?.uniformCurrency) {
            <p class="banner">
              Monetary charts are unavailable until the company currency and ledger currency basis
              are confirmed.
            </p>
          }
          <div class="source-charts">
            <app-financial-chart
              title="Balances by account classification"
              description="Group ancestry resolves custom accounts. These are signed ledger closing balances, not period profit."
              [unit]="selected.currency || 'Source currency unspecified'"
              [rows]="groups()"
            />
            <app-financial-chart
              title="Bank & cash posting movement"
              description="Signed source postings by month; not reconciled available cash. Debit and credit directions have not been reinterpreted."
              [unit]="selected.currency || 'Source currency unspecified'"
              [rows]="postings()"
              empty="Unavailable: complete accounting postings and classified bank/cash ledgers are required."
            />
            <app-financial-chart
              title="Cost-centre allocations"
              description="Signed allocations from voucher entries. Missing allocation amounts are excluded and flagged; these are not project budgets or profit."
              [unit]="selected.currency || 'Source currency unspecified'"
              [rows]="allocations()"
              empty="No fully valued cost-centre allocations are available."
            />
            <app-financial-chart
              title="Inventory movement values"
              description="Signed values of exported inventory entries. This does not establish stock-on-hand valuation; quantities and units are retained in the source."
              [unit]="selected.currency || 'Source currency unspecified'"
              [rows]="inventory()"
              empty="No fully valued inventory movements are available."
            />
          </div>
          <p class="meta">
            {{ masterCount() }} master records loaded. Invoice ageing and budget comparisons require
            due dates, settlements and approved budgets; unavailable inputs are not shown as zero.
          </p>
          <details (toggle)="detailsOpen.set($any($event.target).open)">
            <summary>Detailed source records</summary>
            <nav aria-label="Financial record types">
              <a
                routerLink="/reports"
                [queryParams]="{
                  company: company(),
                  fromMonth: data()?.period?.fromMonth,
                  toMonth: data()?.period?.toMonth,
                  detailType: 'ledger',
                }"
                >Ledger balances</a
              >
              ·
              <a
                routerLink="/reports"
                [queryParams]="{
                  company: company(),
                  fromMonth: data()?.period?.fromMonth,
                  toMonth: data()?.period?.toMonth,
                  detailType: 'posting',
                }"
                >Accounting postings</a
              >
              ·
              <a
                routerLink="/reports"
                [queryParams]="{
                  company: company(),
                  fromMonth: data()?.period?.fromMonth,
                  toMonth: data()?.period?.toMonth,
                  detailType: 'allocation',
                }"
                >Cost allocations</a
              >
              ·
              <a
                routerLink="/reports"
                [queryParams]="{
                  company: company(),
                  fromMonth: data()?.period?.fromMonth,
                  toMonth: data()?.period?.toMonth,
                  detailType: 'inventory',
                }"
                >Inventory movements</a
              >
            </nav>
            @if (detailsOpen()) {
              <app-source-browser
                mode="details"
                title="Financial source records"
                description="Signed values with links to their archived evidence."
              />
            }
          </details>
        }
      }
    }
  </section>`,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .source-section {
      display: grid;
      gap: 16px;
      margin-block: 24px;
      min-width: 0;
    }
    .period-filter {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: end;
    }
    .period-filter label {
      display: grid;
      gap: 6px;
    }
    .period-filter input {
      min-height: 44px;
      max-width: 100%;
    }
    header p {
      color: var(--muted);
    }
    .source-charts {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 20px;
    }
    p,
    a {
      overflow-wrap: anywhere;
    }
    @media (max-width: 900px) {
      .source-charts {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class SourceInsights {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly periodQuery = computed(() =>
    JSON.stringify({
      fromMonth: this.params().get('fromMonth'),
      toMonth: this.params().get('toMonth'),
    }),
  );
  readonly draftFrom = signal<string | null>(null);
  readonly draftTo = signal<string | null>(null);
  readonly company = input('all');
  readonly revision = signal(0);
  readonly detailsOpen = signal(false);
  readonly nextRevision = (n: number) => n + 1;
  readonly data = signal<SourceOverview | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly selected = computed(() => this.data()?.companies.find((c) => c.id === this.company()));
  readonly companyKey = (r: SourceCompany) => r.id;
  readonly columns: DataColumn<SourceCompany>[] = [
    { key: 'name', label: 'Company', value: (r) => r.name },
    {
      key: 'source',
      label: 'Reporting model',
      value: (r) => (r.batch_id ? 'Validated snapshot' : 'Unavailable'),
      primary: true,
    },
    {
      key: 'currency',
      label: 'Currency',
      value: (r) => r.currency || 'Unavailable',
      primary: true,
    },
    {
      key: 'postings',
      label: 'Vouchers with postings',
      value: (r) =>
        r.coverage
          ? `${r.coverage.vouchersWithPostings ?? 0} / ${r.coverage.vouchers ?? 0}`
          : 'Unavailable',
    },
    {
      key: 'issues',
      label: 'Validation issues',
      value: (r) => (r.batch_id ? String(r.issue_count || 0) : 'Not evaluated'),
      link: (r) => ({ path: '/operations', query: r.batch_id ? { batch: r.batch_id } : undefined }),
    },
  ];
  readonly groups = computed(() => this.chart(this.data()?.groups));
  readonly postings = computed(() =>
    this.selected()?.coverage?.postingsComplete ? this.chart(this.data()?.postings) : [],
  );
  readonly allocations = computed(() => this.chart(this.data()?.allocations));
  readonly inventory = computed(() => this.chart(this.data()?.inventory));
  readonly unpublished = computed(() => this.data()?.companies.some((c) => !c.batch_id) || false);
  readonly masterCount = computed(
    () =>
      this.data()
        ?.masters.filter((m) => m.company_id === this.company())
        .reduce((n, m) => n + m.count, 0) || 0,
  );
  constructor() {
    effect(() => {
      this.company();
      this.periodQuery();
      this.draftFrom.set(null);
      this.draftTo.set(null);
    });
    effect((onCleanup) => {
      this.revision();
      const company = this.company();
      const params: Record<string, string> = { company };
      for (const [name, value] of Object.entries(JSON.parse(this.periodQuery()))) {
        if (value) params[name] = String(value);
      }
      this.loading.set(true);
      this.error.set('');
      this.data.set(null);
      const request = this.http.get<SourceOverview>('/api/reports/source', { params }).subscribe({
        next: (result) => {
          this.data.set(result);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(
            'Unable to load source analysis. Check the API migration and sync status.',
          );
          this.loading.set(false);
        },
      });
      onCleanup(() => request.unsubscribe());
    });
  }
  applyPeriod(event: Event) {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    const fromMonth = String(form.get('fromMonth') || ''),
      toMonth = String(form.get('toMonth') || '');
    if (!fromMonth || !toMonth || fromMonth > toMonth) {
      this.error.set('Choose a valid start and end month.');
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { fromMonth, toMonth, detailsCursor: null, detailsPage: null },
      queryParamsHandling: 'merge',
    });
  }
  resetPeriod() {
    this.draftFrom.set(null);
    this.draftTo.set(null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { fromMonth: null, toMonth: null, detailsCursor: null, detailsPage: null },
      queryParamsHandling: 'merge',
    });
  }
  private chart(rows: SourceAmount[] | undefined): ChartRow[] {
    if (!this.selected()?.coverage?.uniformCurrency) return [];
    return (rows || [])
      .filter(
        (r) =>
          r.company_id === this.company() &&
          r.amount !== null &&
          Number.isFinite(Number(r.amount)) &&
          (r.valued === undefined || r.valued === r.count),
      )
      .map((r, i) => ({
        key: `${r.name}:${i}`,
        label: r.name,
        note: `${r.count} source records`,
        values: [
          {
            label: 'Signed amount',
            value: Number(r.amount),
            displayValue: `${r.amount} ${this.selected()?.currency || ''}`,
          },
        ],
      }));
  }
}
