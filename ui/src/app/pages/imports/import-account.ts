import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ExcelImportService, ImportAccountDetail, ImportRecord } from '../../services/excel-import';
import { DataColumn, DataTable } from '../../shared/data-table';
import { LatestRequest } from '../../shared/latest-request';
import { fullInr } from '../../shared/money';
import { PageHeader } from '../../shared/page-header';
import {
  auditColumns,
  comparisonMoney,
  exceptionColumns,
  importDate,
  importRowKey,
  importText,
} from './import-columns';
import { ImportNav } from './import-nav';

@Component({
  selector: 'app-import-account',
  imports: [RouterLink, PageHeader, ImportNav, DataTable],
  template: `
    <section class="grid-page">
      <app-page-header
        [title]="text(detail()?.account?.['account_name'] || 'Account')"
        [eyebrow]="text(detail()?.account?.['company_name'])"
        description="Retained Excel snapshots, ageing and recorded decisions."
      >
        <a class="btn ghost" routerLink="/imports/results">Back to outstanding</a>
      </app-page-header>
      <app-import-nav />
      @if (error()) {
        <p class="banner" role="alert">{{ error() }}</p>
      }
      @if (loading()) {
        <p class="empty" role="status">Loading account…</p>
      }
      @if (detail(); as data) {
        <article class="grid-card">
          <div class="grid-toolbar"><h2>Account details</h2></div>
          <dl class="detail-list">
            <div>
              <dt>PAN</dt>
              <dd>{{ text(data.account['pan_number']) }}</dd>
            </div>
            <div>
              <dt>GST</dt>
              <dd>{{ text(data.account['gst_number']) }}</dd>
            </div>
            <div>
              <dt>MSME</dt>
              <dd>{{ text(data.account['msme_number']) }}</dd>
            </div>
          </dl>
        </article>
        <article class="grid-card">
          <div class="grid-toolbar">
            <div>
              <h2>Snapshot history</h2>
              <p>
                Reporting dates identify each retained balance; comparison is unavailable when
                reference dates differ.
              </p>
            </div>
          </div>
          <app-data-table
            label="Account snapshot history"
            [rows]="data.outstanding"
            [columns]="outstandingColumns"
            [rowKey]="recordKey"
            empty="No imported balances for this account."
          />
        </article>
        <article class="grid-card">
          <div class="grid-toolbar">
            <div>
              <h2>Ageing</h2>
              <p>Ageing from the most recent retained account snapshot.</p>
            </div>
          </div>
          <app-data-table
            label="Account ageing"
            [rows]="data.ageing"
            [columns]="ageingColumns"
            [rowKey]="recordKey"
            empty="No ageing for this account."
          />
        </article>
        <article class="grid-card">
          <div class="grid-toolbar">
            <h2>Exceptions</h2>
            <a class="btn ghost" routerLink="/imports/exceptions">Review exception queue</a>
          </div>
          <app-data-table
            label="Account exceptions"
            [rows]="data.exceptions"
            [columns]="exceptionColumns"
            [rowKey]="recordKey"
            empty="No exceptions for this account."
          />
        </article>
        <article class="grid-card">
          <div class="grid-toolbar"><h2>Audit history</h2></div>
          <app-data-table
            label="Account audit history"
            [rows]="data.audit"
            [columns]="auditColumns"
            [rowKey]="recordKey"
            empty="No recorded account changes."
          />
        </article>
      }
    </section>
  `,
  styleUrl: './imports.css',
})
export class ImportAccount {
  private readonly api = inject(ExcelImportService);
  private readonly route = inject(ActivatedRoute);
  private readonly request = new LatestRequest();
  readonly detail = signal<ImportAccountDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly text = importText;
  readonly recordKey = importRowKey;
  readonly auditColumns = auditColumns;
  readonly exceptionColumns = exceptionColumns;
  readonly outstandingColumns: DataColumn<ImportRecord>[] = [
    {
      key: 'date',
      label: 'Report date',
      value: (row) => importDate(row['reporting_date']),
      primary: true,
    },
    {
      key: 'publication',
      label: 'Publication',
      value: (row) =>
        row['is_current'] === true
          ? 'Current published'
          : row['is_current'] === false
            ? 'Historical'
            : 'Unknown',
      primary: true,
    },
    {
      key: 'dr',
      label: 'Pending Dr',
      value: (row) => fullInr(Number(row['pending_bill_debit'] || 0)),
      numeric: true,
      primary: true,
    },
    {
      key: 'cr',
      label: 'Pending Cr',
      value: (row) => fullInr(Number(row['pending_bill_credit'] || 0)),
      numeric: true,
    },
    {
      key: 'difference',
      label: 'Difference',
      value: (row) => comparisonMoney(row['difference']),
      numeric: true,
    },
    {
      key: 'status',
      label: 'Comparison',
      value: (row) => importText(row['status']).replaceAll('_', ' '),
      primary: true,
    },
    {
      key: 'batch',
      label: 'Import generation',
      value: (row) => importText(row['generation'] || row['import_batch_id']),
    },
    {
      key: 'tallyDate',
      label: 'Tally balance date',
      value: (row) => importDate(row['tally_balance_date']),
    },
  ];
  readonly ageingColumns: DataColumn<ImportRecord>[] = [
    {
      key: 'bucket',
      label: 'Bucket',
      value: (row) => importText(row['bucket_label'] || row['ageing_bucket']),
      primary: true,
    },
    {
      key: 'dr',
      label: 'Debit',
      value: (row) => fullInr(Number(row['debit_amount'] || 0)),
      numeric: true,
      primary: true,
    },
    {
      key: 'cr',
      label: 'Credit',
      value: (row) => fullInr(Number(row['credit_amount'] || 0)),
      numeric: true,
    },
  ];

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.loading.set(true);
      this.detail.set(null);
      this.error.set('');
      this.request.run(this.api.account(params.get('id') || ''), {
        next: (data) => {
          this.detail.set(data);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.error || 'Unable to load account');
          this.loading.set(false);
        },
      });
    });
  }
}
