import { Component, effect, inject, input, signal } from '@angular/core';
import { ExcelImportService } from '../../services/excel-import';
import { Icon } from '../../shared/icon';
import { LatestRequest } from '../../shared/latest-request';

/** Downloads of the Tally vs Excel difference report for one company. */
@Component({
  selector: 'app-import-project-report',
  imports: [Icon],
  styles: `
    :host {
      display: inline-block;
    }
    .report-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
  `,
  template: `
    <div class="report-actions">
      <button class="btn primary" type="button" [disabled]="!!busy() || !company()" (click)="download('xlsx')">
        <app-icon name="download" /> {{ busy() === 'xlsx' ? 'Preparing…' : 'Download Excel report' }}
      </button>
      <button class="btn ghost" type="button" [disabled]="!!busy() || !company()" (click)="download('csv')">
        <app-icon name="download" /> {{ busy() === 'csv' ? 'Preparing…' : 'CSV' }}
      </button>
    </div>
    @if (error()) {
      <p class="banner" role="alert">{{ error() }}</p>
    }
  `,
})
export class ImportProjectReport {
  private readonly api = inject(ExcelImportService);
  private readonly request = new LatestRequest();
  readonly company = input.required<string>();
  /** Which report to download: the project differences or what is missing in Tally. */
  readonly kind = input<'projects' | 'missing'>('projects');
  readonly busy = signal<'' | 'xlsx' | 'csv'>('');
  readonly error = signal('');

  constructor() {
    effect(() => {
      this.company();
      this.request.cancel();
      this.busy.set('');
      this.error.set('');
    });
  }

  download(format: 'xlsx' | 'csv') {
    if (this.busy() || !this.company()) return;
    this.busy.set(format);
    this.error.set('');
    const call = this.kind() === 'missing' ? this.api.missingReport(this.company(), format) : this.api.projectReport(this.company(), format);
    this.request.run(call, {
      next: (blob) => {
        let url: string | undefined;
        try {
          url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          const base = this.kind() === 'missing' ? 'missing-in-tally' : 'tally-vs-excel-by-project';
          link.download = `${base}-${new Date().toISOString().slice(0, 10)}.${format}`;
          link.click();
        } catch {
          this.error.set('The report could not be downloaded. Try again.');
        } finally {
          if (url) {
            const downloadUrl = url;
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
          }
          this.busy.set('');
        }
      },
      error: async (err) => {
        this.busy.set('');
        let message = '';
        try {
          message = JSON.parse(await (err.error as Blob).text()).error || '';
        } catch {
          message = '';
        }
        this.error.set(message || 'The report could not be created. Try again.');
      },
    });
  }
}
