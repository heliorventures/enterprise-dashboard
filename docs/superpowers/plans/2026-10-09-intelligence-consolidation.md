# Intelligence consolidation implementation plan

Spec: ../specs/2026-10-09-intelligence-consolidation-design.md

Global constraints: no commits/builds/deployment/live DB changes; use rtk commands; preserve deploy/api.env.example. Tests and typechecks authorized. Work in the existing user checkout with nonoverlapping file ownership. Scoped agents read this spec and their task only, not entire history.

## Task 1: Durable import and financial read models

Owner: backend implementer. Own api/src/intelligence except routes.js/migrate.js; api/migrations/019_intelligence_publication.sql; api/test/intelligence*.test.js and api/test/intelligence/. Root owns previous canonical migrations and route contracts.

Implement durable file-row claims, immutable generations, company pointer and current views; stage complete validation, freeze inputs, publish atomically, preserve previous data on error/restart. Fix sparse row iteration, strict dates, exact amounts, mapping precedence/null-ignore and invalidation. Reserve manual maps before automatic matches, prevent duplicates, capture archived balance-date provenance, scope reconciliation/exception updates including Tally-only rows. Keep public service signatures and existing payloads, add provenance fields. Define schema in 019 and communicate it promptly. Unit regression tests first; isolated PostgreSQL checks where available, never existing data.

## Task 2: Angular workflows and request correctness

Owner: UI implementer. Own ui/src/app and focused UI tests. Keep existing styling and authorization; add outstanding search/pager, account detail, exception queue, quality and audit views, safe complete CSV download actions. New static routes precede imports/:id. APIs: GET /api/imports/accounts/:id; GET/PUT /api/imports/exceptions[/:id], mutation {status:'RESOLVED'|'REJECTED',comment}; GET /api/imports/quality; GET /api/imports/audit?entity&limit; GET /api/imports/reports/:type.csv (outstanding/reconciliation/exceptions/quality), company/status/q scope. Arrays retain current shapes. Cancel all stale import/report reads, retain voucher type on drilldowns, preview selected account-name mapping, gate repeated/invalid processing. Focused Angular tests and tsc --noEmit, no build.

## Task 3: Canonical migrations, retained routes and credentials

Owner: root. Copy Intel 001..004 unchanged to api/migrations/015_intelligence.sql, 016_intelligence_difference_pct.sql, 017_intelligence_account_maps.sql, 018_intelligence_recon_tally_only.sql. Adopt legacy tracker evidence atomically under existing migration lock; remove second runner/startup invocation. Add tested retained endpoints with strict inputs, session protection and CSV formula escaping/explicit export limits. Align API login provisioning and production startup validation using bcrypt hash plus random session secret, preserve legacy plaintext compatibility. Update deploy helper migration command and documentation, no execution on VPS.

## Task 4: Remove standalone duplication and review

Owner: root after tasks 1..3 contracts settled. Move reusable tests/sample/dictionary first, remove standalone project and tracked runtime upload (same fixture bytes), ignore runtime storage. Update root and deployment README to one API/UI/database/migration command and backup directory. Review all task diffs, run focused API and UI checks plus whitespace checks. A fresh independent reviewer checks integrity, concurrency, security, migration compatibility and retained UI workflows. Address findings and repeat only affected checks.

## Progress

- Design/preflight: ready. Task 1 and 3 share migration boundary only: root owns 015..018 and runner; backend owns 019. Task 2 and 3 share the listed HTTP contracts. No implementation file overlaps. User-approved consolidation supplies the design authority; safe financial defaults are recorded in the spec.
- Task 1: complete. Durable claims, exact complete validation, immutable generations, atomic publication/corrections, dated current views, archival provenance and coherent reads implemented. Final backend focused suite passed 46/46 with ten PostgreSQL behavior subtests and migration adoption.
- Task 2: complete. Retained Angular screens, true server paging, request cancellation, validation/process guards, scoped exports and drilldowns implemented. Final parity 9/9, preceding affected workflow checks passed, final app TypeScript check passed.
- Task 3: complete. Single canonical runner adopts legacy evidence without adding unknown names to old trackers; bcrypt login and independent session key provisioning align the API deployment. Root auth/HTTP/migration checkpoint 21/21, final affected retained HTTP 15/15. Bash and PowerShell syntax checks passed.
- Task 4: complete. Reusable tests/fixture/dictionary preserved, tracked standalone project and duplicate migrations removed, runtime upload ignored, runbooks updated. Independent review verified all ten reported findings resolved, with zero unresolved important/critical source findings. Final whitespace checks passed; HEAD remains dc626363, no commits/builds/deployment. Disposable test container stopped and removed, temporary editing helpers removed.

Recovery: session ended during work; agents restarted with scoped briefs on October 9. All prior source edits preserved, no commits. Dedicated disposable container enterprise-dashboard-intel-test-20261009 uses loopback port 58419, DB enterprise_dashboard_test; api/scripts/test-intelligence.ps1 pins only this test connection. Remove that container after verification.

Ruling: preserve legacy tracker/startup compatibility, but do not relax generation ownership to support the previous destructive Excel processor. Older Excel writes are unsupported after 019; the runbook requires a consolidated image and a quiet import transition. If an operator rolls back to old Excel code, imports fail rather than regain its unsafe history deletion behavior; use a consolidated rollback image.
