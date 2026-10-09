import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ImportResults } from './import-results';
import { ImportWizard } from './import-wizard';
import { ImportSyncDetail } from './import-sync-detail';

describe('Import workflow correctness', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }),
  );

  it('follows the retained reconciliation generation returned by a mapping change', () => {
    const component = TestBed.createComponent(ImportSyncDetail).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    component.detail.set({ id: 'old', mapping: { canMap: true } });
    component.loading.set(false);
    component.selectedLedgerId.set('7');
    component.save();
    component.save();
    const mutations = http.match('/api/imports/sync/old/map');
    expect(mutations.length).toBe(1);
    expect(mutations[0].request.body).toEqual({ tallyLedgerId: 7 });
    mutations[0].flush({ id: 'new', mapping: { canMap: true } });
    expect(navigate).toHaveBeenCalledWith(['/imports/sync', 'new'], { replaceUrl: true });
  });

  it('cancels all previous company reports and pages outstanding with the applied search', () => {
    const component = TestBed.createComponent(ImportResults).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    const first = ['/summary', '/outstanding', '/ageing', '/reconciliation'].map((path) =>
      http.expectOne((request) => request.url === '/api/imports' + path),
    );
    component.onCompany('2');
    expect(first.every((request) => request.cancelled)).toBe(true);
    http.expectOne('/api/imports/summary?company=2').flush({ cards: {} });
    http.expectOne('/api/imports/ageing?company=2').flush({ buckets: [] });
    http.expectOne('/api/imports/reconciliation?company=2').flush([]);
    http
      .expectOne((request) => request.url === '/api/imports/outstanding')
      .flush({ items: [], total: 81 });
    component.search.set('Party');
    component.applySearch();
    const searched = http.expectOne((request) => request.url === '/api/imports/outstanding');
    expect(searched.request.params.get('q')).toBe('Party');
    expect(searched.request.params.get('page')).toBe('1');
    searched.flush({ items: [], total: 81 });
    component.onPage(2);
    const paged = http.expectOne((request) => request.url === '/api/imports/outstanding');
    expect(paged.request.params.get('page')).toBe('2');
    expect(paged.request.params.get('q')).toBe('Party');
    expect(component.total()).toBe(81);
  });

  it('clears retried outstanding errors without clearing report errors or presenting unloaded totals as zero', () => {
    const component = TestBed.createComponent(ImportResults).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    expect(component.money(0)).toBe('—');
    http
      .expectOne((request) => request.url === '/api/imports/summary')
      .flush({ error: 'Summary failed' }, { status: 500, statusText: 'Error' });
    http
      .expectOne((request) => request.url === '/api/imports/outstanding')
      .flush({ error: 'Outstanding failed' }, { status: 500, statusText: 'Error' });
    component.applySearch();
    http
      .expectOne((request) => request.url === '/api/imports/outstanding')
      .flush({ items: [], total: 0 });
    expect(component.error()).toBe('Summary failed');
    expect(component.money(0)).toBe('—');
    component.onCompany('2');
    http.expectOne('/api/imports/summary?company=2').flush({ cards: { totalOutstanding: 10 } });
    http.expectOne('/api/imports/ageing?company=2').flush({ buckets: [] });
    http.expectOne('/api/imports/reconciliation?company=2').flush([]);
    http
      .expectOne((request) => request.url === '/api/imports/outstanding')
      .flush({ items: [], total: 0 });
    expect(component.error()).toBe('');
  });

  it('shows the selected account column and invalidates validation after a mapping change', () => {
    const component = TestBed.createComponent(ImportWizard).componentInstance;
    component.result.set({
      file: { id: 'f', status: 'UPLOADED' },
      analysis: {
        columns: [
          { index: 0, canonical: 'Particulars', target: null },
          { index: 1, canonical: 'Party', target: 'account_name' },
        ],
        preview: [
          {
            sourceRowNumber: 1,
            raw: { Particulars: 'Wrong name', Party: 'Selected name' },
            rowType: 'data',
          },
        ],
      },
    });
    expect(component.sampleNames()).toEqual(['Selected name']);
    component.validation.set({ total: 1, valid: 1, warnings: 0, errors: 0, canProcess: true });
    component.setAccountNameColumn({ target: { value: 'Particulars' } } as unknown as Event);
    expect(component.validation()).toBeNull();
    expect(component.sampleNames()).toEqual(['Wrong name']);
  });

  it('reserves one processing request and rejects validation with errors even if canProcess is true', () => {
    const component = TestBed.createComponent(ImportWizard).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    component.result.set({
      file: { id: 'f', status: 'UPLOADED' },
      analysis: {
        columns: [{ index: 0, canonical: 'Party', target: 'account_name' }],
      },
    });
    component.importFile();
    component.importFile();
    const mapping = http.match('/api/imports/f/mapping');
    expect(mapping.length).toBe(1);
    mapping[0].flush({});
    http
      .expectOne('/api/imports/f/validate')
      .flush({ total: 1, valid: 0, errors: 1, warnings: 0, canProcess: true });
    http.expectNone('/api/imports/f/process');
    expect(component.busy()).toBe('');
    expect(component.error()).toContain('need a fix');
  });

  it('cancels ledger search when the search input is cleared', () => {
    const component = TestBed.createComponent(ImportSyncDetail).componentInstance;
    component.detail.set({ company: { tallyCompanyId: '2' } });
    const http = TestBed.inject(HttpTestingController);
    component.searchLedgers({ target: { value: 'Party' } } as unknown as Event);
    const request = http.expectOne('/api/imports/tally-ledgers?company=2&q=Party');
    component.searchLedgers({ target: { value: '' } } as unknown as Event);
    expect(request.cancelled).toBe(true);
    expect(component.ledgerHits()).toEqual([]);
  });
});
