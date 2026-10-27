import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-import-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="import-nav" aria-label="File workflow">
      <a routerLink="/imports/new" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">1 <span>Upload file</span></a>
      <a routerLink="/imports/compare" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">2 <span>Compare with Tally</span></a>
    </nav>
    <details class="import-more">
      <summary>More import reports</summary>
      <nav class="import-tools" aria-label="Additional import reports">
        <a routerLink="/imports" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Uploaded files</a>
        <a routerLink="/imports/missing" routerLinkActive="active">Missing in Tally</a>
        <a routerLink="/imports/sync" routerLinkActive="active">Reconciliation queue</a>
        <a routerLink="/imports/summary" routerLinkActive="active">Project summary</a>
        <a routerLink="/imports/projects" routerLinkActive="active">By project</a>
        <a routerLink="/imports/results" routerLinkActive="active">Excel outstanding</a>
        <a routerLink="/imports/exceptions" routerLinkActive="active">Exceptions</a>
        <a routerLink="/imports/quality" routerLinkActive="active">Data quality</a>
        <a routerLink="/imports/audit" routerLinkActive="active">Audit</a>
      </nav>
    </details>
  `,
  styles: `
    :host { display: grid; gap: 8px; }
    .import-nav {
      display: flex;
      width: fit-content;
      max-width: 100%;
      padding: 4px;
      gap: 4px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
    }
    .import-nav a {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      padding: 0 12px;
      border-radius: 7px;
      color: var(--muted);
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
    }
    .import-nav a:first-letter {
      color: var(--subtle);
      font-size: 11px;
    }
    .import-nav a.active {
      background: var(--accent-soft);
      color: var(--accent);
    }
    .import-more { width: fit-content; color: var(--muted); font-size: 12px; }
    .import-more summary { width: fit-content; cursor: pointer; }
    .import-tools { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 8px; }
    .import-tools a { color: var(--muted); font-size: 12px; text-decoration: none; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
    .import-tools a.active { color: var(--accent); border-color: var(--accent); }
    @media (max-width: 520px) {
      .import-nav { width: 100%; }
      .import-nav a { flex: 1; justify-content: center; padding-inline: 8px; }
      .import-nav a span { font-size: 12px; }
    }
  `,
})
export class ImportNav {}
