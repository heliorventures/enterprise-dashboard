import { Component, input } from '@angular/core';

@Component({
  selector: 'app-page-header',
  template: `<header>
    <div class="heading">
      <p class="eyebrow">{{ eyebrow() }}</p>
      <h1>{{ title() }}</h1>
      @if (description()) {
        <p class="description">{{ description() }}</p>
      }
    </div>
    <div class="actions"><ng-content /></div>
  </header>`,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 20px;
    }
    .heading,
    .actions {
      min-width: 0;
    }
    .description {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.6;
      max-width: 64ch;
    }
    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: clamp(26px, 3vw, 34px);
      font-weight: 560;
    }
    .actions {
      display: flex;
      gap: 12px;
      align-items: flex-end;
      flex-wrap: wrap;
    }
    .actions:empty {
      display: none;
    }
    @media (max-width: 1000px) {
      header {
        align-items: stretch;
        flex-direction: column;
      }
      .actions {
        width: 100%;
      }
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly eyebrow = input('');
  readonly description = input('');
}
