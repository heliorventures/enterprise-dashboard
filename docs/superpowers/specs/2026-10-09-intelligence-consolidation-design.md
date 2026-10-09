# Intelligence consolidation

Approved scope: full consolidation and fixes, scoped implementation/review agents, focused tests and typechecks. No builds, deployment, live database writes, or commits. Preserve the unrelated change to deploy/api.env.example and never print its contents.

## Application boundary

Run one Express API (`api`) and one Angular UI (`ui`) against the existing PostgreSQL database. Intelligence remains a business module inside that API. Remove the standalone Express/React project after moving its useful tests, fixture and documentation. Keep the desktop Tally sender and existing archive/reporting logic.

## Financial publication contract

An outstanding workbook is a full company snapshot, not an additive transaction feed. Preserve every successful import generation. Current management reports use the latest successful dated snapshot per company; an older report remains historical. A report with no reliable reporting date cannot silently replace a dated current snapshot. Reject ambiguous duplicate account rows until bill-level aggregation is explicitly supported.

Reserve jobs in PostgreSQL under a file lock. Ordinary processing retries return the existing job/result. Reprocessing creates a new generation with frozen mappings, rules, validation and Tally reference. Parse and validate all source rows before publication. One pinned database transaction inserts the entire generation and changes the company publication pointer; failures retain the previous published data. Crash recovery releases abandoned durable jobs without deleting published history.

Reconciliation records belong to a generation, including Tally-only rows. Manual mappings reserve their ledger before automatic matching and prohibit multiple accounts consuming the same ledger balance. Mapping changes invalidate validation. A reconciliation change updates its exceptions and Tally-only membership atomically. Historical financial decisions are retained.

Compare Excel reporting date with the archived Tally manifest's `dateContext.ledgers.to`. Capture Tally batch and balance date. If the dates are unknown or different, expose comparison unavailable instead of asserting a match or a financial discrepancy. Monetary comparisons and import totals use exact decimal/cents arithmetic; presentation percentages may use floating point.

## Migration ownership

Use only `api/migrations` and one checksum/advisory-lock runner, with `application_migrations` as its authoritative tracker. Preserve the bytes and identities of all deployed migrations. Adopt the four existing Intel migrations under canonical core filenames while retaining both old trackers as historical evidence. Older images reject unknown tracker filenames, so new identities go only into the authoritative tracker. Add publication changes through a new additive migration; preserve legacy records and do not infer provenance for unowned Tally-only rows.

## Retained UI and security

Retain upload, editable mapping, row validation, processing progress, history, outstanding, ageing and reconciliation. Add usable paging/search, account details, exception decisions, quality/audit views and CSV exports already offered by the standalone project. Cancel stale requests and preserve all report drilldown filters. Keep existing session authentication for all import routes.

Align dashboard credential provisioning with the API that verifies credentials. Prefer the existing bcrypt credential hash over duplicated plaintext. Keep compatibility with deliberately configured legacy plaintext credentials. Persist a random session signing secret; no predictable fallback derived from a public password hash in production.

## Evidence and limits

Automated checks must exercise sparse rows, invalid dates, money precision, mapping revisions, concurrent job claims, idempotency, publication rollback, current/history separation, Tally-only gaps, manual conflicts, stale requests, paging and filters. Migration tests use a disposable isolated test database/schema only. No local source check proves the VPS startup error; actual container logs remain needed if deployment still fails.
