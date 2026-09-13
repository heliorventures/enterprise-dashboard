import { CompanyDirectory } from '../services/company-directory';
import { Component, inject, input, output } from '@angular/core';

@Component({
  selector: 'app-company-select',
  template: `<label class="field"
      ><span>Company</span
      ><select
        [disabled]="directory?.loading() || false"
        (change)="select($event)"
      >
        <option value="all" [selected]="value() === 'all'">All companies</option>
        @if (unknownSelection()) {
          <option [value]="value()" [selected]="true">Selected company ({{ value() }})</option>
        }
        @for (company of companies(); track company.id) {
          <option [value]="company.id" [selected]="company.id === value()">{{ company.name }}</option>
        }
      </select></label
    >
    @if (directory?.loading()) {
      <p role="status">Loading companies...</p>
    }
    @if (directory?.error()) {
      <p role="alert">{{ directory?.error() }}</p>
      <button type="button" class="btn ghost" (click)="directory?.load()">
        Retry company list
      </button>
    }`,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
  `,
})
export class CompanySelect {
  readonly directory = inject(CompanyDirectory, { optional: true });
  readonly value = input('all');
  readonly companies = input.required<readonly { id: string; name: string }[]>();
  readonly companyChange = output<string>();
  unknownSelection() {
    return this.value() !== 'all' && !this.companies().some((c) => c.id === this.value());
  }
  select(event: Event) {
    this.companyChange.emit((event.target as HTMLSelectElement).value);
  }
}
