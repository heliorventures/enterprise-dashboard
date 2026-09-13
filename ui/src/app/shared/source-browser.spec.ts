import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { SourceBrowser } from './source-browser';

describe('Source cursor navigation', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [SourceBrowser],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  it('uses server cursors for Next and Previous and recovers from a replaced snapshot', async () => {
    const router = TestBed.inject(Router),
      http = TestBed.inject(HttpTestingController);
    await router.navigateByUrl('/?company=1&fromMonth=2026-04&toMonth=2026-06');
    const fixture = TestBed.createComponent(SourceBrowser);
    fixture.componentRef.setInput('mode', 'details');
    fixture.componentRef.setInput('title', 'Records');
    fixture.detectChanges();
    const response = {
      items: [],
      total: null,
      page: 1,
      pageSize: 25,
      hasMore: true,
      nextCursor: 'next',
    };
    const first = http.expectOne((r) => r.url === '/api/reports/source/details');
    expect(first.request.params.has('page')).toBe(false);
    expect(first.request.params.get('fromMonth')).toBe('2026-04');
    first.flush(response);
    fixture.componentInstance.go(2);
    await fixture.whenStable();
    fixture.detectChanges();
    const second = http.expectOne((r) => r.url === '/api/reports/source/details');
    expect(second.request.params.get('cursor')).toBe('next');
    second.flush({ ...response, nextCursor: 'last' });
    fixture.componentInstance.go(0);
    await fixture.whenStable();
    fixture.detectChanges();
    const back = http.expectOne((r) => r.url === '/api/reports/source/details');
    expect(back.request.params.has('cursor')).toBe(false);
    back.flush(response);
    fixture.componentInstance.go(2);
    await fixture.whenStable();
    fixture.detectChanges();
    http
      .expectOne((r) => r.url === '/api/reports/source/details')
      .flush({}, { status: 409, statusText: 'Conflict' });
    expect(fixture.componentInstance.error()).toContain('changed');
    expect(fixture.componentInstance.nextCursor()).toBeNull();
    fixture.componentInstance.go(0);
    await fixture.whenStable();
    fixture.detectChanges();
    const reset = http.expectOne((r) => r.url === '/api/reports/source/details');
    expect(reset.request.params.has('cursor')).toBe(false);
    reset.flush({ ...response, nextCursor: null });
    http.verify();
  });
});
