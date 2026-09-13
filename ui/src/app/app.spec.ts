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
  it('opens a modal and closes it after navigation', async () => {
    const { fixture, dialog } = await render();
    fixture.componentInstance.openMenu();
    expect(dialog.showModal).toHaveBeenCalled();
    expect(fixture.componentInstance.menuOpen()).toBe(true);
    await TestBed.inject(Router).navigateByUrl('/reports');
    expect(fixture.componentInstance.menuOpen()).toBe(false);
    expect(dialog.close).toHaveBeenCalled();
  });
  it('updates the expanded state when Escape cancels the native dialog', async () => {
    const { fixture, dialog } = await render();
    fixture.componentInstance.openMenu();
    dialog.dispatchEvent(new Event('cancel'));
    expect(fixture.componentInstance.menuOpen()).toBe(false);
  });
});
