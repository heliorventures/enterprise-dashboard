import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ExcelImportService, ProjectRow, ProjectSummary } from '../../services/excel-import';
import { Icon } from '../../shared/icon';
import { LatestRequest } from '../../shared/latest-request';
import { importMoney } from './import-money';
import { ImportProjectReport } from './import-project-report';

/** Excel vs Tally, project by project, for the company's latest import. */
@Component({
  selector: 'app-import-project-difference',
  imports: [Icon, RouterLink, ImportProjectReport],
  styleUrl: './imports.css',
  template: `
    <div class="section-copy">
      <h3><app-icon name="reports" /> Difference by project</h3>
      <p class="muted">
        Each Excel party is placed in a project and compared with its Tally ledger. This is saved with
        the upload, so you can show how every project moves from one upload to the next.
      </p>
    </div>
    @if (error()) {
      <p class="banner" role="alert">{{ error() }}</p>
    }
    @if (loading()) {
      <p class="empty" role="status">Loading project differences…</p>
    }
    @if (summary(); as data) {
      @if (data.currencyMessage) {
        <p class="banner" role="status">{{ data.currencyMessage }}</p>
      }
      @for (note of data.notes; track note) {
        <p class="muted" role="note">{{ note }}</p>
      }
      @if (data.projects.length === 0) {
        <p class="banner" role="status">
          No projects are set up for this company yet, so every party is under “Not assigned”.
          <a routerLink="/imports/projects">Create projects from keywords</a> and they appear here.
        </p>
      }
      <div class="desktop-table">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Parties</th>
              <th>Same as Tally</th>
              <th>Different</th>
              <th>Only in Tally</th>
              <th>Gap</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.id ?? 'none') {
              <tr [class.unassigned]="!row.id">
                <td>
                  <a [routerLink]="['/imports/projects', row.id || 'unassigned']" [queryParams]="{ company: company() }">{{ row.name }}</a>
                </td>
                <td class="num">{{ row.parties }}</td>
                <td class="num">{{ row.matched }}</td>
                <td class="num">{{ row.differences }}</td>
                <td class="num">{{ row.tallyOnlyLedgers }}</td>
                <td class="num">{{ money(row.gap) }}</td>
                <td>
                  <span class="status-pill" [attr.data-status]="row.health">{{ label(row) }}</span>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7">No Excel data is published for this company yet.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="section-copy">
        <app-import-project-report [company]="company()" />
        <a class="btn ghost" routerLink="/imports/projects" [queryParams]="{ company: company() }">Set up projects</a>
      </div>
    }
  `,
})
export class ImportProjectDifference {
  private readonly api = inject(ExcelImportService);
  private readonly request = new LatestRequest();
  /** Tally company id, as used by every company picker. */
  readonly company = input.required<string>();
  readonly summary = signal<ProjectSummary | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  readonly rows = computed<ProjectRow[]>(() => {
    const data = this.summary();
    if (!data) return [];
    return [...data.projects, data.unassigned].filter((row) => row.id || row.parties + row.tallyOnlyLedgers > 0);
  });

  constructor() {
    effect(() => {
      const company = this.company();
      this.summary.set(null);
      this.error.set('');
      if (!company) return;
      this.loading.set(true);
      this.request.run(this.api.projects(company), {
        next: (summary) => {
          this.summary.set(summary);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.error || 'Unable to load the project differences');
          this.loading.set(false);
        },
      });
    });
  }

  money(value: unknown) {
    return importMoney(value, this.summary()?.currency);
  }

  label(row: ProjectRow) {
    if (row.health === 'IN_SYNC') return 'In sync with Tally';
    if (row.health === 'HAS_GAPS') return 'Gaps to review';
    if (row.health === 'COMPARISON_UNAVAILABLE') return 'Comparison unavailable';
    return 'No parties yet';
  }
}
