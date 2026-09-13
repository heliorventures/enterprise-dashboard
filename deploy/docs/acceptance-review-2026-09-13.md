# Acceptance review - 2026-09-13

Baseline: commit `5f5f9a6`, plus the uncommitted acceptance corrections documented below. No production migration, deployment, remote Tally execution, staging or commit was performed by this review. The unrelated `deploy/api.env.example` change was preserved.

## Defects corrected

- Financial detail deep links now open the intended disclosure, and an open disclosure remains open after analysis refresh.
- Source paging and period navigation no longer reload unrelated dashboard or expense/project calculations. Company changes still reload their own scope. Dashboard/report requests are cancelled on page destruction.
- Cursor Previous navigation remains correct after browser-history navigation. Failures have direct retry actions, with an explicit first-page reset for invalidated cursors.
- Cursors include publication time and model version, so force-replaying the same source batch also invalidates old pages.
- Company filters are applied to source master/archive browsing when present in the URL.
- Failed archived-record reads can be retried. Archived JSON remains escaped text, including HTML-like source values.
- Partial-value categories are explicitly identified as excluded from charts. No postings in a complete reporting period is distinguished from unavailable posting/currency data. Cost categories distinguish otherwise identically named allocation chart rows.
- Month input validation rejects malformed or reversed periods and clears corrected form errors.
- Reports, Ledgers and Transactions use a shared page-scoped company directory backed by `/api/companies`, independent of dashboard calculations. Lookup failures have visible retry controls.
- The shared company selector preserves its selected company while asynchronous options load and after retry; it no longer incorrectly displays All companies for a selected-company page.
- UI test concurrency is bounded to two workers after an unrestricted worker pool exited unexpectedly during this audit.

## Evidence

- API: 42 tests passed on disposable PostgreSQL, including migration/backfill, rollback, source validation, exact decimals and large uploads. Focused source-model tests also exercise real authenticated HTTP requests for companies, overview, master records, detail records, archive history, issues and original source records; anonymous requests are rejected.
- Export agent: all 31 fixture/mock tests passed, covering XML handling, transport retries, immutable failed batches and missing source values. These tests do not establish compatibility with the remote Tally installation.
- UI: all 41 tests across 14 files passed. Angular production build passed (425.42 kB initial bundle). Interaction tests cover source navigation, company switching, retries, empty/partial data, escaped evidence, request cancellation, company option loading, shared tables and mobile-menu state.
- The tests exercise Angular DOM behavior in jsdom. Native dialog layout, touch interactions and viewport rendering require a real browser.

## Outstanding acceptance gates

No browser was connected when discovery was checked; the browser list was empty. A browser connection has been requested so the agent can perform the remaining mobile/desktop acceptance checks. This review does not claim visual acceptance.

The Tally server is unavailable for execution per the user's instruction. A fresh export and comparison against Tally at the same accounting cutoff remain necessary to verify real financial source coverage and reconciliation. Previously archived missing fields cannot be manufactured by application code.

There is no deferred implementation fix for the defects listed above. These external acceptance gates are explicitly separate from automated evidence; they must not be described as completed.

The disposable PostgreSQL container was removed after verification. No failing automated check remains from this audit.
