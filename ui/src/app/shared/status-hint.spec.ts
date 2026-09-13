import { TestBed } from '@angular/core/testing';
import { StatusHint } from './status-hint';

describe('Funding status details', () => {
  it('exposes an accessible status and supports hover, keyboard dismissal and tap without expanding the row', () => {
    const fixture = TestBed.createComponent(StatusHint);
    fixture.componentRef.setInput('status', {
      label: 'Tight',
      detail: 'Review payment dates.',
      tone: 'negative',
    });
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    const hint = fixture.nativeElement.querySelector('[popover]') as HTMLElement;
    // Native top-layer positioning still needs browser acceptance; jsdom has no Popover API.
    hint.showPopover = vi.fn();
    hint.hidePopover = vi.fn();
    expect(trigger.getAttribute('aria-label')).toBe('Tight');
    expect(trigger.getAttribute('aria-describedby')).toBe(hint.id);
    expect(trigger.getAttribute('data-tone')).toBe('negative');
    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(fixture.componentInstance.opened()).toBe(true);
    expect(hint.textContent).toContain('Review payment dates.');
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.opened()).toBe(false);
    trigger.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.opened()).toBe(true);
    trigger.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.opened()).toBe(false);
  });
});
