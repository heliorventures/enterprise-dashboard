import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-company-select',
  template: `<label class="field"
    ><span>Company</span
    ><select [value]="value()" (change)="select($event)">
      <option value="all">All companies</option>
      @if (unknownSelection()) {
        <option [value]="value()">Selected company ({{ value() }})</option>
      }
      @for (company of companies(); track company.id) {
        <option [value]="company.id">{{ company.name }}</option>
      }
    </select></label
  >`,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
  `,
})
export class CompanySelect {
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
