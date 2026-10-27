import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ImportResults } from './import-results';
import { ImportWizard } from './import-wizard';
import { ImportCompare } from './import-compare';
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

  it('stores the workbook without validating or processing it during upload', () => {
    const component = TestBed.createComponent(ImportWizard).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/companies').flush([{ id: '1', name: 'Company' }]);
    component.onCompany({ target: { value: '1' } } as unknown as Event);
    component.onFile({ target: { files: [new File(['workbook'], 'daily.xlsx')] } } as unknown as Event);
    component.upload();
    const upload = http.expectOne('/api/imports/upload');
    expect(upload.request.body.get('companyId')).toBe('1');
    upload.flush({
      file: { id: 'file-1', fileName: 'daily.xlsx', status: 'ANALYZED' },
      selectedCompany: { id: '1', name: 'Company' },
      analysis: { period: {}, counts: { dataRows: 1 }, columns: [] },
    });
    expect(component.uploaded()).toBe(true);
    http.expectNone('/api/imports/file-1/validate');
    http.expectNone('/api/imports/file-1/process');
  });

  it('compares the selected uploaded file and displays its account-level results', () => {
    const component = TestBed.createComponent(ImportCompare).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/imports').flush([
      { id: 'file-1', file_name: 'daily.xlsx', company_name: 'Company', status: 'ANALYZED', uploaded_at: '2026-10-27' },
    ]);
    component.compare();
    http.expectOne('/api/imports/file-1').flush({ file: { id: 'file-1' }, companyName: 'Company' });
    http.expectOne('/api/imports/file-1/validate').flush({
      total: 1,
      valid: 1,
      warnings: 0,
      errors: 0,
      canProcess: true,
    });
    http.expectOne('/api/imports/file-1/process').flush({
      fileId: 'file-1',
      status: 'COMPLETED',
      batchStatus: 'COMPLETED',
      percent: 100,
      message: 'Completed',
    });
    http.expectOne('/api/imports/file-1').flush({
      file: { id: 'file-1', file_name: 'daily.xlsx' },
      companyName: 'Company',
      batch: { status: 'COMPLETED' },
      accounts: [{ account_id: 'a1', account_name: 'Account', source_amount: '100.00', tally_amount: '90.00', difference: '10.00', status: 'AMOUNT_MISMATCH' }],
      tallyOnly: [],
    });
    expect(component.accountRows()).toHaveLength(1);
    expect(component.label(component.accountRows()[0]['status'])).toBe('Amount differs');
    expect(component.busy()).toBe(false);
  });

  it('filters comparison accounts inline and clears all filters together', () => {
    const component = TestBed.createComponent(ImportCompare).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/imports').flush([]);
    component.comparison.set({
      file: { id: 'file-1' },
      accounts: [
        { account_id: 'a1', account_name: 'Alpha Cement', level_1_category: 'Expenses', status: 'AMOUNT_MISMATCH' },
        { account_id: 'a2', account_name: 'Beta Steel', level_1_category: 'Expenses', status: 'MATCHED' },
        { account_id: 'a3', account_name: 'Alpha Bank', level_1_category: 'Assets', status: 'MISSING_IN_TALLY' },
      ],
    });
    component.accountSearch.set('alpha');
    component.categoryFilter.set('Expenses');
    component.differencesOnly.set(true);
    expect(component.filteredRows().map((row) => row['account_id'])).toEqual(['a1']);
    component.clearFilters();
    expect(component.filteredRows()).toHaveLength(3);
  });

  it('cancels ledger search when the search input is cleared', () => {
    const component = TestBed.createComponent(ImportSyncDetail).componentInstance;
    component.detail.set({ id: 'generation-recon', company: { tallyCompanyId: '2' } });
    const http = TestBed.inject(HttpTestingController);
    component.searchLedgers({ target: { value: 'Party' } } as unknown as Event);
    const request = http.expectOne('/api/imports/sync/generation-recon/ledgers?q=Party');
    component.searchLedgers({ target: { value: '' } } as unknown as Event);
    expect(request.cancelled).toBe(true);
    expect(component.ledgerHits()).toEqual([]);
  });
});
