# Source reporting models and release checklist

## Delivered scope

Migrations `011_reporting_source_models.sql` and `012_dedicated_reporting_entities.sql` add validated reporting detail, dedicated business entities and monthly summaries alongside the unchanged raw archive. It uses the existing checksum-protected migration runner; it does not backfill production data or change existing financial balances by itself.

| Source collection | Reporting representation | Use |
| --- | --- | --- |
| COMPANY | `finance_snapshots` | Capture, accounting start dates, currency, publication and coverage per company |
| GROUP | `account_groups` | Parent hierarchy and resolved account classification |
| VOUCHERTYPE | `voucher_types` | Custom voucher types resolved through their parent definitions |
| CURRENCY | `currencies` | Currency definitions and available source properties |
| LEDGER | Existing Ledgers plus `finance_ledger_facts` | Separate opening/closing values, group ancestry, currency and source reference |
| VOUCHER | Existing Vouchers plus `finance_postings` | Signed accounting entries, dates, types and source identities |
| COSTCATEGORY / COSTCENTRE | `cost_categories`, `cost_centres`, `finance_allocations`, existing Projects | Category/centre definitions, split allocations and compatible project links |
| STOCKGROUP / STOCKCATEGORY / STOCKITEM / UNIT / GODOWN | `stock_groups`, `stock_categories`, `stock_items`, `units`, `godowns` | Inventory hierarchy, items, units and warehouse definitions |
| Nested inventory entries / batch allocations | `finance_inventory_movements` | Source quantities with units, signed values and warehouse splits |

Every entity table is shared across companies using `company_id`; tables are not duplicated per company. `finance_masters` is now a read-only UNION view for common browsing, not generic master storage. Resolved parent, category and unit identities use company-scoped, deferred foreign keys. Unresolved optional source references retain their names and nullable relationships rather than invented masters.

All 13 configured collection types now have a reporting path. This is a projection of useful fields, not a copy of every Tally method into relational columns. Unmapped fields remain accessible in the archived source record. It is not a full Tally backup.

## Export and sync responsibilities

- Export still succeeds when it faithfully captures missing, empty or unsupported business values. Requests include explicit accounting, allocation and inventory methods alongside broad fetch coverage. Transport, XML, collection and archive-integrity failures remain export failures.
- A complete archive automatically starts sync. Export coverage and sync status remain independent and are displayed separately in Operations.
- Sync checks mandatory balances/amounts, master identities, hierarchy cycles, posting references/balance and allocation references. Errors block publication for that company; warnings describe optional/unavailable information. Explicit zero remains distinct from a missing field.
- `source_validation_issues` retains batch, sync item, collection, record ordinal, field, severity, code and message. Investigation links open the exact archived JSON record.
- Sync stages rows in bounded SQL batches and reconciles inserts, changes and removals. Unchanged enhanced rows keep their original source batch and ordinal, avoiding rewrite churn while retaining evidence. Bulk-load statistics are refreshed before summary joins; the synthetic benchmark exposed and verified this requirement. Legacy books, project links, details and monthly summaries commit in the same company transaction. A validation or write failure leaves the previous published data intact. Source archives and validation history survive a rejected reload.
- Force replay remains supported, but cannot overwrite newer imports. A validated previously applied batch without the new projection can rebuild it through this protected path. Old archives with missing financial fields still fail validation; schema changes cannot recover those fields.
- Reports use repeatable-read snapshots. A sync committing mid-request cannot mix source versions across report sections. SQL on a shared reporting connection is serialized.
- Legacy normalized imports remain supported. When they replace books, they invalidate an older enhanced projection so it cannot appear current. Multi-chunk voucher identity generation now spans the whole upload, fixing collisions across chunks.

## UI and reports

- Overview and Reports share `SourceInsights`; Operations and financial drill-downs share the paged `SourceBrowser`. The existing responsive DataTable and FinancialChart remain shared.
- New views show source coverage, currency, capture/accounting dates, classified closing balances, bank/cash posting movement, cost allocations and inventory movement values. Movement charts read `finance_monthly_summaries` and accept URL-backed start/end months, defaulting to the latest 12 months of available data. Ledger balances remain as at capture, not restated for the selected period. Custom group/type definitions also improve existing dashboard and expense/project report classification.
- Financial detail browsing uses stable source-key cursors, without full row counts or growing offsets. Cursors are scoped to company, type, period, name and published batches; a changed publication returns a recoverable conflict rather than mixing pages. Detail requests start when the section is opened. Archive, issue and small master browsers retain numbered pagination.
- Operations separates export history from sync history, provides batch-filtered issue history, master collection browsing and escaped source-record evidence.
- Companies are kept separate in the new monetary views. Missing or conflicting currency information blocks charts. Missing postings and partially valued allocation/inventory groups are unavailable rather than presented as complete zero activity.
- These are signed source balances and movements. They are not reconciled bank availability, audited profit, inventory-on-hand valuation or consolidated financial statements. Current captures do not establish invoice due dates, settlement linkage or approved budgets; ageing and budget comparisons remain unavailable rather than inferred.
- Reporting currently supports two decimal places and the existing financial storage range. Nonzero precision beyond two decimals is rejected rather than rounded; source text remains archived. Financial source labels preserve decimal strings even when chart geometry uses numbers.

## Release order

1. Review migrations 011 and 012 and the API/UI/agent changes together. Back up the production database through the normal release process.
2. Apply migrations before serving the updated API; the existing API startup also runs the migration runner. A standalone reviewed migration command is `npm run migrate` from `api` using the intended deployment environment. Do not use the local test connection for deployment.
3. Release the matching API and UI. Historical data stays visible in existing views, with a notice where no validated enhanced projection exists.
4. When the remote Tally server is available, deploy the updated agent, preserving its configuration, token and state. Use its existing dry-run mode to examine a fresh capture before sending it.
5. After a complete export, inspect the automatic sync result and source-linked issues. Verify the resulting values against Tally at the same accounting cutoff. Manual Sync Tally can retry saved source data; missing exported fields require a fresh capture.
6. Verify all pages on mobile and desktop, including company switching, paging, source links and failure states. No commit, production migration, deployment or remote Tally execution was performed in this implementation session.

## Verification evidence

- Migration application and repeatability tested on an isolated PostgreSQL 16 container with no production data.
- API suite: 42 tests passed, including a 50,100-voucher upload, complete source-model publication, rejected follow-up preservation, simulated publication rollback and consistent/read-only reporting queries.
- Agent suite: 31 tests passed using mocked exports and local fixtures. This does not verify the remote Tally version/customizations.
- UI suite: 41 tests passed, including stale-request cancellation, missing-data/currency gates and existing responsive component behavior.
- Angular production build passed. Browser layout, remote Tally acceptance and production reconciliation remain release checks.

## Growth and storage operations

Run `npm run archive:audit` from `api` with the intended database environment for a read-only inventory of archive storage, estimated row counts, company capture history and evidence references. This command does not migrate, delete or modify records.

The current retention policy is retain-all. A fixed age-based purge is intentionally not enabled: unchanged published rows can still reference older archives, and failed sync evidence must remain available. Before enabling cold archival or cleanup, agree the required retention period and storage destination, export and checksum the records, test restoration, and preserve all published/detail/validation references. A storage audit does not itself cap disk growth. Monitor disk headroom and review archive sizes as part of operations.

The benchmark command is `npm run benchmark:reporting -- --output ../deploy/docs/reporting-benchmark-2026-09-13.json`. It requires explicit loopback `DB_HOST`, `DB_NAME=enterprise_dashboard_test`, and an empty disposable database; it never clears an existing database. It writes synthetic archives and reporting data for five companies. Do not point it at the development or production database. `BENCHMARK_VOUCHERS` controls the per-company count (default 10,000, range 100 to 100,000).

The benchmark compares summary and detail aggregation, full overview requests, five simultaneous company reads, cursor drilldowns, initial sync and unchanged repeat sync. Measurements are local synthetic observations, not production response-time guarantees. Full source parsing and validation still hold a company archive in application memory; significantly larger archives require separate memory/load verification. Single-request upload limits remain unchanged; internal complete-archive sync no longer inherits the 50,000-row request cap.

Existing dashboard and expense/project views remain supported. The new summaries accelerate source-backed movement charts; not every legacy report has been converted to a summary. Partitioning and a separate analytics service are not introduced without measurements showing a need.

## Local benchmark result (2026-09-13)

See [the machine-readable result](reporting-benchmark-2026-09-13.json). Five synthetic companies held 50,000 vouchers, 100,000 postings, 50,000 allocations and 50,000 inventory movements across 24 months. The summary table held 3,720 rows.

| Measurement | Median | Observed p95 |
| --- | ---: | ---: |
| Source overview, one company | 54.82 ms | 73.92 ms |
| Five simultaneous company overviews, time for whole group | 50.70 ms | 223.28 ms |
| Cursor detail page | 24.65 ms | 32.42 ms |
| Monthly cash summary SQL | 6.01 ms | 8.18 ms |
| Equivalent cash detail aggregation SQL | 11.61 ms | 20.00 ms |

Initial sync per 10,000-voucher company took 8.58 to 14.67 seconds; unchanged repeat sync took 3.85 to 6.22 seconds. All 100,000 unchanged postings kept their original evidence batch. These timings include source parsing/validation and sync publication, but exclude remote export and archive transfer. Measurements invoke report service functions over local PostgreSQL; HTTP transport, authentication middleware and browser rendering are excluded. Query samples were 15 sequential calls, and five groups for concurrent requests; this is a small local diagnostic, not a sustained production load test. UI regression tests ran on the same workstation during the benchmark, so compare magnitudes rather than treating differences between runs as guarantees.

The benchmark initially exposed a 30-second summary timeout caused by stale planner statistics after a company bulk load. Statistics are now refreshed before summary joins. The populated-schema upgrade test also verifies that deferred backfill checks are completed before new foreign keys are added.

## Acceptance follow-up

See [the acceptance review](acceptance-review-2026-09-13.md) for additional navigation, company-selection, failure-recovery and authenticated HTTP verification. Automated acceptance is passing; real browser and remote Tally acceptance remain unverified.
