# Excel Intelligence

Intelligence runs inside the main Express API and Angular UI. There is no separate server, React application, port, database or migration command. The desktop Tally sender remains a separate client.

Open **Excel imports** (`/imports`) to upload a workbook, inspect its rows, adjust column mappings, validate and process. **Results** (`/imports/results`) shows current company snapshots with search and paging. **Tally sync** (`/imports/sync`) shows reconciliation and manual mapping. Exceptions, quality and audit views are under `/imports/exceptions`, `/imports/quality` and `/imports/audit`; account details are under `/imports/accounts/:id`.

A workbook is a full outstanding snapshot for one company. Keep bill, paid, debit and credit values separate; net pending is debit minus credit. Successful generations remain historical. Current reports follow the company's latest successful dated publication, rather than summing all uploads. Older reports remain available in history. Processing failures preserve the previous publication. An ordinary retry returns its existing job/result; deliberate reprocessing creates a new validated generation.

Column mappings and rules are frozen for each generation. Changing a mapping requires fresh validation. Invalid calendar dates, ambiguous duplicate accounts and malformed financial values cannot silently publish partial results. Source physical row numbers are retained even when the worksheet contains blank rows.

Tally comparison records the archived source batch and its ledger balance date (`manifest.dateContext.ledgers.to`). Unknown or different balance dates mean comparison unavailable. Capture time is not evidence of a balance date. Historical results keep their own Tally balances and mappings. Manual mapping conflicts are rejected instead of comparing two accounts with the same full ledger balance.

CSV exports follow their current filters and reject more than 10,000 rows; they do not silently truncate. Text cells are protected against spreadsheet formulas, while financial decimal values remain numeric.

All schema files are in `api/migrations`. Run `npm run migrate` from `api`, or use the uploaded release command in [the deployment runbook](../../deploy/README.md). `application_migrations` is the authoritative checksum tracker. The old `schema_migrations` and `intel_schema_migrations` tables preserve applied history and compatibility with older images; they do not have separate active runners. Legacy Intel migrations had no checksums, so their known identities are adopted once and protected thereafter. No records are dropped during adoption.

Migration 019 deliberately requires durable generation ownership. Older Excel processors cannot safely write after it; use a consolidated API image for all Excel operations. Legacy Tally/reporting startup compatibility is not a promise that old Excel processing can be restored. Complete in-flight imports and pause uploads for the first migration/application transition.

Back up PostgreSQL and `/opt/apps/enterprise-dashboard/shared` together. Uploaded workbooks live under `shared/storage/imports`; runtime credentials also live under `shared`, so protect the backup. Database migrations do not restore files. The fixture in `api/test/fixtures/intelligence/ageingoutstanding.xlsx` is retained from the colleague's original sample and is never imported automatically. Its [data dictionary](data-dictionary.md) describes that workbook, not every supported report.

Local isolated migration/publication tests use `api/scripts/test-intelligence.ps1` and a dedicated loopback PostgreSQL test container. This script explicitly sets the complete test connection and never inherits application database credentials. UI typechecks and focused tests do not prove browser acceptance or VPS health; validate a real workbook, login and backup restore before relying on production results.
