import { Component, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { Icon } from './icon';

export interface StatusDetail {
  label: string;
  detail: string;
  tone: 'positive' | 'warning' | 'negative' | 'neutral';
}
let nextHint = 0;

@Component({
  selector: 'app-status-hint',
  imports: [Icon],
  template: `<button
      #trigger
      type="button"
      class="status-trigger"
      [attr.data-tone]="status().tone"
      [attr.aria-label]="status().label"
      [attr.aria-describedby]="id"
      [attr.aria-expanded]="opened()"
      (mouseenter)="show()"
      (mouseleave)="leave()"
      (focus)="show()"
      (blur)="hide()"
      (click)="togglePinned()"
      (keydown.escape)="hide()"
    >
      <app-icon
        [name]="
          status().tone === 'positive' ? 'check' : status().tone === 'neutral' ? 'info' : 'warning'
        "
      />
    </button>
    <div
      #hint
      [id]="id"
      popover="manual"
      role="tooltip"
      class="status-popover"
      (mouseenter)="show()"
      (mouseleave)="leave()"
      [style.left.px]="left()"
      [style.top.px]="top()"
      [class.above]="above()"
    >
      <strong>{{ status().label }}</strong>
      <p>{{ status().detail }}</p>
    </div>`,
  styles: `
    :host {
      display: inline-flex;
    }
    .status-trigger {
      width: 36px;
      height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid currentColor;
      border-radius: 50%;
      background: var(--surface);
      cursor: help;
    }
    .status-trigger app-icon {
      width: 18px;
      height: 18px;
    }
    [data-tone='positive'] {
      color: var(--positive);
      background: var(--positive-bg);
    }
    [data-tone='warning'] {
      color: var(--warning);
      background: var(--warning-bg);
    }
    [data-tone='negative'] {
      color: var(--danger);
      background: var(--danger-bg);
    }
    [data-tone='neutral'] {
      color: var(--muted);
    }
    .status-popover {
      position: fixed;
      inset: auto;
      margin: 0;
      width: min(300px, calc(100vw - 24px));
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
      color: var(--text);
      box-shadow: var(--shadow);
      font-size: 13px;
      line-height: 1.5;
      white-space: normal;
    }
    .status-popover.above {
      transform: translateY(-100%);
    }
    p {
      margin: 6px 0 0;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    @media (pointer: coarse) {
      .status-trigger {
        width: 44px;
        height: 44px;
      }
    }
  `,
})
export class StatusHint {
  readonly status = input.required<StatusDetail>();
  readonly id = `status-detail-${++nextHint}`;
  readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  readonly hint = viewChild.required<ElementRef<HTMLElement>>('hint');
  readonly opened = signal(false);
  readonly left = signal(0);
  readonly top = signal(0);
  readonly above = signal(false);
  private pinned = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor() {
    const close = () => this.hide();
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    });
  }
  show() {
    clearTimeout(this.timer);
    const box = this.trigger().nativeElement.getBoundingClientRect();
    this.left.set(Math.max(12, Math.min(box.left, window.innerWidth - 312)));
    this.above.set(window.innerHeight - box.bottom < 180);
    this.top.set(this.above() ? box.top - 8 : box.bottom + 8);
    this.hint().nativeElement.showPopover();
    this.opened.set(true);
  }
  leave() {
    if (this.pinned || document.activeElement === this.trigger().nativeElement) return;
    this.timer = setTimeout(() => this.hide(), 150);
  }
  hide() {
    clearTimeout(this.timer);
    this.pinned = false;
    if (!this.opened()) return;
    this.hint().nativeElement.hidePopover();
    this.opened.set(false);
  }
  togglePinned() {
    if (this.pinned) this.hide();
    else {
      this.show();
      this.pinned = true;
    }
  }
}
