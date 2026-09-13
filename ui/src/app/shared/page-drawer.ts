import { Component, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Icon } from './icon';

@Component({
  selector: 'app-page-drawer',
  imports: [Icon],
  template: ` <button
      #trigger
      type="button"
      class="btn ghost"
      aria-haspopup="dialog"
      [attr.aria-expanded]="opened()"
      (click)="open()"
    >
      <app-icon name="filter" />{{ label() }}
    </button>
    <dialog
      #drawer
      class="page-drawer"
      [attr.aria-label]="label()"
      (cancel)="$event.preventDefault(); close()"
      (close)="onClose()"
      (click)="backdrop($event)"
    >
      <header class="drawer-heading">
        <h2>{{ label() }}</h2>
        <button
          type="button"
          class="btn ghost"
          aria-label="Close panel"
          (click)="close()"
          autofocus
        >
          <app-icon name="close" />
        </button>
      </header>
      <div class="drawer-content"><ng-content /></div>
      <footer class="drawer-footer">
        <button type="button" class="btn primary" (click)="close()">Done</button>
      </footer>
    </dialog>`,
  styleUrl: './page-drawer.css',
})
export class PageDrawer {
  readonly label = input('Filters & information');
  readonly opened = signal(false);
  readonly drawer = viewChild.required<ElementRef<HTMLDialogElement>>('drawer');
  readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  constructor() {
    const router = inject(Router);
    router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      // Query-string changes apply filters inside the drawer; a different page dismisses it.
      if (event instanceof NavigationStart && event.url.split('?')[0] !== router.url.split('?')[0])
        this.close();
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.opened()) this.drawer().nativeElement.close();
    });
  }
  open() {
    this.drawer().nativeElement.showModal();
    this.opened.set(true);
  }
  close() {
    if (!this.opened()) return;
    this.drawer().nativeElement.close();
    this.onClose();
  }
  onClose() {
    if (!this.opened() || this.drawer().nativeElement.open) return;
    this.opened.set(false);
    this.trigger().nativeElement.focus();
  }
  backdrop(event: MouseEvent) {
    if (event.target !== this.drawer().nativeElement) return;
    const box = this.drawer().nativeElement.getBoundingClientRect();
    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    )
      this.close();
  }
}
