import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SourceInsights } from './source-insights';
import { SourceOverview } from '../models/source';

describe('Source reporting evidence boundaries', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [SourceInsights],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  const result = (): SourceOverview => ({
    companies: [
      {
        id: '1',
        name: 'Example',
        currency: 'INR',
        batch_id: 'batch',
        books_from: null,
        starting_from: null,
        captured_at: '2026-04-01T00:00:00Z',
        coverage: {
          uniformCurrency: true,
          postingsComplete: false,
          vouchers: 1,
          vouchersWithPostings: 0,
        },
        issue_count: 1,
      },
    ],
    groups: [{ company_id: '1', name: 'Bank Accounts', amount: '-100', count: 1 }],
    postings: [{ company_id: '1', name: '2026-04', amount: '10', count: 1 }],
    allocations: [{ company_id: '1', name: 'Site A', amount: '5', count: 2, valued: 1 }],
    inventory: [],
    masters: [],
  });
  it('does not graph incomplete postings, partially valued allocations or unknown currency', () => {
    const fixture = TestBed.createComponent(SourceInsights);
    fixture.componentRef.setInput('company', '1');
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/reports/source?company=1')
      .flush(result());
    const component = fixture.componentInstance;
    expect(component.groups()[0].values[0].value).toBe(-100);
    expect(component.postings()).toEqual([]);
    expect(component.allocations()).toEqual([]);
    expect(component.incompleteCategories()).toBe(1);
    expect(component.postingEmpty()).toContain('Unavailable');
    const emptyPeriod = result();
    emptyPeriod.companies[0].coverage!.postingsComplete = true;
    emptyPeriod.postings = [];
    component.data.set(emptyPeriod);
    expect(component.postingEmpty()).toContain('selected period');
    const unknown = result();
    unknown.companies[0].coverage!.uniformCurrency = false;
    component.data.set(unknown);
    expect(component.groups()).toEqual([]);
  });
  it('cancels a previous company read and clears its figures before displaying an error', () => {
    const fixture = TestBed.createComponent(SourceInsights),
      http = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('company', '1');
    fixture.detectChanges();
    const previous = http.expectOne('/api/reports/source?company=1');
    fixture.componentRef.setInput('company', '2');
    fixture.detectChanges();
    expect(previous.cancelled).toBe(true);
    http.expectOne('/api/reports/source?company=2').flush({}, { status: 500, statusText: 'Error' });
    expect(fixture.componentInstance.data()).toBeNull();
    expect(fixture.componentInstance.error()).toContain('Unable');
  });
  it('keeps reporting periods in the URL and does not reload charts when only the cursor changes', async () => {
    const { Router } = await import('@angular/router');
    const router = TestBed.inject(Router),
      http = TestBed.inject(HttpTestingController);
    await router.navigateByUrl('/?fromMonth=2026-04&toMonth=2026-06');
    const fixture = TestBed.createComponent(SourceInsights);
    fixture.componentRef.setInput('company', '1');
    fixture.detectChanges();
    http
      .expectOne('/api/reports/source?company=1&fromMonth=2026-04&toMonth=2026-06')
      .flush({ ...result(), period: { fromMonth: '2026-04', toMonth: '2026-06' } });
    await router.navigateByUrl('/?fromMonth=2026-04&toMonth=2026-06&detailsCursor=next');
    fixture.detectChanges();
    http.expectNone((r) => r.url === '/api/reports/source');
    fixture.componentInstance.resetPeriod();
    await fixture.whenStable();
    fixture.detectChanges();
    http.expectOne('/api/reports/source?company=1').flush(result());
  });
  it('opens linked details and keeps them open after refreshing analysis', async () => {
    const { Router } = await import('@angular/router');
    const router = TestBed.inject(Router),
      http = TestBed.inject(HttpTestingController);
    await router.navigateByUrl('/?company=1&detailType=allocation');
    const fixture = TestBed.createComponent(SourceInsights);
    fixture.componentRef.setInput('company', '1');
    fixture.detectChanges();
    http.expectOne('/api/reports/source?company=1').flush(result());
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('details[aria-label="Detailed source records"]').open,
    ).toBe(true);
    const detail = http.expectOne((r) => r.url === '/api/reports/source/details');
    expect(detail.request.params.get('detailType')).toBe('allocation');
    detail.flush({ items: [], total: null, nextCursor: null });
    fixture.componentRef.setInput('refreshKey', 1);
    fixture.detectChanges();
    http.expectOne('/api/reports/source?company=1').flush(result());
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('details[aria-label="Detailed source records"]').open,
    ).toBe(true);
    http
      .expectOne((r) => r.url === '/api/reports/source/details')
      .flush({ items: [], total: null, nextCursor: null });
    http.verify();
  });
});
