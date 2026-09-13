import { Component, input } from '@angular/core';
import { Icon } from './icon';

@Component({
  selector: 'app-kpi-card',
  imports: [Icon],
  template: `<article [attr.data-tone]="tone()">
    <p><app-icon [name]="icon()" />{{ label() }}</p>
    <strong class="num">{{ value() }}</strong>
    @if (detail()) {
      <span class="exact num">{{ detail() }}</span>
    }
    <small>{{ hint() }}</small>
  </article>`,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    article {
      height: 100%;
      padding: 20px;
      border: 1px solid var(--line);
      border-top: 3px solid var(--accent);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: var(--shadow-sm);
    }
    p {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 12px;
      color: var(--muted);
      font-size: 13px;
    }
    app-icon {
      width: 18px;
      height: 18px;
      flex: none;
    }
    strong {
      display: block;
      font-size: clamp(22px, 2.5vw, 30px);
      overflow-wrap: anywhere;
    }
    .exact {
      display: block;
      margin-top: 4px;
      font-size: 12px;
      color: var(--muted);
    }
    small {
      display: block;
      margin-top: 10px;
      line-height: 1.5;
      color: var(--muted);
      font-size: 12px;
    }
    [data-tone='negative'] {
      border-top-color: var(--danger);
    }
    [data-tone='negative'] strong {
      color: var(--danger);
    }
    [data-tone='positive'] {
      border-top-color: var(--positive);
    }
    [data-tone='positive'] strong {
      color: var(--positive);
    }
  `,
})
export class KpiCard {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly hint = input('');
  readonly detail = input('');
  readonly tone = input('neutral');
  readonly icon = input('overview');
}
