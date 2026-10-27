import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { CompanyDirectory } from '../../services/company-directory';
import { ExcelImportService, ExcelUploadResult } from '../../services/excel-import';
import { Icon } from '../../shared/icon';
import { importMoney as fullInr } from './import-money';
import { PageHeader } from '../../shared/page-header';
import { ImportNav } from './import-nav';

@Component({
  providers: [CompanyDirectory],
  selector: 'app-import-wizard',
  imports: [RouterLink, Icon, PageHeader, ImportNav],
  templateUrl: './import-wizard.html',
  styleUrl: './imports.css',
})
export class ImportWizard {
  private readonly api = inject(ExcelImportService);
  private readonly destroyRef = inject(DestroyRef);
  readonly directory = inject(CompanyDirectory);
  readonly companies = this.directory.companies;
  readonly uploaded = signal(false);
  readonly companyId = signal('');
  readonly fileName = signal('');
  readonly busy = signal('');
  readonly error = signal('');
  readonly warning = signal('');
  readonly progressPercent = signal(0);
  readonly progressLabel = signal('');
  readonly progressActive = signal(false);
  readonly result = signal<ExcelUploadResult | null>(null);
  private file: File | null = null;

  onCompany(event: Event) {
    this.companyId.set((event.target as HTMLSelectElement).value);
  }

  onFile(event: Event) {
    this.file = (event.target as HTMLInputElement).files?.[0] || null;
    this.fileName.set(this.file?.name || '');
  }
  private setProgress(percent: number, label: string, active = true) {
    this.progressPercent.set(Math.max(0, Math.min(100, percent)));
    this.progressLabel.set(label);
    this.progressActive.set(active);
    this.busy.set(active ? label : '');
  }

  startOver() {
    if (this.busy()) return;
    this.uploaded.set(false);
    this.result.set(null);
    this.file = null;
    this.fileName.set('');
    this.error.set('');
    this.warning.set('');
    this.setProgress(0, '', false);
  }

  upload() {
    if (this.busy()) return;
    if (!this.companyId()) {
      this.error.set('Choose the company this Excel belongs to.');
      return;
    }
    if (!this.file) {
      this.error.set('Choose the Excel file.');
      return;
    }
    this.error.set('');
    this.warning.set('');
    this.setProgress(8, 'Reading Excel…');
    this.api
      .upload(this.file, this.companyId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          if (event.phase !== 'done') {
            this.setProgress(event.percent, event.message);
            return;
          }
          const data = event.result;
          if (!data) {
            this.setProgress(0, '', false);
            this.error.set('The file could not be read.');
            return;
          }
          this.result.set(data);
          this.uploaded.set(true);
          this.setProgress(0, '', false);
          if (data.companyMismatch) {
            this.warning.set(`Workbook company “${data.analysis?.company?.company || 'unknown'}” differs from the selected company.`);
          }
        },
        error: (err) => {
          this.setProgress(0, '', false);
          this.error.set(err.error?.error || 'The file could not be read.');
        },
      });
  }

}
