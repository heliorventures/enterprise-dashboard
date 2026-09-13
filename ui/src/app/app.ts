import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from './services/auth';
import { Icon } from './shared/icon';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, NgTemplateOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly menu = viewChild<ElementRef<HTMLDialogElement>>('menu');
  readonly menuOpen = signal(false);
  readonly links = [
    { path: '/dashboard', label: 'Overview', icon: 'overview' },
    { path: '/reports', label: 'Expenses & projects', icon: 'reports' },
    { path: '/ledgers', label: 'Ledgers', icon: 'ledgers' },
    { path: '/transactions', label: 'Transactions', icon: 'transactions' },
    { path: '/operations', label: 'Data operations', icon: 'operations' },
  ];

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) this.closeMenu();
    });
    const desktop = window.matchMedia('(min-width: 901px)');
    const onResize = () => {
      if (desktop.matches) this.closeMenu();
    };
    desktop.addEventListener('change', onResize);
    this.destroyRef.onDestroy(() => desktop.removeEventListener('change', onResize));
  }

  openMenu() {
    this.menu()?.nativeElement.showModal();
    this.menuOpen.set(true);
  }

  closeMenu() {
    this.menu()?.nativeElement.close();
    this.menuOpen.set(false);
  }

  dismissBackdrop(event: MouseEvent) {
    if (event.target !== this.menu()?.nativeElement) return;
    const bounds = this.menu()!.nativeElement.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      this.closeMenu();
  }

  logout() {
    this.closeMenu();
    void this.auth.logout();
  }
}
