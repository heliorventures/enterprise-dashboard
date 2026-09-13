import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { Auth } from './services/auth';

@Component({ template: '' })
class TestPage {}

describe('App navigation', () => {
  beforeEach(async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([{ path: 'reports', component: TestPage }]),
        {
          provide: Auth,
          useValue: { ready: signal(true), user: signal({ name: 'Reviewer' }), logout: vi.fn() },
        },
      ],
    }).compileComponents();
  });
  afterEach(() => vi.unstubAllGlobals());

  async function render() {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    dialog.showModal = vi.fn(() => dialog.setAttribute('open', ''));
    dialog.close = vi.fn(() => dialog.removeAttribute('open'));
    return { fixture, dialog };
  }
  it('starts with a closed mobile menu and exposes its accessible state', async () => {
    const { fixture, dialog } = await render();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(fixture.nativeElement.querySelector('.menu-toggle').getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(fixture.nativeElement.querySelector('.skip-link').getAttribute('href')).toBe(
      '#main-content',
    );
  });
  it('starts with an icon rail, toggles desktop labels and retains the choice during navigation', async () => {
    const { fixture } = await render();
    const el = fixture.nativeElement as HTMLElement;
    const toggle = el.querySelector<HTMLButtonElement>('.sidebar-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('.shell')?.classList.contains('sidebar-collapsed')).toBe(true);
    toggle!.click();
    fixture.detectChanges();
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    await TestBed.inject(Router).navigateByUrl('/reports');
    fixture.detectChanges();
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    toggle!.click();
    fixture.detectChanges();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('.desktop-sidebar a.nav-link')?.getAttribute('aria-label')).toBe(
      'Overview',
    );
    expect(el.querySelector('.mobile-menu .nav-label')?.textContent).toBe('Overview');
  });
  it('opens a modal and closes it after navigation', async () => {
    const { fixture, dialog } = await render();
    fixture.componentInstance.openMenu();
    expect(dialog.showModal).toHaveBeenCalled();
    expect(fixture.componentInstance.menuOpen()).toBe(true);
    await TestBed.inject(Router).navigateByUrl('/reports');
    expect(fixture.componentInstance.menuOpen()).toBe(false);
    expect(dialog.close).toHaveBeenCalled();
  });
  it('positions collapsed menu names on hover and focus and dismisses them with Escape', async () => {
    const { fixture } = await render();
    const link = fixture.nativeElement.querySelector(
      '.desktop-sidebar a.nav-link',
    ) as HTMLAnchorElement;
    link.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(link.style.getPropertyValue('--nav-hint-top')).toBe('0px');
    expect(fixture.componentInstance.hintsDismissed()).toBe(false);
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.hintsDismissed()).toBe(true);
    link.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(fixture.componentInstance.hintsDismissed()).toBe(false);
  });
  it('updates the expanded state when Escape cancels the native dialog', async () => {
    const { fixture, dialog } = await render();
    fixture.componentInstance.openMenu();
    dialog.dispatchEvent(new Event('cancel'));
    expect(fixture.componentInstance.menuOpen()).toBe(false);
  });
});
