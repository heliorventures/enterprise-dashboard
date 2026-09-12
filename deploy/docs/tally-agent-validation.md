# Tally sender validation

Built-in config credential entry on 2026-09-12: twelve tests passed, adding paired-credential validation, exclusive login-mode validation, built-in helper invocation, suppression of credentials in events, and post-login XML readiness gating. The Windows UI Automation script parsed successfully and the required Automation.Compare API is present locally. The `tally-003` bundle includes this script and blank username/password fields. No actual Tally GUI login or credentials were exercised: control discovery, writable Value-pattern support, submission and interactive-session behavior still need verification on the Tally server. Earlier external-helper-only limitations below describe the previous bundle.

Configurable startup validation on 2026-09-12: ten sender/fixture/launcher/startup tests passed, covering opt-in behavior, readiness reuse, required-company polling, timeout, remote-host refusal, configured login-helper invocation, and a real Windows PowerShell process check against the already-running test Node executable. No Tally process was launched and no live login or VPS upload was attempted. The actual Tally executable path and optional credential-entry helper remain installation-specific. The `tally-002` bundle adds these settings, disabled by default.

Portable package validation on 2026-09-11: built `deploy/bundles/tally-001/FinanceTallyAgent-tally-001-win-x64.zip` with the pinned Node.js 22.23.2 Windows x64 runtime, verified against the official SHA-256 manifest. All six sender/fixture/launcher tests passed. An extracted ZIP in a path containing spaces ran `Run-Sync.cmd --dry-run` with Node removed from PATH, extracted 5 ledgers and 2 vouchers from a local XML simulator, and wrote a successful run log. The packaged token file was verified empty and fixture tools were absent. No production uploads were made during this packaging test. Actual server execution and Task Scheduler policy remain environment-specific.

Validated locally on 2026-09-11:

- Eight API tests passed against an isolated PostgreSQL 16 container with database `enterprise_dashboard_test`. Migration 003 applied alongside existing migrations; existing ingestion tests still pass.
- A 50,100-voucher snapshot exceeding 20 MiB was uploaded in 51 chunks and finalized with the exact row count. This is a functional scale test, not a VPS throughput benchmark.
- Missing chunks, changed retry payloads, mismatched manifest totals and cross-chunk duplicate ledgers were rejected. Failed finalization preserved existing live data. Completed batches returned repeatable acknowledgements.
- HTTP tests checked authentication before body parsing for each new machine endpoint.
- Four sender tests passed: exact decimal handling and invalid dates; streamed XML/truncation/error detection; bounded chunks and identical retries after a lost acknowledgement; full-run persistence and resume after failure, without logging the token.
- PowerShell runner parsed successfully. No Task Scheduler job was created.

Not validated: actual TallyPrime exports, company availability/session behavior, custom voucher/accounting conventions, server-side Windows execution and target-volume runtime. Perform a dry run and reconcile against Tally before live uploads.

The local `caddy:2-alpine` image could not execute (`exec /usr/bin/caddy: exec format error`), so the new UI Caddy route configuration was not runtime-validated locally. Deployment validates the Caddy configuration before starting the release. No VPS changes or production imports were executed during implementation.
