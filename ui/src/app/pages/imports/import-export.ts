import { Component, effect, inject, input, signal } from '@angular/core';
import { ExcelImportService, ImportReportType } from '../../services/excel-import';
import { LatestRequest } from '../../shared/latest-request';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-import-export',
  imports: [Icon],
  template: `
    <button class="btn ghost" type="button" [disabled]="exporting()" (click)="download()">
      <app-icon name="download" /> {{ exporting() ? 'Exporting…' : 'Export CSV' }}
    </button>
    @if (error()) {
      <p class="banner" role="alert">{{ error() }}</p>
    }
  `,
})
export class ImportExport {
  private readonly api = inject(ExcelImportService);
  private readonly request = new LatestRequest();
  readonly type = input.required<ImportReportType>();
  readonly company = input('all');
  readonly status = input('');
  readonly q = input('');
  readonly exporting = signal(false);
  readonly error = signal('');

  constructor() {
    effect(() => {
      this.type();
      this.company();
      this.status();
      this.q();
      this.request.cancel();
      this.exporting.set(false);
      this.error.set('');
    });
  }

  download() {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.error.set('');
    const type = this.type();
    this.request.run(
      this.api.reportCsv(type, { company: this.company(), status: this.status(), q: this.q() }),
      {
        next: (blob) => {
          let url: string | undefined;
          try {
            url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${type}.csv`;
            link.click();
          } catch {
            this.error.set('The complete CSV could not be downloaded. Try again.');
          } finally {
            if (url) {
              const downloadUrl = url;
              setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
            }
            this.exporting.set(false);
          }
        },
        error: () => {
          this.exporting.set(false);
          this.error.set(
            'The complete CSV could not be downloaded. Narrow the filters and try again.',
          );
        },
      },
    );
  }
}
