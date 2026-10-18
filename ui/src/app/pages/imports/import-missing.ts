import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CompanyDirectory } from '../../services/company-directory';
import { ExcelImportService, Presence, PresenceExcelRow, PresenceTallyRow } from '../../services/excel-import';
import { CompanySelect } from '../../shared/company-select';
import { KpiCard } from '../../shared/kpi-card';
import { LatestRequest } from '../../shared/latest-request';
import { PageHeader } from '../../shared/page-header';
import { importDate } from './import-columns';
import { ImportNav } from './import-nav';
import { ImportProjectReport } from './import-project-report';

type Section = 'missingInTally' | 'possible' | 'missingInExcel' | 'found';

const SHOW_LIMIT = 500;

/** Which parties are in the Excel but not in Tally, and which Tally ledgers are not in the Excel. */
@Component({
  providers: [CompanyDirectory],
  selector: 'app-import-missing',
  imports: [CompanySelect, KpiCard, PageHeader, ImportNav, ImportProjectReport, RouterLink],
  templateUrl: './import-missing.html',
  styleUrl: './imports.css',
})
export class ImportMissing {
  private readonly api = inject(ExcelImportService);
  private readonly directory = inject(CompanyDirectory);
  private readonly route = inject(ActivatedRoute);
  private readonly request = new LatestRequest();
  readonly companies = this.directory.companies;
  readonly company = signal('all');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly data = signal<Presence | null>(null);
  readonly section = signal<Section>('missingInTally');
  readonly search = signal('');

  readonly sections: { id: Section; label: string; help: string }[] = [
    {
      id: 'missingInTally',
      label: 'Missing in Tally',
      help: 'These parties are in the Excel, but no Tally ledger has this name. Add them in Tally, or link them to the right ledger if the name is spelled differently.',
    },
    {
      id: 'possible',
      label: 'Check these',
      help: 'A Tally ledger has a similar name, but not the same name. Check that it is the same party. Some are the same party with a site name added, others are not.',
    },
    {
      id: 'missingInExcel',
      label: 'Missing in Excel',
      help: 'These Tally ledgers have a balance but no party in the Excel file.',
    },
    { id: 'found', label: 'Found in both', help: 'The same name exists in the Excel and in Tally.' },
  ];

  readonly counts = computed(() => {
    const summary = this.data()?.summary;
    return {
      missingInTally: summary?.missingInTally ?? 0,
      possible: summary?.possible ?? 0,
      missingInExcel: summary?.missingInExcel ?? 0,
      found: summary?.found ?? 0,
    } as Record<Section, number>;
  });

  readonly help = computed(() => this.sections.find((item) => item.id === this.section())?.help ?? '');
  readonly isTallyList = computed(() => this.section() === 'missingInExcel');

  private readonly filtered = computed(() => {
    const data = this.data();
    if (!data) return [] as (PresenceExcelRow | PresenceTallyRow)[];
    const needle = this.search().trim().toLowerCase();
    const rows = data[this.section()] as (PresenceExcelRow | PresenceTallyRow)[];
    if (!needle) return rows;
    return rows.filter((row) =>
      [
        'account_name' in row ? row.account_name : '',
        row.tally_ledger_name ?? '',
        row.project_name ?? '',
        'level_1_category' in row ? (row.level_1_category ?? '') : (row.tally_group ?? ''),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  });
  readonly total = computed(() => this.filtered().length);
  readonly excelRows = computed(() =>
    this.isTallyList() ? [] : (this.filtered().slice(0, SHOW_LIMIT) as PresenceExcelRow[]),
  );
  readonly tallyRows = computed(() =>
    this.isTallyList() ? (this.filtered().slice(0, SHOW_LIMIT) as PresenceTallyRow[]) : [],
  );
  readonly hidden = computed(() => Math.max(0, this.total() - SHOW_LIMIT));
  readonly limit = SHOW_LIMIT;

  constructor() {
    effect(() => {
      const list = this.companies();
      untracked(() => {
        if (this.company() === 'all' && list.length) {
          const wanted = this.route.snapshot.queryParamMap.get('company');
          this.company.set((list.find((item) => item.id === wanted) ?? list[0]).id);
          this.load();
        }
      });
    });
  }

  onCompany(value: string) {
    this.company.set(value);
    this.load();
  }

  onSection(id: Section) {
    this.section.set(id);
  }

  onSearch(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
  }

  load() {
    if (this.company() === 'all') return;
    this.loading.set(true);
    this.error.set('');
    this.request.run(this.api.missing(this.company()), {
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.data.set(null);
        this.error.set(err.error?.error || 'Unable to compare the Excel names with Tally');
        this.loading.set(false);
      },
    });
  }

  date(value: unknown) {
    return importDate(value);
  }

  /** Amounts exactly as each system states them. They are never subtracted here. */
  amount(value: unknown) {
    if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  how(row: PresenceExcelRow) {
    if (row.match_method === 'MANUAL') return 'Linked by you';
    if (row.match_method === 'PAN_NAME' || row.match_method === 'GST_NAME') return 'Same PAN or GST';
    if (row.match_method?.startsWith('FUZZY')) return 'Similar name';
    return row.tally_ledger_id ? 'Same name' : '—';
  }
}
