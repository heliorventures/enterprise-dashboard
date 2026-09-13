import { Component, effect, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { SourceBrowser } from './source-browser';
@Component({
  selector: 'app-source-investigation',
  imports: [SourceBrowser],
  template: `
    @if (record() || error() || loading()) {
      <section aria-label="Archived source evidence">
        <h2>Archived source record</h2>
        <p>{{ location() }}</p>
        <button class="btn ghost" type="button" (click)="close()">Close record</button>
        @if (loading()) {
          <p role="status">Loading source record…</p>
        }
        @if (error()) {
          <p class="banner" role="alert">{{ error() }}</p>
          <button class="btn ghost" type="button" (click)="retry()">Retry loading record</button>
        }
        @if (record()) {
          <pre tabindex="0" aria-label="Source record JSON">{{ record() }}</pre>
        }
      </section>
    }
    <app-source-browser
      mode="archives"
      [refreshKey]="syncVersion()"
      title="Export history"
      description="Saved source coverage is independent of sync validation. Open a batch's issues to investigate."
    />
    <app-source-browser
      mode="issues"
      [refreshKey]="syncVersion()"
      title="Validation issues"
      description="Each issue identifies the export batch, collection, record and field. Repeated attempts remain in the history."
    />
    <app-source-browser
      mode="masters"
      [refreshKey]="syncVersion()"
      title="Imported master records"
      description="Browse group hierarchies, voucher definitions, currency, cost centres and inventory masters from the last published model."
    />
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    pre {
      max-height: 420px;
      max-width: 100%;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      padding: 16px;
      background: var(--surface, #fff);
      border: 1px solid var(--border, #ddd);
      border-radius: 12px;
    }
    section p {
      overflow-wrap: anywhere;
    }
  `,
})
export class SourceInvestigation {
  readonly syncVersion = input('');
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly revision = signal(0);
  readonly record = signal('');
  readonly error = signal('');
  readonly loading = signal(false);
  readonly location = signal('');
  constructor() {
    effect((onCleanup) => {
      this.revision();
      const p = this.params(),
        batch = p.get('batch'),
        collection = p.get('sourceCollection'),
        ordinal = p.get('sourceOrdinal');
      this.record.set('');
      this.error.set('');
      this.loading.set(false);
      if (!batch || !collection || ordinal === null) return;
      this.location.set(`${batch} / ${collection} #${ordinal}`);
      this.loading.set(true);
      const request = this.http
        .get<{ payload: unknown }>('/api/tally/source-record', {
          params: { batch, collection, ordinal },
        })
        .subscribe({
          next: (r) => {
            this.record.set(JSON.stringify(r.payload, null, 2));
            this.loading.set(false);
          },
          error: () => {
            this.error.set(
              'Unable to read this archived record. Check the batch and record reference.',
            );
            this.loading.set(false);
          },
        });
      onCleanup(() => request.unsubscribe());
    });
  }
  retry() {
    this.revision.update((n) => n + 1);
  }
  close() {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { sourceCollection: null, sourceOrdinal: null },
      queryParamsHandling: 'merge',
    });
  }
}
