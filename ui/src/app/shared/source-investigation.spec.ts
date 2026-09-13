import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { SourceInvestigation } from './source-investigation';
describe('Archived evidence interaction', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [SourceInvestigation],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  it('retries failed evidence safely and renders source text without executing HTML', async () => {
    const router = TestBed.inject(Router),
      http = TestBed.inject(HttpTestingController);
    await router.navigateByUrl('/?batch=b&sourceCollection=LEDGER&sourceOrdinal=0');
    const fixture = TestBed.createComponent(SourceInvestigation);
    fixture.detectChanges();
    http
      .expectOne((r) => r.url === '/api/tally/source-record')
      .flush({}, { status: 500, statusText: 'Unavailable' });
    fixture.detectChanges();
    const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b: any) =>
      b.textContent.includes('Retry loading record'),
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();
    button.click();
    fixture.detectChanges();
    http
      .expectOne((r) => r.url === '/api/tally/source-record')
      .flush({ payload: { NAME: '<img src=x onerror=alert(1)>' } });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('pre').textContent).toContain('<img');
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    fixture.componentInstance.close();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('pre')).toBeNull();
  });
});
