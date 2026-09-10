# Tally sender validation

Validated locally on 2026-09-11:

- Eight API tests passed against an isolated PostgreSQL 16 container with database `enterprise_dashboard_test`. Migration 003 applied alongside existing migrations; existing ingestion tests still pass.
- A 50,100-voucher snapshot exceeding 20 MiB was uploaded in 51 chunks and finalized with the exact row count. This is a functional scale test, not a VPS throughput benchmark.
- Missing chunks, changed retry payloads, mismatched manifest totals and cross-chunk duplicate ledgers were rejected. Failed finalization preserved existing live data. Completed batches returned repeatable acknowledgements.
- HTTP tests checked authentication before body parsing for each new machine endpoint.
- Four sender tests passed: exact decimal handling and invalid dates; streamed XML/truncation/error detection; bounded chunks and identical retries after a lost acknowledgement; full-run persistence and resume after failure, without logging the token.
- PowerShell runner parsed successfully. No Task Scheduler job was created.

Not validated: actual TallyPrime exports, company availability/session behavior, custom voucher/accounting conventions, server-side Windows execution and target-volume runtime. Perform a dry run and reconcile against Tally before live uploads.

The local `caddy:2-alpine` image could not execute (`exec /usr/bin/caddy: exec format error`), so the new UI Caddy route configuration was not runtime-validated locally. Deployment validates the Caddy configuration before starting the release. No VPS changes or production imports were executed during implementation.
