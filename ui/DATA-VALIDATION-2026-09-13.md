# Financial data validation — 13 September 2026

## Updated scope: completed imports only

At the user's request, validation was rerun against the latest per-company snapshots with `coverage_status = 'complete'` and a matching `tally_ingestions` row. This excludes CONSULTANCY's partial snapshot and the test company's non-archive import. Four companies qualify: HOMECRAFT, BUILDCON, INFRA AND AGRO, and INFRASTRUCTURE AND PROJECTS. Their latest promotion attempts are `skipped` because these batches were already applied, not because their data was excluded.

Within this scope, all **3,110 vouchers** lack direct amount and ledger-entry fields, and all **1,144 ledgers** lack closing-balance fields. The findings below about CONSULTANCY and the test company are earlier contextual observations, not part of this completed-import validation.

Archive completion verifies collection statuses, consistency not being `changed`, upload integrity and record counts. It does not validate required accounting fields. Promotion defaults missing voucher amounts to zero and missing closing balances to opening balances. `sourceSync.itemFromPromote` derives success from `result.ok`, ignoring the separate `errors` and `skipped` summaries from `projectRecords`. Therefore a completed status does not establish financial completeness.

All 13 collection types are supported by the raw archive. Reporting promotion reads only LEDGER, VOUCHER and COSTCENTRE; company identity comes from snapshot metadata. GROUP, VOUCHERTYPE, CURRENCY, COSTCATEGORY, STOCKGROUP, STOCKCATEGORY, STOCKITEM, UNIT and GODOWN are not normalized for reporting. The full COMPANY payload is also not projected. In these four completed snapshots, stock groups/categories/items and units have no records; GROUP has 225 records and VOUCHERTYPE has 99. Each company has one CURRENCY, COSTCATEGORY and GODOWN record, and INFRA AND AGRO has four COSTCENTRE records.

Priority reporting improvements are group ancestry and voucher-type classification, then signed voucher postings and cost allocations. Currency metadata should establish the reporting currency; stock reporting requires populated inventory records and movements. Capturing a master collection alone does not establish transaction amounts, exchange rates, ageing, budget values or inventory valuation.

Read-only PostgreSQL queries through the user-provided tunnel succeeded using local `api/.env`. Connections enforced `default_transaction_read_only=on`; no import, migration, update or deletion was performed. Credentials and source record values were not saved in this report.

## Confirmed findings

| Company | Imported ledgers | Zero ledger balances | Imported vouchers | Zero voucher amounts |
| --- | ---: | ---: | ---: | ---: |
| HOMECRAFT ENTERPRISES | 231 | 178 | 87 | 87 |
| SOLVIAN BUILDCON LLP | 375 | 260 | 505 | 505 |
| SOLVIAN CONSULTANCY LLP | 404 | 314 | 0 | 0 |
| SOLVIAN INFRA AND AGRO LLP | 510 | 450 | 2,483 | 2,483 |
| SOLVIAN INFRASTRUCTURE AND PROJECTS LLP | 28 | 18 | 35 | 35 |

- All 3,110 real-company vouchers have zero amounts. Across the latest complete source archives, none has a direct `AMOUNT`, `ALLLEDGERENTRIES.LIST` or `LEDGERENTRIES.LIST` field. `sourceUnpack.voucherAmount` returns `0.00` when both amount and entries are absent. These are missing financial evidence, not verified zero transactions.
- All 1,548 ledgers in the latest real-company snapshots have `OPENINGBALANCE` and lack `CLOSINGBALANCE`. `interpretLedger` falls back to opening balance and stores that as `CurrentBalance`. Consequently the UI's current/book balance labels overstate what this import establishes. Zero ledger balances cannot establish no activity.
- CONSULTANCY's latest snapshot is partial: its VOUCHER collection failed. Its empty transaction list is not evidence of no business activity.
- `TEST - Finance Sync` remains active, with five ledgers and three nonzero vouchers, and is included in the combined dashboard. The displayed 150,000 revenue is attributable to its sales ledger. No company was deactivated or deleted during this audit.
- Four projects have zero stored budgets and targets. There are 577 project-linked vouchers, but all real-company voucher amounts are zero. Neither project performance nor funding forecasts can be reconciled from these values.
- The latest applied real-company snapshots were captured on 12 September 2026. Recent transaction dates exist, including August activity; the zeros are not explained solely by an empty reporting month. No stored vouchers are future dated relative to the database date checked.

## Required recovery and acceptance

1. Verify the installed Tally agent version and capture a small fresh export with explicit closing-balance, amount and ledger-entry methods. The checked-out `deploy/tally-agent/source-export.js` already requests these explicitly; this alone does not prove the installed agent or Tally response does so.
2. Resolve CONSULTANCY's export failure using the agent's diagnostics. Database access alone cannot repair fields absent from the archive.
3. Reconcile a fresh sample with a Tally Trial Balance and voucher examples at an agreed reporting cutoff. Confirm debit/credit conventions and custom group ancestry before changing financial classifications.
4. Add explicit missing-amount and balance-basis handling through ingestion, API and UI. Preserve actual zero values and existing useful features; do not silently replace missing values with zero or opening balances with current balances.
5. Once a validated fresh capture and import preview are available, review the proposed data updates and exclusion of the test company before modifying production records.

Reliable current cash balances, revenue, activity, project values and forecasts remain unverified until this recovery is complete. Re-importing the same archives cannot supply the absent fields.

## Branding validation

One reusable Angular `BrandMark` displays the same SVG H in the sidebar, mobile header and login. Brand caption CSS is restricted to the caption container, removing the span selector conflict that displaced the previous H. Matching SVG/ICO favicons and an Apple touch icon replace the Angular icon.

The icon raster was visually inspected. Angular production build passed (396.69 kB initial, 101.96 kB estimated transfer); `git diff --check -- ui` passed. No browser layout acceptance or deployment was performed.
