import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ExcelImportService } from '../../services/excel-import';
import { DataColumn, DataTable } from '../../shared/data-table';
import { Icon } from '../../shared/icon';
import { KpiCard } from '../../shared/kpi-card';
import { LatestRequest } from '../../shared/latest-request';
import { fullInr } from '../../shared/money';
import { PageHeader } from '../../shared/page-header';
import { ImportNav } from './import-nav';

interface Suggestion {
  id: number;
  name: string;
  groupName?: string;
  balance: number;
  score?: number;
  current?: boolean;
}

@Component({
  selector: 'app-import-sync-detail',
  imports: [RouterLink, DataTable, Icon, KpiCard, PageHeader, ImportNav],
  templateUrl: './import-sync-detail.html',
  styleUrl: './imports.css',
})
export class ImportSyncDetail {
  private readonly api = inject(ExcelImportService);
  private readonly route = inject(ActivatedRoute);
  private readonly request = new LatestRequest();
  private readonly searchRequest = new LatestRequest();
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly detail = signal<Record<string, unknown> | null>(null);
  readonly ledgerQuery = signal('');
  readonly ledgerHits = signal<Suggestion[]>([]);
  readonly selectedLedgerId = signal<string>('');
  readonly fullInr = fullInr;
  readonly ageingColumns: DataColumn<Record<string, unknown>>[] = [
    { key: 'label', label: 'Bucket', value: (row) => String(row['bucket_label'] || row['ageing_bucket'] || '—'), primary: true },
    { key: 'debit', label: 'Debit', value: (row) => fullInr(Number(row['debit_amount'] || 0)), numeric: true, primary: true },
    { key: 'credit', label: 'Credit', value: (row) => fullInr(Number(row['credit_amount'] || 0)), numeric: true },
  ];

  constructor() {
    this.load(this.route.snapshot.paramMap.get('id') || '');
  }

  load(id: string) {
    this.loading.set(true);
    this.request.run(this.api.syncDetail(id), {
      next: (data) => {
        this.detail.set(data);
        const tally = data['tally'] as Record<string, unknown> | undefined;
        this.selectedLedgerId.set(tally?.['ledgerId'] != null ? String(tally['ledgerId']) : '');
        this.error.set('');
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.error || 'Unable to load mapping detail');
        this.loading.set(false);
      },
    });
  }

  rec() {
    return this.detail();
  }

  account() {
    return (this.detail()?.['account'] || null) as Record<string, unknown> | null;
  }

  excel() {
    return (this.detail()?.['excel'] || {}) as Record<string, unknown>;
  }

  tally() {
    return (this.detail()?.['tally'] || {}) as Record<string, unknown>;
  }

  mapping() {
    return (this.detail()?.['mapping'] || {}) as Record<string, unknown>;
  }

  comparison() {
    return (this.detail()?.['comparison'] || {}) as Record<string, unknown>;
  }

  company() {
    return (this.detail()?.['company'] || {}) as Record<string, unknown>;
  }

  suggestions() {
    return (this.detail()?.['suggestions'] || []) as Suggestion[];
  }

  ageing() {
    return (this.detail()?.['ageing'] || []) as Record<string, unknown>[];
  }

  money(value: unknown) {
    return fullInr(Number(value || 0));
  }

  text(value: unknown) {
    return value == null || value === '' ? '—' : String(value);
  }

  status() {
    return String(this.detail()?.['status'] || '—').replaceAll('_', ' ');
  }

  methodLabel() {
    return this.text(this.mapping()['method'] || this.mapping()['source']).replaceAll('_', ' ');
  }

  inSync() {
    return this.comparison()['inSync'] === true;
  }

  canMap() {
    return this.mapping()['canMap'] === true;
  }

  onLedger(event: Event) {
    this.selectedLedgerId.set((event.target as HTMLSelectElement).value);
  }

  pick(id: number) {
    this.selectedLedgerId.set(String(id));
  }

  searchLedgers(event: Event) {
    const q = (event.target as HTMLInputElement).value;
    this.ledgerQuery.set(q);
    const company = String(this.company()['tallyCompanyId'] || '');
    if (!company || !q.trim()) {
      this.ledgerHits.set([]);
      return;
    }
    this.searchRequest.run(this.api.tallyLedgers(company, q), {
      next: (rows) => this.ledgerHits.set(rows || []),
      error: () => this.ledgerHits.set([]),
    });
  }

  save() {
    const id = String(this.detail()?.['id'] || '');
    if (!id || !this.canMap()) return;
    this.saving.set(true);
    this.api.mapLedger(id, this.selectedLedgerId() ? Number(this.selectedLedgerId()) : null).subscribe({
      next: (data) => {
        this.detail.set(data);
        this.saving.set(false);
        this.error.set('');
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err.error?.error || 'Mapping could not be saved');
      },
    });
  }

  clearMap() {
    this.selectedLedgerId.set('');
    this.save();
  }

  ageingKey(row: Record<string, unknown>) {
    return String(row['id'] || row['ageing_bucket'] || row['bucket_label']);
  }
}
