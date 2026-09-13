import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Transactions } from './transactions';

describe('Transactions', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Transactions],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });
  it('cancels reads and clears results for an inverted date range', () => {
    const component = TestBed.createComponent(Transactions).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    const pending = http.expectOne((r) => r.url === '/api/vouchers');
    component.from.set('2026-09-30');
    component.to.set('2026-09-01');
    component.load();
    expect(pending.cancelled).toBe(true);
    expect(component.error()).toContain('From date must be on or before');
    expect(component.loading()).toBe(false);
    expect(component.items()).toEqual([]);
    http.expectNone((r) => r.url === '/api/vouchers');
  });
  it('uses 25 rows by default and applies a draft search only when submitted', () => {
    const component = TestBed.createComponent(Transactions).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    const initial = http.expectOne((r) => r.url === '/api/vouchers');
    expect(initial.request.params.get('pageSize')).toBe('25');
    initial.flush({ items: [], total: 0, types: [] });
    component.onQuery({ target: { value: 'Rent' } } as unknown as Event);
    expect(component.query()).toBe('');
    http.expectNone((r) => r.url === '/api/vouchers');
    component.apply();
    expect(http.expectOne((r) => r.url === '/api/vouchers').request.params.get('q')).toBe('Rent');
  });
  it('does not download an incomplete export when the result exceeds the API page limit', () => {
    const component = TestBed.createComponent(Transactions).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((r) => r.url === '/api/vouchers').flush({ items: [], total: 20001, types: [] });
    component.exportCsv();
    const exportRequest = http.expectOne((r) => r.url === '/api/vouchers');
    expect(exportRequest.request.params.get('pageSize')).toBe('20000');
    exportRequest.flush({ items: [], total: 20001 });
    expect(component.error()).toContain('no partial file was downloaded');
    expect(component.exporting()).toBe(false);
  });
});
