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
});
