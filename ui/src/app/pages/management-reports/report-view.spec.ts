import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ReportView } from './report-view';
import { ReportHub } from './report-hub';

describe('Management report drilldown and request scope', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideRouter([
        { path: 'management-reports', component: ReportHub },
        { path: 'management-reports/:kind', component: ReportView },
      ]), provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  it('keeps applied company, voucher type, dates and threshold when switching report links', async () => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/management-reports/daily', ReportView);
    component.company.set('2');
    component.type.set('Payment');
    component.from.set('2026-01-01');
    component.to.set('2026-02-01');
    component.minAmount.set('250000');
    component.apply();
    harness.detectChanges();
    const weeklyLink = harness.routeNativeElement!.querySelector<HTMLAnchorElement>('a[href*="/management-reports/weekly"]')!;
    const weekly = await harness.navigateByUrl(weeklyLink.getAttribute('href')!, ReportView);
    expect(weekly.company()).toBe('2');
    expect(weekly.type()).toBe('Payment');
    expect(weekly.from()).toBe('2026-01-01');
    expect(weekly.to()).toBe('2026-02-01');
    expect(weekly.minAmount()).toBe('250000');
    const http = TestBed.inject(HttpTestingController);
    const requests = http.match((request) => request.url === '/api/management-reports/weekly');
    expect(requests.length).toBeGreaterThan(0);
    const params = requests[requests.length - 1].request.params;
    expect(params.get('company')).toBe('2');
    expect(params.get('type')).toBe('Payment');
    harness.detectChanges();
    const menuLink = harness.routeNativeElement!.querySelector<HTMLAnchorElement>('a[href^="/management-reports?"]')!;
    await harness.navigateByUrl(menuLink.getAttribute('href')!, ReportHub);
    harness.detectChanges();
    const largeLink = harness.routeNativeElement!.querySelector<HTMLAnchorElement>('a.report-card[href*="/management-reports/large"]')!;
    const large = await harness.navigateByUrl(largeLink.getAttribute('href')!, ReportView);
    expect(large.company()).toBe('2');
    expect(large.type()).toBe('Payment');
    expect(large.minAmount()).toBe('250000');
    large.clear();
    harness.detectChanges();
    const dailyLink = harness.routeNativeElement!.querySelector<HTMLAnchorElement>('a[href*="/management-reports/daily"]')!;
    const daily = await harness.navigateByUrl(dailyLink.getAttribute('href')!, ReportView);
    expect(daily.company()).toBe('all');
    expect(daily.type()).toBe('');
    expect(daily.minAmount()).toBe('100000');
  });
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
