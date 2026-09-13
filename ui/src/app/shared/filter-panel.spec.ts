import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FilterPanel } from './filter-panel';

describe('Responsive filters', () => {
  it('keeps filters behind an accessible drawer trigger on desktop as well as mobile', () => {
    const fixture = TestBed.createComponent(FilterPanel);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector('button[aria-haspopup="dialog"]');
    expect(trigger).not.toBeNull();
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(false);
  });
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));
  afterEach(() => vi.unstubAllGlobals());
});
