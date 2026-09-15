# Manual Finance Sync and period updates

## Approved revision: 1.2.0

This revision supersedes the 1.1.0 period semantics recorded below. Full sync replaces Tally-imported data; Today / Current month / Last month replace vouchers within the selected dates, including removal of omitted vouchers. No initial full sync is required. Manual Finance entries and vouchers outside the selected period are preserved. Current month includes the entire calendar month. Masters are refreshed independently of the voucher period.

Implementation is complete. New authenticated `source-period-replace` routes separate replacement from older clients' preserve-missing protocol. Validation precedes reporting publication; a baseline comparison prevents concurrent cumulative imports from overwriting newer published data. Older clients cannot use a period-only baseline. Finance displays limited history coverage when no full history has been imported.

Desktop startup remains passive. Companies and collections run sequentially, with 500 ms pauses between requests. Detailed voucher requests cover at most seven days each; full exports first scan voucher dates and skip empty date buckets. Stop aborts the worker, with a termination fallback and Force stop. Tally may continue processing a request it has already accepted after our worker disconnects; client-side responsiveness still needs real Tally testing.

Verification on 2026-09-15: 66 agent/desktop tests passed; 10 dashboard tests passed; the UI production build passed. API regression: 43 passed, 14 database-gated skips. All six focused legacy/replacement tests passed separately against isolated PostgreSQL, including first-period replacement, empty replacement, manual/outside-period preservation, validation failure and mixed-version concurrency. The test database was stopped. The configured 1.2.0 installer built successfully; package verification and packaged Electron smoke passed, including visible version and zero startup requests.

Release: `desktop/finance-sync/release/Helior-Finance-Sync-1.2.0-Setup.exe`. Remaining rollout work: deploy the updated API, UI and Caddy routes; apply migration `013_period_source_identity.sql` if not already applied; then test installation/upgrade, Today sync, Stop and Tally responsiveness on the client machine. No production deployment or client Tally verification was performed. Client logs remain unavailable, so the original freeze cause is unconfirmed.

## Historical implementation: 1.1.0

Approved scope: opening the app performs no network work; Sync discovers companies and processes them sequentially; Stop aborts our worker with a two-second termination fallback and an immediate Force stop option. All uploads are explicitly user initiated. Period updates require one successful full sync per company.

Implementation and verification:

- [x] Verify passive startup, manual discovery/start, sequential extraction, fail-fast behavior, Stop and diagnostic history in controller/worker/agent tests and hidden Electron smoke.
- [x] Add local-calendar Full / Today / Current month / Last month selection. Freeze dates once per run. Only vouchers use the selected period; masters retain full-date context. Validate returned voucher dates and GUIDs.
- [x] Add authenticated `source-period` preflight/begin/chunk/complete endpoints. Reject scoped manifests on full endpoints. Require latest full/cumulative archive to match validated Finance data; reject stale captures. Archive period records as partial and create a separately identified cumulative snapshot with baseline provenance, retaining unreturned vouchers. Existing reporting validation must pass before reporting changes.
- [x] Cover date boundaries, out-of-range data, missing GUIDs, baseline prerequisite, conflicting retries, merge preservation and repeated periods using synthetic fixtures and isolated PostgreSQL.
- [x] Update operator documentation/version, build configured Windows installer, verify package and hidden packaged smoke. No commits or production imports/deployments.

Limits: client logs are unavailable, so the exact freeze cause is unconfirmed. An export accepted by Tally may continue after our process disconnects. Period updates preserve omitted vouchers, including deletions and vouchers moved outside the selected period, until a later full sync. Masters still require extraction. Raw period and cumulative archives consume additional server storage.

Validation on 2026-09-15: 57 agent/desktop tests passed; API suite had 41 passing and 12 database-gated skips. All 3 period tests passed separately against an isolated PostgreSQL 17 instance, including authenticated HTTP completion, preserved history, empty-period safety, stale rejection, and later full reconciliation. The isolated database was stopped after verification. Source and packaged Electron smoke passed; the final packaged smoke also exercises direct Sync discovery and fail-fast behavior. Package verification checks exact current sources, x64 and six icon sizes.

Review found a stale pending-period retry trap. Fixed by retaining an explicitly stale server-rejected capture with a `held.json` marker; a focused regression proves that the next manual run takes a fresh capture. No pending accounting data is deleted by that recovery.

Release: `desktop/finance-sync/release/Helior-Finance-Sync-1.1.0-Setup.exe`, configured from existing private `.env.local`. Before period use, deploy updated API and UI/Caddy routes and apply migration `013_period_source_identity.sql`. The installer does not deploy server changes. Live client installation/upgrade and real Tally load testing remain outstanding; no real Tally or production API was contacted by verification.
