import { Component, input } from '@angular/core';
import { PageDrawer } from './page-drawer';
@Component({
  selector: 'app-filter-panel',
  imports: [PageDrawer],
  template: `<div class="filter-summary">
    <p>{{ summary() }}</p>
    <app-page-drawer label="Search & filters"><ng-content /></app-page-drawer>
  </div>`,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .filter-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 20px;
      border-bottom: 1px solid var(--line);
    }
    p {
      margin: 0;
      font-size: 12px;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    app-page-drawer {
      flex-shrink: 0;
    }
    @media (max-width: 480px) {
      .filter-summary {
        flex-wrap: wrap;
        padding-inline: 16px;
      }
    }
  `,
})
export class FilterPanel {
  readonly summary = input('All records');
}
