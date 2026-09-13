import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { PageDrawer } from './page-drawer';

@Component({
  imports: [PageDrawer],
  template: '<app-page-drawer><input aria-label="Search" /></app-page-drawer>',
})
class Host {}

describe('Shared page drawer', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Host }])],
    });
    // jsdom lacks native modal mechanics; browser focus trapping is a separate acceptance check.
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  });

  it('opens on demand, preserves filter drafts and returns focus after Escape or backdrop dismissal', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const trigger = el.querySelector('button')!,
      dialog = el.querySelector('dialog')!,
      input = el.querySelector('input')!;
    trigger.click();
    fixture.detectChanges();
    expect(dialog.open).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    input.value = 'Bank';
    dialog.dispatchEvent(new Event('cancel'));
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    trigger.click();
    fixture.detectChanges();
    expect(input.value).toBe('Bank');
    dialog.dispatchEvent(new MouseEvent('click', { clientX: -10 }));
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
  });

  it('keeps the panel open for query filters and closes it when leaving the page', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/reports');
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector('button')!.click();
    fixture.detectChanges();
    await router.navigateByUrl('/reports?company=2');
    expect(el.querySelector('dialog')!.open).toBe(true);
    await router.navigateByUrl('/ledgers');
    expect(el.querySelector('dialog')!.open).toBe(false);
  });
});
