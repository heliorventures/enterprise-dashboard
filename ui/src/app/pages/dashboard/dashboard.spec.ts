import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardData } from '../../models/dashboard';
import { Dashboard } from './dashboard';

function snapshot(): DashboardData {
  return {
    generatedAt: '2026-09-13T00:00:00Z',
    selectedCompany: 'all',
    tally: { connected: true, mode: 'archive', url: '', message: '', companies: [] },
    lastSync: { Source: 'Tally', Status: 'ok', Message: '', SyncedAt: '2026-09-12T00:00:00Z' },
    companies: [{ id: '1', name: 'Company one', workAdapter: '' }],
    kpis: { revenue: 100, expenses: 130, profit: -30, receivables: 10, payables: 100, cash: 50 },
    funds: {
      asOf: '2026-09-13',
      bank: 50,
      cash: 0,
      cashAndBank: 50,
      receivables: 10,
      payables: 100,
      uncommitted: -50,
      lastMonth: { key: '2026-08', label: 'August 2026', expenses: 20, inflow: 10 },
      runRate: { monthlyExpense: 20, monthlyInflow: 10, method: 'vouchers', monthsUsed: 2 },
      threeMonthBudget: 60,
      afterThreeMonths: 20,
      runwayMonths: 5,
      forecast: [],
      history: [],
      accounts: [],
      byCompany: [],
      methodNote: '',
    },
    companyFinancials: [],
    books: { ledgerCount: 3, voucherCount: 5, groups: [] },
    work: { totals: { total: 0, onTrack: 0, delayed: 0, atRisk: 0, completed: 0 }, items: [] },
  };
}
describe('Dashboard', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });
  it('clears the prior company snapshot and cancels its request when the selection changes', () => {
    const fixture = TestBed.createComponent(Dashboard);
    const component = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    const first = http.expectOne('/api/dashboard?company=all');
    component.data.set(snapshot());
    component.selectedCompany.set('1');
    component.load();
    expect(first.cancelled).toBe(true);
    expect(component.data()).toBeNull();
    http.expectOne('/api/dashboard?company=1').flush(snapshot());
    expect(component.loading()).toBe(false);
    http.verify();
  });
  it('puts financial indicators and charts before detailed records and keeps diagnostics off Overview', async () => {
    const fixture = TestBed.createComponent(Dashboard),
      http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/dashboard?company=all').flush(snapshot());
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-source-insights')).toBeNull();
    expect(el.querySelector('app-source-coverage')).toBeNull();
    expect(el.querySelectorAll('dialog app-company-select').length).toBe(1);
    const indicators = el.querySelector('[aria-label="Financial indicators"]')!;
    const charts = el.querySelector('.chart-grid')!;
    const details = el.querySelector<HTMLDetailsElement>('.disclosure')!;
    expect(
      indicators.compareDocumentPosition(charts) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(charts.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details.open).toBe(false);
    http.verify();
  });
  it('keeps empty books and absent funds unavailable instead of presenting zero liquidity', () => {
    const fixture = TestBed.createComponent(Dashboard);
    const d = snapshot();
    d.books.ledgerCount = 0;
    TestBed.inject(HttpTestingController).expectOne('/api/dashboard?company=all').flush(d);
    expect(fixture.componentInstance.kpis().every((k) => k.value === null)).toBe(true);
    expect(fixture.componentInstance.liquidityRows()).toEqual([]);
  });
  it('shows the payables gap and keeps missing forecast balances out of the chart', () => {
    const fixture = TestBed.createComponent(Dashboard);
    const d = snapshot();
    d.funds.forecast = [{ key: '2026-10', label: 'October', expenses: 20, inflow: 10 }];
    TestBed.inject(HttpTestingController).expectOne('/api/dashboard?company=all').flush(d);
    const component = fixture.componentInstance;
    expect(component.priorities().some((p) => p.title.includes('cash-to-payables gap'))).toBe(true);
    expect(component.forecastRows()).toEqual([]);
    expect(component.kpis().find((k) => k.key === 'profit')?.tone).toBe('negative');
  });
  it('shows a load error without retaining a prior balance', () => {
    const fixture = TestBed.createComponent(Dashboard);
    TestBed.inject(HttpTestingController)
      .expectOne('/api/dashboard?company=all')
      .flush({}, { status: 500, statusText: 'Failure' });
    expect(fixture.componentInstance.data()).toBeNull();
    expect(fixture.componentInstance.error()).toContain('could not be loaded');
    expect(fixture.componentInstance.loading()).toBe(false);
  });
  it('preserves the original executive summaries and dashboard drill-downs', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    const d = snapshot();
    d.books.groups = [{ name: 'Bank Accounts', count: 1, balance: -50 }];
    d.work.items = [
      {
        id: 1,
        companyId: '1',
        companyName: 'Company one',
        name: 'Project A',
        status: '',
        progress: 0,
        owner: '',
        dueDate: '',
        source: '',
        voucherCount: 2,
        invested: 100,
        earned: 50,
        net: -50,
      },
    ];
    TestBed.inject(HttpTestingController).expectOne('/api/dashboard?company=all').flush(d);
    await fixture.whenStable();
    const text = fixture.nativeElement.textContent;
    for (const label of [
      'Bank balance',
      'Model runway',
      'Headroom after 3-month budget',
      'Ledger groups',
      'Projects',
      'Company totals',
    ])
      expect(text).toContain(label);
    expect(fixture.componentInstance.groupColumns[0].link!(d.books.groups[0])).toEqual({
      path: '/ledgers',
      query: { company: 'all', group: 'Bank Accounts' },
    });
    expect(fixture.componentInstance.projectColumns[0].link!(d.work.items[0]).query).toEqual({
      company: '1',
      q: 'Project A',
    });
  });
  it('does not turn absent per-company inflow into a zero total', () => {
    const fixture = TestBed.createComponent(Dashboard);
    const d = snapshot();
    d.funds.byCompany = [
      {
        id: '1',
        name: 'Company',
        bank: 10,
        cash: 0,
        cashAndBank: 10,
        receivables: 0,
        payables: 0,
        uncommitted: 10,
        lastMonthExpenses: 1,
        nextMonthNeed: 1,
        nextMonthFund: 9,
        tone: 'ok',
        note: '',
      },
    ];
    TestBed.inject(HttpTestingController).expectOne('/api/dashboard?company=all').flush(d);
    expect(fixture.componentInstance.fundTotalRows()[0].lastMonthInflow).toBeUndefined();
    expect(
      fixture.componentInstance.totalColumns
        .find((c) => c.key === 'receipts')!
        .value(fixture.componentInstance.fundTotalRows()[0]),
    ).toBe('Not available');
  });
  it('does not reload the page report for source navigation and cancels requests on leave', async () => {
    const { Router } = await import('@angular/router');
    const router = TestBed.inject(Router),
      http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Dashboard);
    const pending = http.expectOne('/api/dashboard?company=all');
    await router.navigateByUrl('/?detailType=posting&detailsCursor=b');
    expect(pending.cancelled).toBe(false);
    http.expectNone('/api/dashboard?company=all');
    fixture.destroy();
    expect(pending.cancelled).toBe(true);
  });
});
