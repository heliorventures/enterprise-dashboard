import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ExpenseReport } from '../../models/books';
import { Reports } from './reports';

describe('Reports scope and loading', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Reports],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });
  const report: ExpenseReport = {
    total: 100,
    ledgerCount: 1,
    lastMonth: {
      key: '2026-08',
      label: 'August 2026',
      from: '2026-08-01',
      count: 2,
      withAmount: 1,
      amount: 100,
    },
    companies: [
      {
        id: '1',
        name: 'Company',
        total: 100,
        ledgerCount: 1,
        groups: [
          {
            name: 'Expenses',
            total: 100,
            ledgerCount: 1,
            ledgers: [
              {
                id: 3,
                name: 'Rent',
                group: 'Expenses',
                companyId: '1',
                companyName: 'Company',
                balance: 100,
              },
            ],
          },
        ],
      },
    ],
  };
  it('preserves company and group in drill-down links and does not broaden an invalid group', () => {
    const component = TestBed.createComponent(Reports).componentInstance;
    component.report.set(report);
    expect(component.expenseRows()[0].link.query).toEqual({ company: '1' });
    component.company.set('1');
    expect(component.expenseRows()[0].link.query).toEqual({ company: '1', group: 'Expenses' });
    component.group.set('Expenses');
    expect(component.expenseRows()[0].link).toEqual({
      path: '/ledgers',
      query: { company: '1', group: 'Expenses', q: 'Rent' },
    });
    component.group.set('Nonexistent group');
    expect(component.expenseRows()).toEqual([]);
  });
  it('uses an inclusive last calendar date for the supporting vouchers and surfaces their load failure', () => {
    const component = TestBed.createComponent(Reports).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/reports/expenses?company=all').flush(report);
    const request = http.expectOne((r) => r.url === '/api/vouchers');
    expect(request.request.params.get('to')).toBe('2026-08-31');
    request.flush({}, { status: 500, statusText: 'Failure' });
    expect(component.voucherError()).toContain('could not be loaded');
    expect(component.loadingVouchers()).toBe(false);
    expect(component.vouchers()).toEqual([]);
  });
  it('restores group counts and the ledger activity shortcut with company and month scope', () => {
    const component = TestBed.createComponent(Reports).componentInstance;
    component.report.set(report);
    expect(component.expenseRows()[0].groups).toBe(1);
    component.company.set('1');
    component.group.set('Expenses');
    const row = component.expenseRows()[0];
    expect(component.expenseColumns().find((c) => c.key === 'payments')!.link!(row)).toEqual({
      path: '/transactions',
      query: { company: '1', q: 'Rent', from: '2026-08-01', to: '2026-08-31' },
    });
  });
  it('does not reload the page report for source navigation and cancels requests on leave', async () => {
    const { Router } = await import('@angular/router');
    const router = TestBed.inject(Router),
      http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Reports);
    const pending = http.expectOne('/api/reports/expenses?company=all');
    await router.navigateByUrl('/?detailType=posting&detailsCursor=b');
    expect(pending.cancelled).toBe(false);
    http.expectNone('/api/reports/expenses?company=all');
    fixture.destroy();
    expect(pending.cancelled).toBe(true);
  });
  it('renders period controls in the shared drawer without a routine refresh action', async () => {
    const fixture = TestBed.createComponent(Reports),
      http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/companies').flush([]);
    http.expectOne('/api/reports/expenses?company=all').flush(report);
    http.expectOne((r) => r.url === '/api/vouchers').flush({ items: [], total: 0 });
    http
      .expectOne('/api/reports/projects?company=all')
      .flush({ companies: [], projectCount: 0, linkedVoucherCount: 0 });
    fixture.detectChanges();
    http.expectOne('/api/reports/source?company=all').flush({
      companies: [],
      groups: [],
      postings: [],
      allocations: [],
      inventory: [],
      masters: [],
      period: { fromMonth: '2026-04', toMonth: '2026-09' },
    });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('dialog input[type="month"]').length).toBe(2);
    const refresh = Array.from(el.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'Refresh',
    );
    expect(refresh.length).toBe(0);
    expect(el.textContent).not.toContain('Refresh analysis');
    expect(el.textContent).not.toContain('Reporting model');
    const form = el.querySelector('dialog form')!;
    const from = form.querySelector<HTMLInputElement>('[name="fromMonth"]')!;
    const to = form.querySelector<HTMLInputElement>('[name="toMonth"]')!;
    from.value = '2026-07';
    to.value = '2026-09';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    const changed = http.expectOne(
      '/api/reports/source?company=all&fromMonth=2026-07&toMonth=2026-09',
    );
    changed.flush({
      companies: [],
      groups: [],
      postings: [],
      allocations: [],
      inventory: [],
      masters: [],
      period: { fromMonth: '2026-07', toMonth: '2026-09' },
    });
    await fixture.whenStable();
    http.verify();
  });
});
