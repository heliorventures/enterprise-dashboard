# Responsive UI and executive finance review

Reviewed all application routes: Overview, Reports, Ledgers, Transactions, Operations and Login.

## Implemented

| Area                     | Finding and resolution                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation               | The old mobile sidebar occupied the page above the content. A compact header now opens a native modal navigation drawer. It closes on selection, completed navigation, Escape, backdrop click and return to desktop width. The native dialog provides modal focus containment; the trigger exposes expanded state.                                      |
| Record presentation      | Fixed-layout tables hid overflow and truncated financial values. `DataTable` owns desktop scrolling and labelled mobile cards. Secondary fields use native Details disclosure. Exact currency amounts are preserved without hover.                                                                                                                      |
| Reuse                    | Shared `PageHeader`, `CompanySelect`, `FilterPanel`, `DataTable`, `KpiCard`, `FinancialChart`, `Pager`, record columns and `LatestRequest` replace per-page rendering and read-cancellation logic. Only page-specific column definitions and financial mappings live in pages.                                                                          |
| Overview                 | Executive indicators, management attention with supporting links, cash versus payables, company results, monthly voucher activity and an explicitly labelled funding model appear before detailed books. Accounts and full financial records remain accessible in expandable sections. Large charts initially show six entries with a show-all control. |
| Reports                  | Expense concentration chart supports company → group → ledger navigation. Project charts show the lowest model net first and non-zero amount coverage. All project records remain available. Supporting vouchers are correctly labelled as all voucher types, matching the API request.                                                                 |
| Ledgers and Transactions | Reused mobile records, collapsible mobile filters, explicit search submission, 25-row default and compact touch pagination. Unsubmitted search text does not silently change exports. No group total is inferred from a single page.                                                                                                                    |
| Operations               | Shared record cards preserve status, progress, source batch, changes and history. Polling does not overlap requests, successful reads clear transient errors and subscriptions end when leaving the page. Refresh status is separate from triggering an import.                                                                                         |
| Login and accessibility  | Mobile input sizing, touch controls, username capitalization settings, error announcements, visible focus, skip link and reduced-motion support. Drill-downs use links rather than click-only table rows.                                                                                                                                               |
| Scope and correctness    | Old reads are cancelled when selections change, stale records are removed during reload and failures are distinct from empty results. Invalid date ranges are rejected. Report month-end boundaries use UTC calendar construction, preserving the final day in Asia/Calcutta.                                                                           |

## Financial interpretation: source limitations remain

These are findings in the existing API/data model, not calculations that can be established from layout changes. The UI now states their limits instead of presenting stronger conclusions.

- `api/src/dashboardService.js:monthlyActivity` and `api/src/funds.js:classifyVoucher` combine receipts with sales/credit notes, and payments with purchases/debit notes. An invoice and its settlement may both be included. The UI labels these as **voucher activity**, not verified cash flow. Reliable cash flow needs signed bank/cash postings with transfers and settlements handled correctly.
- `api/src/funds.js:fundsOnHand` takes an absolute value; `mapFinance` and `bankAccounts` use it for bank/cash balances. This removes debit/credit direction. Overdrafts, restrictions and reconciliation cannot be inferred reliably from these totals. Verify source sign conventions and preserve them in the API before using the reported balances as available funds.
- Revenue and expenses are ledger-group closing balances. The contract does not establish a comparable reporting period, opening-balance treatment, inventory adjustments, tax or consolidation eliminations. The UI says **revenue less expenses**, not audited profit. Combined company totals are labelled before eliminations.
- The forecast averages activity-bearing months or spreads ledger closings over financial-year months. Its schedule starts with future months, and existing payable/receivable due dates are not scheduled separately. It is an **indicative run-rate model**, not an approved budget or dependable cash forecast. Runway is retained as a model indicator, with explicit no-burn, no-cash and unavailable states; it is not guaranteed funding capacity.
- `VoucherRow.amount` cannot distinguish a real zero from a missing source amount. The UI marks zero voucher values accordingly. `withAmount` counts non-zero values, so it is shown as a count, not proof of complete data.
- Receivables/payables are not aged. Overdue amounts, DSO/DPO, collection dates and payment priorities require invoice-level due dates and settlement links; they are not fabricated here.
- `lastSync` is a global import record; `generatedAt` and `funds.asOf` are retrieval/calculation dates. They are not a per-company accounting cutoff. The UI distinguishes these dates. A future API contract should provide source date and coverage per company.
- Project earned/invested/net are based on tagged voucher classifications, not independently verified project profit or budget variance. The UI shows this basis and the available non-zero amount count.

Recommended next finance-data work: establish signed, reconciled cash postings; per-company source/period coverage; invoice ageing and settlements; then approved budgets and comparable actual-versus-budget periods. Those contracts would support a dependable 13-week cash forecast and aged collection/payment views.

## Validation

- `npm run build`: passed; initial bundle 396.53 kB (estimated transfer 101.83 kB).
- `npm test -- --watch=false`: 30 tests passed across 10 files. Covers menu state/navigation, responsive filter state, record content/escaping, signed chart scales, missing data, cancelled reads, report scope, month-end dates and transaction search/date validation.
- `node --test test/funds.test.js` in api: 5 tests passed, including corrected funding assessments.
- `git diff --check -- api ui`: passed.
- No connected browser was available in this session. Unit tests verify DOM content and state transitions, not CSS layout, native focus trapping or touch behavior on real devices.
- Before release, verify all routes at 320, 390, 760, 900 and 1440 CSS pixels, plus 200% zoom. Confirm no page-level horizontal overflow, complete currency values, mobile Details access, filter expand/collapse, menu keyboard/rotation behavior, long names, empty/error states and company drill-downs.
- Read-only database reachability was attempted using SELECT 1. Authentication failed because the local database configuration has no usable password (SCRAM client password must be a string). No financial records were read or changed. Live reconciliation and deployment remain pending.

## Feature preservation follow-up

The earlier responsive rewrite omitted useful existing summaries. This follow-up restores them; responsiveness does not require removing business functionality.

| Existing capability                                              | Preserved implementation                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Bank-only headline and last-month spending                       | Funding KPI cards alongside the new executive indicators                                           |
| Three-month budget, runway and headroom after budget             | Explicitly labelled model indicators with their assumptions                                        |
| Company funding status and explanation                           | Restored in shared company records; backend rules corrected to avoid false Comfortable assessments |
| Company bank, spending, inflow and next-month requirement totals | Restored totals panel; missing inflow is unavailable, not silently zero                            |
| Ledger-group aggregate balances                                  | Restored on Overview with group-scoped ledger links                                                |
| Dashboard project records and totals                             | Restored on Overview; project summaries and columns shared with Reports                            |
| Report company group count                                       | Restored at company drill-down level                                                               |
| Report ledger Payments shortcut                                  | Restored as matching-voucher activity with company, ledger search and inclusive last-month dates   |
| Project invested, earned, net and voucher-count summaries        | Restored in both Overview and Reports                                                              |

Additional integrity changes:

- Funding assessment checks cash against payables regardless of receivables, flags estimated spending, and checks one-month spending coverage before Comfortable. Zero cash is never Comfortable. No inter-company transfer recommendation is inferred.
- Bank-account responses additionally expose rawBalance; the UI preserves this signed source balance for reconciliation. Existing signed-numeric versus Dr/Cr import formats must be reconciled before changing normalized financial amounts.
- CSV cells originating from source text cannot become spreadsheet formulas. Numeric negative balances stay numeric.
- Exports exceeding the 20,000-row limit fail visibly before download, with instructions to narrow filters, instead of silently producing partial reports.
- No new funding formula, cash posting classification or source sign conversion was guessed. Invoice/payment overlap, sign normalization and source completeness remain financial reconciliation gates.

Release this UI with the API changes: corrected companyInsight rules and additive rawBalance. No schema migration is needed. A signed source balance is unavailable when running against an older API.
