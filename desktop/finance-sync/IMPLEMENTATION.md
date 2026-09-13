# Helior Finance Sync

Approved 2026-09-13. Build an Electron app in this repository using the existing source agent and API. Windows 10/11 Intel/AMD x64; unsigned NSIS installer; existing finance branding; no end-user configuration or runtime installation. All accessible companies selected afresh for each run; unchecked companies excluded from pending delivery too. User signs into Tally manually.

- [x] Extend source-agent with in-memory configuration, selected GUIDs, structured progress and cooperative cancellation. Preserve CLI defaults and durable retry identities.
- [x] Add build-time environment validation and an explicit packaging allowlist; protect runtime credentials with Windows safeStorage. Never read API environment files automatically.
- [x] Add a sandboxed local renderer, narrow IPC, worker lifecycle, readiness discovery, persistent history and diagnostic export.
- [x] Create the branded NSIS installer and persistent per-user state, plus administrator migration/build instructions.
- [x] Verify agent regressions and desktop state/security behavior: 48 tests passed. Source and packaged-code hidden Electron smoke checks passed against synthetic Tally.
- [ ] Release gate: supply the real ingestion token in `.env.local`, build the configured installer and validate installation/upgrades and live Tally/API reconciliation on target Windows machines. No live writes have been performed.

Code stays uncommitted for user review. No backend deployment, live uploads, Dart/Flutter commands, task removal, or production credential acquisition during automated validation.
