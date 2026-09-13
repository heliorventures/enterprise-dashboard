import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { CompanyDirectory } from '../services/company-directory';
import { CompanySelect } from './company-select';
describe('Company lookup recovery', () => {
  it('shows a failed lookup, retries independently of dashboard calculations and preserves selection', () => {
    TestBed.configureTestingModule({
      imports: [CompanySelect],
      providers: [CompanyDirectory, provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(CompanySelect),
      http = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('companies', []);
    fixture.componentRef.setInput('value', '2');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('select').disabled).toBe(true);
    http.expectOne('/api/companies').flush({}, { status: 500, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('could not');
    expect(fixture.nativeElement.querySelector('select').value).toBe('2');
    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();
    http.expectOne('/api/companies').flush([{ id: '2', name: 'Company two' }]);
    fixture.componentRef.setInput('companies', TestBed.inject(CompanyDirectory).companies());
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('select').value).toBe('2');
    expect(fixture.nativeElement.querySelector('[role=alert]')).toBeNull();
    fixture.componentRef.setInput('value','all');fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('select').value).toBe('all');
    fixture.componentRef.setInput('value','2');fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('select').value).toBe('2');
    http.verify();
  });
});
