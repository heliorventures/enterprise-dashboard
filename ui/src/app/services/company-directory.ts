import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { LatestRequest } from '../shared/latest-request';

/** Page-scoped company lookup: independent of financial calculation failures. */
@Injectable()
export class CompanyDirectory {
  private readonly http = inject(HttpClient);
  private readonly request = new LatestRequest();
  readonly companies = signal<{ id: string; name: string }[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  constructor() {
    inject(DestroyRef).onDestroy(() => this.request.cancel());
    this.load();
  }
  load() {
    this.loading.set(true);
    this.error.set('');
    this.request.run(this.http.get<{ id: string; name: string }[]>('/api/companies'), {
      next: (companies) => {
        this.companies.set(companies);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Company list could not be loaded.');
        this.loading.set(false);
      },
    });
  }
}
