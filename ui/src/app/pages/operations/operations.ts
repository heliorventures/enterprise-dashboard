import { SourceInvestigation } from '../../shared/source-investigation';
import { DataColumn, DataTable } from '../../shared/data-table';
import { PageHeader } from '../../shared/page-header';
import { recordKey } from '../../shared/record-columns';
import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { DashboardService } from '../../services/dashboard';
import { SourceSyncCompany, SourceSyncCounts, SourceSyncRun } from '../../models/dashboard';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-operations',
  imports: [SourceInvestigation, DatePipe, Icon, DataTable, PageHeader],
  templateUrl: './operations.html',
  styleUrl: './operations.css',
})
export class Operations {
  private readonly api = inject(DashboardService);
  private readonly destroyRef = inject(DestroyRef);
  private pollId: ReturnType<typeof setInterval> | null = null;
  private reading = false;

  readonly recordKey = recordKey;
  readonly companyColumns: DataColumn<SourceSyncCompany>[] = [
    {
      key: 'name',
      label: 'Company',
      value: (r) => this.clean(r.companyName),
      secondary: (r) => r.batchId || '',
    },
    {
      key: 'status',
      label: 'Status',
      value: (r) => this.syncStatus(r.status),
      primary: true,
      tone: (r) => (r.status === 'error' ? 'negative' : 'neutral'),
    },
    { key: 'progress', label: 'Progress', value: (r) => `${r.progress}%`, primary: true },
    {
      key: 'changes',
      label: 'Changes',
      value: (r) => this.changeLabel(r).primary,
      secondary: (r) => this.changeLabel(r).secondary,
    },
  ];
  readonly historyColumns: DataColumn<SourceSyncRun>[] = [
    {
      key: 'date',
      label: 'Started',
      value: (r) =>
        new Date(r.startedAt).toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
    {
      key: 'status',
      label: 'Status',
      value: (r) => this.syncStatus(r.status),
      primary: true,
      tone: (r) => (r.status === 'error' ? 'negative' : 'neutral'),
    },
    {
      key: 'progress',
      label: 'Companies processed',
      value: (r) => `${r.companyDone} / ${r.companyTotal}`,
      primary: true,
    },
    { key: 'trigger', label: 'Started by', value: (r) => this.triggerLabel(r.triggeredBy) },
    { key: 'result', label: 'Result', value: (r) => r.message },
  ];
  readonly loading = signal(true);
  readonly syncing = signal(false);
  readonly error = signal('');
  readonly currentSync = signal<SourceSyncRun | null>(null);
  readonly syncHistory = signal<SourceSyncRun[]>([]);

  constructor() {
    this.destroyRef.onDestroy(() => this.stopPoll());
    this.loadSync();
  }

  syncTally() {
    this.error.set('');
    this.syncing.set(true);
    this.api
      .startSourceSync()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (run) => {
          this.currentSync.set(run);
          this.startPoll();
        },
        error: (err) => {
          if (err.status === 409 && err.error?.run) {
            this.currentSync.set(err.error.run);
            this.startPoll();
            return;
          }
          this.syncing.set(false);
          this.error.set(err.error?.error || 'Tally sync could not start');
        },
      });
  }

  loadSync() {
    if (this.reading) return;
    this.reading = true;
    this.api
      .getSourceSync()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => (this.reading = false)),
      )
      .subscribe({
        next: (history) => {
          this.error.set('');
          this.syncHistory.set(history.runs || []);
          this.currentSync.set(history.current || history.runs?.[0] || null);
          const running = history.current?.status === 'running';
          this.syncing.set(running);
          this.loading.set(false);
          if (running) {
            this.startPoll();
          } else {
            this.stopPoll();
          }
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(err.error?.error || 'Unable to load Tally sync history');
        },
      });
  }

  syncStatus(status: string) {
    return (
      (
        {
          running: 'In progress',
          ok: 'Completed',
          error: 'Failed',
          skipped: 'Already applied',
          pending: 'Waiting',
        } as Record<string, string>
      )[status] || status
    );
  }

  triggerLabel(value: string) {
    return (
      (
        {
          dashboard: 'Operations',
          cli: 'Command',
          'source-complete': 'New dump',
        } as Record<string, string>
      )[value] || value
    );
  }

  clean(value: string) {
    return (value || '').replace(/\u0004/g, '').trim();
  }

  changeLabel(row: SourceSyncCompany) {
    if (row.status === 'error') {
      return { primary: row.message || 'Failed', secondary: '' };
    }
    if (row.status === 'skipped') {
      return { primary: 'Already applied', secondary: '' };
    }
    if (row.status === 'pending' || row.status === 'running') {
      return { primary: row.message || this.syncStatus(row.status), secondary: '' };
    }
    return {
      primary: this.countLine('Ledgers', row.ledgers),
      secondary: this.countLine('Vouchers', row.vouchers),
    };
  }

  private countLine(label: string, counts: SourceSyncCounts) {
    return `${label} · ${counts.insert} new, ${counts.update} updated, ${counts.unchanged} unchanged`;
  }

  private startPoll() {
    if (this.pollId) {
      return;
    }
    this.pollId = setInterval(() => this.loadSync(), 1500);
  }

  private stopPoll() {
    if (!this.pollId) {
      return;
    }
    clearInterval(this.pollId);
    this.pollId = null;
  }
}
