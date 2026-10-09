# Independent architecture review brief

Prepared by the dedicated GPT 6.1 Sol summariser from bounded design, plan, retained API report, working-tree status/statistics and root execution updates. No whole repository/history, secret files, or unrelated environment-file contents were read. This is a checkpoint, not completion evidence.

## Authority and boundary

User approved full consolidation, scoped agents, focused tests/typechecks. No builds, live database/VPS writes, deployments or commits. Original HEAD: `dc6263633b4873a47acf51b6e9bf44f5805c5105`; predecessor `bb9fc92` introduced both standalone and integrated implementations. Preserve unrelated `deploy/api.env.example`; never read/print it. Design: `docs/superpowers/specs/2026-10-09-intelligence-consolidation-design.md`. Plan: `docs/superpowers/plans/2026-10-09-intelligence-consolidation.md`.

Target: one Express API, Angular UI, PostgreSQL database and migration runner. Preserve desktop sender/archive/reporting. Snapshot imports preserve immutable successful generations; current reports use the latest successful dated company snapshot. Unknown/older dates cannot silently supersede dated current data. Validate complete rows before atomic publication; preserve previous publication on failures/restarts. Freeze mapping/rule/Tally inputs; exact decimal comparisons; unknown/mismatched Tally balance dates expose unavailable comparison.

## Ownership and persisted work

Root owns canonical migration runner, 015–018, credentials/provisioning/deployment docs, standalone removal and final integration. `backend_resume` owns financial services, publication helper, additive 019 and integrity/publication tests. `ui_resume` owns Angular workflows/tests. `routes_resume` owns retained HTTP routes/export serializer/tests. Interrupted agents restarted with narrow briefs; no implementation overlap intended.

Root reports canonical 015–018 preserve original Intel SQL bytes. `application_migrations` is authoritative; adoption checks historical evidence under migration lock, while legacy `schema_migrations` retains its original fourteen identities for rollback compatibility. Separate Intel runner/startup invocation removed. Review `api/src/migrate.js`, `api/test/migrationOwnership.test.js`, `api/test/intelligenceMigrationOwnership.test.js`, `api/migrations/015_*` through `019_*`.

Credential changes use bcrypt verification plus persisted random session secret and explicit legacy plaintext compatibility. Review `api/src/auth.js`, `config.js`, `server.js`, `deploy/configure-ui.sh`, Compose/deploy/migration helpers. Password provisioning mismatch predates colleague commit; current fixes must align production startup and login without predictable secret fallback.

Root moved three pure standalone tests, identical workbook fixture and dictionary to retained API/docs paths. Tracked standalone code, duplicate Intel SQL and tracked runtime workbook are deleted; ignored local uploads/environment files retained. Status confirms these deletions and new retained tests/docs. Several temporary `backend-*-rewrite.cjs`/`backend-reset-test.cjs` helpers remain untracked: verify cleanup before final handoff.

## Evidence versus pending

Root reports auth/migration/HTTP focused checks **8/8 passed** and Bash syntax checked. Retained API report records **12/12 passed**, process exit 0, targeted whitespace check passed: real Express/session handling with stubbed DB/services, including malformed multipart, explicit company/mapping validation, safe errors, current-view scoping and bound export limit. CSV preserves exact financial decimal strings, escapes formula-like text, rejects incomplete exports and over 10,000 rows. See `retained-api-report.md`; this does not prove real PostgreSQL/browser behavior.

Root reports disposable PostgreSQL baseline passed in `enterprise-dashboard-intel-test-20261009`, loopback `58419`, database `enterprise_dashboard_test`. Backend 019/publication tests are still finishing. Root's strict-loopback migration adoption test is pending execution. UI/backend completion reports were absent at this snapshot; final focused UI tests/typechecks, integrated database tests, final whitespace checks and independent review remain pending. No build, production startup, live migration, browser acceptance or deployment proof exists. Dispose of test container after validation.

## Reviewer priorities

Check durable concurrent claims/idempotent retry/reprocess, frozen input revisions, transaction rollback and crash recovery; legacy-data adoption and checksum/old-image compatibility; current/history views and reporting-date precedence; manual ledger reservations/duplicate prevention/Tally-only membership; exact money and date provenance; mapping invalidation and exception-decision atomicity; all retained routes session-protected and company-scoped; complete safe CSV exports; Angular stale-request cancellation, paging/filter preservation, account/exception/quality/audit flows and mapping preview. Inspect only relevant files and concrete tests; separate source conclusions from pending runtime evidence.
