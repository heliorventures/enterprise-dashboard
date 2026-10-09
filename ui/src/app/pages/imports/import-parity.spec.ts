import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ImportAccount } from './import-account';
import { ImportExceptions } from './import-exceptions';
import { ImportQualityView } from './import-quality';
import { ImportAudit } from './import-audit';
import { ImportExport } from './import-export';
import { ImportDetail } from './import-detail';
import { comparisonMoney } from './import-columns';
import { routes } from '../../app.routes';

describe('Retained import workflows', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }),
  );

  it('places authenticated static import routes before the file route', () => {
    const fileRoute = routes.findIndex((route) => route.path === 'imports/:id');
    for (const path of [
      'imports/accounts/:id',
      'imports/exceptions',
      'imports/quality',
      'imports/audit',
    ]) {
      const index = routes.findIndex((route) => route.path === path);
      expect(index).toBeGreaterThan(-1);
      expect(index).toBeLessThan(fileRoute);
      expect(routes[index].canActivate?.length).toBe(1);
    }
  });

  it('cancels account reads when the account route changes and renders retained sections', () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'first' }));
    TestBed.overrideProvider(ActivatedRoute, { useValue: { paramMap: params } });
    const fixture = TestBed.createComponent(ImportAccount);
    const http = TestBed.inject(HttpTestingController);
    const first = http.expectOne('/api/imports/accounts/first');
    params.next(convertToParamMap({ id: 'second' }));
    expect(first.cancelled).toBe(true);
    http.expectOne('/api/imports/accounts/second').flush({
      account: { account_name: 'Second party', company_name: 'Company' },
      outstanding: [{ id: 'o', reporting_date: '2026-10-01', pending_bill_debit: '500.25' }],
      ageing: [],
      exceptions: [],
      audit: [],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Second party');
    expect(fixture.nativeElement.textContent).toContain('Snapshot history');
  });

  it('cancels reused import detail and issue requests and exposes batch provenance', () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'first' }));
    TestBed.overrideProvider(ActivatedRoute, { useValue: { paramMap: params } });
    const fixture = TestBed.createComponent(ImportDetail);
    const http = TestBed.inject(HttpTestingController);
    const first = http.expectOne('/api/imports/first');
    const issues = http.expectOne('/api/imports/first/errors');
    params.next(convertToParamMap({ id: 'second' }));
    expect(first.cancelled).toBe(true);
    expect(issues.cancelled).toBe(true);
    http.expectOne('/api/imports/second').flush({
      file: { file_name: 'Second file' },
      batch: {
        generation: 2,
        reporting_date: '2026-10-01',
        tally_balance_date: null,
        tally_batch_id: 'archive-2',
      },
    });
    http.expectOne('/api/imports/second/errors').flush([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Snapshot provenance');
    expect(fixture.nativeElement.textContent).toContain('archive-2');
    expect(fixture.nativeElement.textContent).toContain('Unknown');
    expect(comparisonMoney(null)).toBe('Unavailable');
  });

  it('cancels exception filters and submits only one decision with its comment', () => {
    const component = TestBed.createComponent(ImportExceptions).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    const first = http.expectOne(
      '/api/imports/exceptions?company=all&status=OPEN&page=1&pageSize=50',
    );
    component.onCompany('2');
    expect(first.cancelled).toBe(true);
    const row = { id: 'e', title: 'Difference', account_name: 'Party', status: 'OPEN' };
    http
      .expectOne('/api/imports/exceptions?company=2&status=OPEN&page=1&pageSize=50')
      .flush({ items: [row], total: 1, page: 1, pageSize: 50 });
    component.review(row);
    component.comment.set('Reviewed with accounts');
    component.decide('RESOLVED');
    component.decide('REJECTED');
    const decisions = http.match('/api/imports/exceptions/e');
    expect(decisions.length).toBe(1);
    expect(decisions[0].request.body).toEqual({
      status: 'RESOLVED',
      comment: 'Reviewed with accounts',
    });
    decisions[0].flush({ id: 'e', status: 'RESOLVED' });
    http
      .expectOne('/api/imports/exceptions?company=2&status=OPEN&page=1&pageSize=50')
      .flush({ items: [], total: 0, page: 1, pageSize: 50 });
    expect(component.rows()).toEqual([]);
    expect(component.saving()).toBe(false);
  });

  it('fetches later exception pages with the server total and reaches exception 501', () => {
    const component = TestBed.createComponent(ImportExceptions).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne('/api/imports/exceptions?company=all&status=OPEN&page=1&pageSize=50')
      .flush({ items: [{ id: 'first', status: 'OPEN' }], total: 501, page: 1, pageSize: 50 });
    component.onPage(2);
    const second = http.expectOne(
      '/api/imports/exceptions?company=all&status=OPEN&page=2&pageSize=50',
    );
    expect(component.total()).toBe(501);
    component.onPage(11);
    expect(second.cancelled).toBe(true);
    http
      .expectOne('/api/imports/exceptions?company=all&status=OPEN&page=11&pageSize=50')
      .flush({
        items: [{ id: 'exception-501', status: 'OPEN' }],
        total: 501,
        page: 11,
        pageSize: 50,
      });
    expect(component.rows()[0]['id']).toBe('exception-501');
    expect(component.page()).toBe(11);
    expect(component.total()).toBe(501);
  });

  it('cancels quality company reads and shows API counts and issue types', () => {
    const fixture = TestBed.createComponent(ImportQualityView);
    const http = TestBed.inject(HttpTestingController);
    const first = http.expectOne('/api/imports/quality?company=all');
    fixture.componentInstance.onCompany('3');
    expect(first.cancelled).toBe(true);
    http
      .expectOne('/api/imports/quality?company=3')
      .flush({ accounts: 12, missing_gst: 3, issues: [{ type: 'MISSING_GST', count: 3 }] });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Missing GST');
    expect(fixture.nativeElement.textContent).toContain('MISSING GST');
  });

  it('cancels audit requests when filters change and applies the documented limit', () => {
    const component = TestBed.createComponent(ImportAudit).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    const first = http.expectOne('/api/imports/audit?limit=100');
    component.entity.set('exception');
    component.limit.set(50);
    component.load();
    expect(first.cancelled).toBe(true);
    http.expectOne('/api/imports/audit?entity=exception&limit=50').flush([]);
    expect(component.loading()).toBe(false);
  });

  it('exports the complete server CSV with filters and cancels downloads when scope changes', () => {
    const fixture = TestBed.createComponent(ImportExport);
    fixture.componentRef.setInput('type', 'outstanding');
    fixture.componentRef.setInput('company', '2');
    fixture.componentRef.setInput('q', 'Party');
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    component.download();
    const first = http.expectOne('/api/imports/reports/outstanding.csv?company=2&q=Party');
    expect(first.request.responseType).toBe('blob');
    fixture.componentRef.setInput('company', '3');
    fixture.detectChanges();
    expect(first.cancelled).toBe(true);
    expect(component.exporting()).toBe(false);
    component.download();
    http
      .expectOne('/api/imports/reports/outstanding.csv?company=3&q=Party')
      .flush(new Blob(['too many']), { status: 413, statusText: 'Too large' });
    expect(component.error()).toContain('complete CSV');
  });

  it('downloads the server blob once and releases its URL after the browser starts the download', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:complete-report');
    const revoke = vi.fn();
    const OriginalURL = URL;
    class DownloadURL extends OriginalURL {
      static override createObjectURL = create;
      static override revokeObjectURL = revoke;
    }
    vi.stubGlobal('URL', DownloadURL);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      const fixture = TestBed.createComponent(ImportExport);
      fixture.componentRef.setInput('type', 'exceptions');
      fixture.componentRef.setInput('status', 'OPEN');
      fixture.detectChanges();
      fixture.componentInstance.download();
      fixture.componentInstance.download();
      const requests = TestBed.inject(HttpTestingController).match(
        '/api/imports/reports/exceptions.csv?company=all&status=OPEN',
      );
      expect(requests.length).toBe(1);
      const blob = new Blob(['id,title\r\n1,Reviewed\r\n']);
      requests[0].flush(blob);
      expect(create).toHaveBeenCalledWith(blob);
      expect(click).toHaveBeenCalledTimes(1);
      expect(revoke).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(revoke).toHaveBeenCalledWith('blob:complete-report');
      expect(fixture.componentInstance.exporting()).toBe(false);
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
