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
  it('shows saved failure details and filters by batch without rendering error text as HTML',()=>{
    const fixture=TestBed.createComponent(SourceBrowser);
    fixture.componentRef.setInput('mode','diagnostics');fixture.componentRef.setInput('title','Export diagnostics');
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne(r=>r.url==='/api/tally/diagnostics').flush({items:[{
      id:'error-1',company_name:'Company',occurred_at:'2026-09-15T10:00:00Z',batch_id:null,event:'source_collection_failed',collection:'VOUCHER',severity:'error',
      message:'<img src=x onerror=alert(1)>',details:{stage:'parse',xmlPath:'/ENVELOPE/LINEERROR',xmlLine:4,xmlColumn:8,tallyMessage:'Unknown collection',action:'Review collection',errorCodes:['TALLY_SOURCE_ERROR'],from:'2026-09-01',to:'2026-09-07'},
    }],total:1,page:1,pageSize:25});
    fixture.detectChanges();
    const content=fixture.nativeElement.textContent;
    expect(content).toContain('Unknown collection');expect(content).toContain('line 4');expect(content).toContain('2026-09-07');
    expect(content).toContain('not created');expect(fixture.nativeElement.querySelector('img')).toBeNull();
  });
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
  it('preserves Previous after browser-history navigation and provides retry on failure', async () => {
    const router = TestBed.inject(Router),
      http = TestBed.inject(HttpTestingController);
    await router.navigateByUrl('/?company=1');
    const fixture = TestBed.createComponent(SourceBrowser);
    fixture.componentRef.setInput('mode', 'details');
    fixture.componentRef.setInput('title', 'Records');
    fixture.detectChanges();
    const respond = (cursor: string | null) =>
      http
        .expectOne((r) => r.url === '/api/reports/source/details')
        .flush({ items: [], total: null, nextCursor: cursor });
    respond('b');
    fixture.componentInstance.go(2);
    await fixture.whenStable();
    fixture.detectChanges();
    respond('c');
    fixture.componentInstance.go(2);
    await fixture.whenStable();
    fixture.detectChanges();
    respond(null);
    await router.navigateByUrl('/?company=1&detailsCursor=b');
    fixture.detectChanges();
    respond('c');
    fixture.componentInstance.go(0);
    await fixture.whenStable();
    fixture.detectChanges();
    const first = http.expectOne((r) => r.url === '/api/reports/source/details');
    expect(first.request.params.has('cursor')).toBe(false);
    first.flush({}, { status: 500, statusText: 'Unavailable' });
    fixture.detectChanges();
    const retry = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b: any) =>
      b.textContent.includes('Retry'),
    ) as HTMLButtonElement;
    expect(retry).toBeTruthy();
    retry.click();
    fixture.detectChanges();
    respond(null);
    http.verify();
  });
  it('passes the selected company to master and archive browsing', async () => {
    const router = TestBed.inject(Router),
      http = TestBed.inject(HttpTestingController);
    await router.navigateByUrl('/?company=2');
    const fixture = TestBed.createComponent(SourceBrowser);
    fixture.componentRef.setInput('mode', 'masters');
    fixture.componentRef.setInput('title', 'Masters');
    fixture.detectChanges();
    const request = http.expectOne((r) => r.url === '/api/reports/source/masters');
    expect(request.request.params.get('company')).toBe('2');
    request.flush({ items: [], total: 0 });
    fixture.componentRef.setInput('mode', 'archives');
    fixture.detectChanges();
    const archive = http.expectOne((r) => r.url === '/api/tally/archives');
    expect(archive.request.params.get('company')).toBe('2');
    archive.flush({ items: [], total: 0 });
    http.verify();
  });
});
