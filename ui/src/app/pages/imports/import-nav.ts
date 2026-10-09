import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-import-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <p class="import-purpose">
      Put one company’s Excel outstanding report next to Tally. See what matches and what does not.
      Overview, ledgers, and Tally books are not changed.
    </p>
    <nav class="import-nav" aria-label="Excel import">
      <a routerLink="/imports/new" routerLinkActive="active">1. Upload Excel</a>
      <a routerLink="/imports" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">2. Uploaded files</a>
      <a routerLink="/imports/sync" routerLinkActive="active">3. Compare with Tally</a>
      <a routerLink="/imports/results" routerLinkActive="active">Excel outstanding</a>
    </nav>
  `,
  styles: `
    :host {
      display: grid;
      gap: 12px;
    }
    .import-purpose {
      margin: 0;
      max-width: 72ch;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.55;
    }
    .import-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    a {
      display: inline-flex;
      align-items: center;
      height: 36px;
      padding: 0 14px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--muted);
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
    }
    a.active {
      background: var(--accent-soft);
      border-color: #8fb0ee;
      color: var(--accent);
    }
  `,
})
export class ImportNav {}
