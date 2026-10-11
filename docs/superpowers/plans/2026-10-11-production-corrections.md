# Production correctness fixes

> Execution: focused implementers with independent review and integration checks. No automatic commits, builds, VPS actions or live database changes. User approved all sixteen review findings and focused tests/typechecks.

**Goal:** Correct all sixteen findings from the full-system review of `8e8f010`.

**Architecture:** Keep one API, Angular UI and PostgreSQL migration owner. Correct existing flows; preserve successful financial history. Missing measurements and unknown currency must never masquerade as known zero/INR. Existing migrations 001–019 remain unchanged.

**Constraints:** Prefix shell commands with `rtk`. Preserve existing `deploy/README.md` and `deploy/api.env.example` user edits. Never print credential contents or their diffs. Work in the existing shared checkout as explicitly requested; do not commit or reset it.

## Tasks and ownership

- [x] Intelligence: correct single/two-row header detection and validate required outstanding measurements (findings 1–2); unique company identity with atomic creation (3); stable manual ledger mappings across refreshes (4); readable exception details and retrievable decision rationale (15–16). Own `api/src/intelligence`, Angular imports pages/services, relevant tests, new migrations 021 and 022. Preserve historical numeric IDs; resolve stable identities only for new generations. Existing conflicting company data must be diagnosed before uniqueness is imposed, never silently discarded.
- [x] Reports: currency-aware or explicitly unavailable monetary contracts; signed/net expense aggregation; resolved custom voucher classifications; coherent books snapshots; complete large-voucher results/exports; unavailable/error summary totals (5–10). Own core reporting API and non-import Angular report pages/services/tests. Add no exchange-rate assumptions. INR remains the display default only where known INR is established; refuse unsupported cross-currency totals.
- [x] Ingestion: forward migration 020 aligns source-key capacity and retains completed chunk receipt hashes; validate retries against stored normalized content and index (11–12). Own ingestion/chunk code and focused tests. Preserve original key values and API contracts; old completed receipts without evidence must not claim a verified matching retry.
- [x] Authentication: isolate login throttling using an explicitly trusted reverse-proxy chain and unspoofable forwarded client address (13). Own API auth/server, Caddy/Compose configuration and auth tests. Direct untrusted callers must not choose their rate-limit identity via arbitrary headers.
- [x] Deployment: prepare/verify uploaded staging artifacts and load their images before database-only migration; support the documented build/upload → migrate → deploy sequence (14). Own PowerShell/Bash deployment helpers, tests and runbook. Preparation must not replace running containers or promote the current release.
- [ ] Integration: check migrations and cross-module contracts; run focused regression suites/typechecks; obtain independent review, resolve findings and summarize exact verification/deferred deployment.

## Review focus

1. Single-header and merged multi-header workbooks preserve every account; absent pending measurement mappings fail before claims/publication.
2. Concurrent initial uploads and ledger ID churn cannot split company ownership or invent financial gaps.
3. Currency, signed expense corrections, custom voucher hierarchy and summary outages produce consistent, explicit financial results.
4. Export counts and items share a snapshot, including capped/oversized results; completed upload retries cannot silently acknowledge changed data.
5. Proxy spoofing and multiple real client addresses, staging-only releases, interrupted preparation and old receipt migration all fail safely.

## Progress

- Baseline: `8e8f010`; only README release-tag and env example user changes present before implementation.
- Design authority: user request to fix all review findings; existing full implementation/reviewer and focused-check authorization retained. Builds and deployment remain with the user.

### Implemented and reviewed

All sixteen findings have source fixes. Independent review additionally identified and corrected blank account rows bypassing validation, Intelligence currency propagation, migration diagnostics and previous-image migration compatibility. New migrations are 020–023; 001–019 are byte-unchanged. The permanent forward ledger uses the same migration owner and transaction. A compatibility trigger prevents older mapping writers from retaining stale durable identity.

### Verification evidence and remaining release checks

- Auth/proxy and migration-owner/forward-history suite: 19 passed.
- Adjacent report/API suites: 34 passed, 5 database-dependent tests skipped.
- Intelligence route suite: 18 passed; corrections: 8 passed; app/spec TypeScript checks passed.
- Angular template compiler (`ngc --noEmit -p tsconfig.app.json`): passed after the final imports changes.
- Offline database-first shell tests, existing release transition tests and PowerShell SSH tests: passed. All Docker/HTTP/SSH operations in these deployment tests were mocked.
- Diff checks passed, and existing migrations 001–019 have no changes. User env example was not read or edited; README release-tag edit retained.
- **Still required before release acceptance:** execute migrations, adoption, legacy mapping-write triggers and ingestion tests on disposable PostgreSQL; run Angular runtime/browser checks. Local Docker requests timed out and PostgreSQL was unreachable. Angular bundles compiled, but Vitest workers timed out before execution. These are not passing runtime checks.
- The attempted isolated container was named `finance-production-fixes-test-20261011`, bound only to local port 58419. Its launch was cancelled after Docker stopped responding; a targeted removal also timed out. Once Docker responds, inspect/remove only this disposable container if it exists. No other container was changed.
- No commit, production build, VPS action or application-database operation was performed.
