import { Component, DestroyRef, inject, input, signal } from '@angular/core';

@Component({
  selector: 'app-filter-panel',
  template: `<details [open]="expanded()" (toggle)="onToggle($event)">
    <summary>
      Search & filters<span>{{ summary() }}</span>
    </summary>
    <ng-content />
  </details>`,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    summary {
      padding: 16px;
      color: var(--accent);
      font-size: 14px;
      font-weight: 600;
      border-bottom: 1px solid var(--line);
    }
    summary span {
      display: block;
      margin: 6px 0 0;
      color: var(--muted);
      font-weight: 400;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    @media (min-width: 761px) {
      summary {
        display: none;
      }
    }
  `,
})
export class FilterPanel {
  readonly summary = input('All records');
  readonly expanded = signal(true);
  constructor() {
    const wide = window.matchMedia?.('(min-width: 761px)');
    if (!wide) return;
    this.expanded.set(wide.matches);
    const resize = () => this.expanded.set(wide.matches);
    wide.addEventListener('change', resize);
    inject(DestroyRef).onDestroy(() => wide.removeEventListener('change', resize));
  }
  onToggle(event: Event) {
    this.expanded.set((event.target as HTMLDetailsElement).open);
  }
}
