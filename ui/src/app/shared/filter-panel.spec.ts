import { TestBed } from '@angular/core/testing';
import { FilterPanel } from './filter-panel';

describe('Responsive filters', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('starts collapsed on mobile and opens when returning to desktop', () => {
    let resize = () => {};
    const media = {
      matches: false,
      addEventListener: (_: string, listener: () => void) => (resize = listener),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media),
    );
    const fixture = TestBed.createComponent(FilterPanel);
    expect(fixture.componentInstance.expanded()).toBe(false);
    media.matches = true;
    resize();
    expect(fixture.componentInstance.expanded()).toBe(true);
    fixture.destroy();
    expect(media.removeEventListener).toHaveBeenCalled();
  });
});
