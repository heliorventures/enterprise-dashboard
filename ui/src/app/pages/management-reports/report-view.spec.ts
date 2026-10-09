import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ReportView } from './report-view';

describe('Management report drilldown and request scope', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  it('keeps voucher type and period on daily, party and company drilldowns', () => {
    const component = TestBed.createComponent(ReportView).componentInstance;
    component.company.set('2');
    component.type.set('Payment');
    component.from.set('2026-01-01');
    component.to.set('2026-02-01');
    expect(component.columns()[0].link!({ date: '2026-01-02' }).query).toEqual({
      company: '2',
      type: 'Payment',
      from: '2026-01-02',
      to: '2026-01-02',
    });
    component.kind.set('parties');
    expect(component.columns()[0].link!({ party: 'Party' }).query).toEqual({
      company: '2',
      type: 'Payment',
      q: 'Party',
      from: '2026-01-01',
      to: '2026-02-01',
    });
    component.kind.set('companies');
    expect(component.columns()[0].link!({ company_id: '3' }).query).toEqual({
      company: '3',
      type: 'Payment',
      from: '2026-01-01',
      to: '2026-02-01',
    });
  });
  it('cancels fallback summary when report filters change', () => {
    const component = TestBed.createComponent(ReportView).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne((request) => request.url === '/api/management-reports/daily')
      .flush({ items: [], period: { from: '', to: '' } });
    const summary = http.expectOne((request) => request.url === '/api/management-reports/summary');
    component.onCompany('2');
    expect(summary.cancelled).toBe(true);
  });
});
