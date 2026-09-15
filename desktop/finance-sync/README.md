# Helior Finance Sync

Windows 10/11 Intel/AMD x64 desktop app and unsigned EXE installer. It reuses `deploy/tally-agent`. All data uses `/api/ingest/tally/source/{begin,chunk,complete}`; period replacement uses `/api/ingest/tally/source-period-replace/{preflight,begin,chunk,complete}`. Deploy the updated API, migration `013_period_source_identity.sql`, and Finance UI/Caddy before period replacement. The installer alone does not deploy the backend.

## Accountant workflow

1. Install the configured EXE. It bundles Electron and the agent dependencies; no Node.js, npm, terminal, or configuration editing is needed on the accountant's computer.
2. Open Tally on that computer, load the required companies and complete their login. The configured local HTTP/XML server must be enabled.
3. Open **Helior Finance Sync** from its desktop or Start menu shortcut.
4. Opening the app only loads local history. It does not connect, discover companies, upload or retry. Choose **All data**, **Today**, **Current month**, or **Last month**, then **Sync now**. This discovers loaded companies and processes them sequentially. To skip companies, first use **Check connection**, then uncheck them before Sync.
5. Review the per-company results. **Stop sync** aborts our network work; **Force stop** immediately terminates our worker. There is also a two-second termination fallback. A failure stops the desktop run; it does not automatically retry or proceed to the next company.

No initial full sync is required. All data reconciles the complete imported Tally dataset; Today, Current month and Last month replace vouchers only in their selected dates. A successful empty period removes previously imported vouchers from that period. Other dates and manually created Finance entries are preserved. Current month and Last month cover the entire calendar month, including future-dated vouchers in the current month. Dates use the computer's local calendar and are frozen on click. Masters are refreshed separately in full-date context to preserve ledger balance semantics.

All chunks and collections must pass extraction and financial validation before the selected company is changed. Raw period captures stay partial; a cumulative archive records the published baseline (if any), period replacement and imported date coverage. Finance displays a limited-history notice until All data has been imported. Failed archives do not become the next replacement baseline. Publication checks the baseline under the import lock and rejects a racing change without modifying reporting. Cumulative archives consume additional server storage.

The new replacement endpoint prevents older APIs from silently interpreting the request differently. The legacy 1.1.0 period endpoint retains its preserve-missing-vouchers semantics. Saved 1.1.0 period captures are retained but are not automatically resent as replacement captures; administrators can reconcile those older archives separately. Saved full captures remain compatible.

Each collection is requested separately, with a 500 ms interruptible pause between Tally requests. Voucher details are exported in windows of at most seven days. All data first streams only voucher dates, requests populated date buckets in order, and checks each detailed record count against that scan. It does not assume today is the last voucher date and skips empty gaps. A period export requests every window, including empty ones, to establish replacement coverage. These safeguards reduce request size but cannot guarantee Tally responsiveness; a single busy day or large master collection may still be expensive.

If Finance explicitly rejects a saved period as stale, its directory is retained with `held.json` for investigation. It is excluded from future retries, allowing the next manual sync to take a fresh capture. No accounting files are deleted by this recovery action.

The app does not collect Tally passwords, sign into Tally, load companies, write to Tally, or install a scheduler/service. It cannot distinguish an unloaded company from a login requirement without evidence from Tally. Connection status describes Tally access; API credentials and availability are checked during upload. Accountants do not need to configure the Finance connection.

## Build a configured installer (administrator/developer only)

From `desktop/finance-sync`:

```powershell
npm ci
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Do not overwrite an existing `.env.local`. A blank local template has been created during implementation. Edit it locally:

```dotenv
FINANCE_API_URL=https://finance.heliorsoft.com
TALLY_INGEST_TOKEN=<existing deployment ingestion token>
TALLY_URL=http://localhost:9000
TALLY_REQUEST_TIMEOUT_MS=300000
```

Then build:

```powershell
npm run build
```

This creates `release/Helior-Finance-Sync-1.2.0-Setup.exe` for the current version. It builds only; it does not upload or deploy anything. The build fails before packaging if configuration is missing or invalid. No production credential is read from another project or an API environment file. The installer includes your configuration automatically.

### Release versions and upgrades

`package.json` is the version source for the installer filename and window caption, Windows installed-app entry, in-app version badge/title, and exported diagnostics. Rebuilding alone does not increment it. Before the next release, from `desktop/finance-sync`, set the next version explicitly:

```powershell
npm version 1.2.1 --no-git-tag-version
npm run build
```

The version command updates both package files without committing or creating a Git tag. Use a new version for each distributed release; do not give different exports the same release version. Test installers follow the current version with a `-test` suffix.

Copy the newly built **Setup.exe** to the user's machine. Finish or stop any sync, close Finance Sync, and run the installer under the **same Windows user**. With the application ID and per-user installation unchanged, NSIS is configured to replace the program files and keep the existing application data. No manual file replacement or prior uninstall is needed. After installation, confirm the version shown at the top of Finance Sync. The installer does not automatically download updates.

Do not change the application ID, product name or installation scope between upgrades. Preserve `.env.local` on the build computer so rebuilt releases target the same Finance deployment. Live installation/upgrade validation with pending data remains a release acceptance check.

`.env.local`, generated resources and installers are excluded from Git. **The installer contains the ingestion credential and must be distributed privately to authorized users.** Electron packaging is not secret encryption. A user who can inspect the application can recover a bundled token. The current API token authorizes imports across this deployment's companies. Supporting independently revocable device credentials would require a separate backend change.

On Windows the app stores its working credential using Electron safeStorage/DPAPI. A newly built installer with a changed credential replaces the protected local copy on launch. Tokens and raw accounting payloads are never passed to the renderer or exported in the diagnostic log.

## Installer details

- Product and shortcut name: **Helior Finance Sync**.
- Icon generated in 16–256px sizes from `ui/public/brand-mark.svg`.
- Per-user installation with desktop and Start menu shortcuts and a standard uninstall entry.
- Bundled runtime; no runtime downloads on the accountant's computer.
- Windows 10 minimum check; x64 package.
- Unsigned: Windows may display an unknown-publisher/SmartScreen warning. Managed Windows policies or Smart App Control may block installation. Signing can be added later; even newly signed apps may receive reputation warnings. No signing certificate is included.
- Normal updates preserve `%APPDATA%\Helior Finance Sync\state` and the protected credential. Uninstall preserves application data. Administrators must handle any requested accounting-data deletion separately.

## Durable data and results

State is stored in `%APPDATA%\Helior Finance Sync\state`, under the current Windows user's profile. Outboxes contain accounting data and should only be accessible to that user and authorized administrators. Do not share this directory through a public/network folder.

Only selected company GUIDs are eligible for extraction and pending-upload retries. Before any interactive upload the worker rediscovers the selected GUIDs; a disappeared company blocks that run. A pending capture is retried with its original batch identity and bytes. Companies retried in that run receive a fresh capture on the following run. Unchecked-company batches remain queued. If a queued company is unavailable, load it in Tally and check again.

Cancellation stops our worker, not Tally. An export or Finance commit already accepted by the other application may finish after disconnect. Interrupted extraction is never uploaded as a completed capture. Ready batches survive interruption and uncertain server acknowledgements. Saved uploads are retried only on a manual sync with the same companies and exact period dates (or All data for saved full captures). Duplicate-run protection includes the desktop single-instance lock and the existing lock keyed to the state directory. Separate installations with separate state directories do not share that lock.

`Data uploaded` means the source archive was acknowledged. A complete archive or cumulative period update with `reportingStatus: validated` is shown as `Synced`. Incomplete capture, reporting failure and older APIs returning no reporting status need attention. A whole-run successful timestamp requires every selected company to be validated. The API may save an archive even if reporting validation fails; the app preserves that distinction.

Recent results survive restart. **Export diagnostic log** saves bounded, sanitized events and pending-upload counts for administrator investigation. It omits tokens, raw exceptions, record payloads and local filesystem paths. It can include company names and GUIDs. Detailed logs are in `%APPDATA%\Helior Finance Sync\state\logs\*.jsonl`, including manual connection checks, worker exits and Stop requests. Agent logs identify the company, collection, request duration and errors. Retention cleanup runs during manual sync (30 days); opening the app does not prune logs. Preview data is not generated by the desktop workflow.

The startup investigation reproduced an automatic discovery request in the previous renderer before any click. The installer also previously launched the app automatically. Both behaviors are removed. The code takes no direct Tally data-file lock. Broad XML exports can still occupy Tally; without the client logs the precise freeze cause is unconfirmed. Real Tally responsiveness and server-side export cancellation cannot be guaranteed by synthetic tests.

## Migrate a scheduled installation

An administrator must disable the old scheduled task before the first desktop sync. Do not run both installations against the same companies. The desktop app does not guess task names or change Windows tasks.

With both senders stopped, back up the old `state` folder. If there are source pending batches to preserve, copy the old `state/source-outbox` into the new user's `state/source-outbox` **before first use**, preserving every batch directory and its contents. If a destination batch ID already exists, compare it before proceeding; never overwrite it automatically. Copy only the source outbox; legacy dashboard batches are a different protocol. Do not move plaintext Tally login credentials into this app. Keep the old backup until uploads have been reconciled.

## Development and verification

```powershell
npm test
node ../../deploy/tally-agent/launcher.js --dry-run
```

The second command requires separately configured Tally-agent configuration and contacts Tally; it is optional and is **not** part of automated tests. To exercise only synthetic data:

```powershell
node scripts/prepare.js --test
npm run smoke
npm run build:test
npm run smoke -- --packaged
```

`build:test` creates `release/Helior-Finance-Sync-1.2.0-test-Setup.exe` for the current version, with dummy credentials. The test installer permits connection checks but disables captures/uploads, and uses a separate `test-state` directory. It is not a customer release. The smoke harness uses synthetic companies and the actual renderer/preload/worker in a hidden window; it never contacts production. Screenshots are saved under `test-artifacts`. Test fixtures and developer scripts are excluded from the installed application.

For the complete agent and desktop suite, from repository root:

```powershell
node --test deploy/tally-agent/test/*.test.js desktop/finance-sync/test/*.test.js
```

Before distribution, validate the configured installer on actual target Windows/Tally machines: initial installation/shortcuts, Tally closed, no company loaded, login/permission restrictions, company disappearing, large capture, interrupted upload, restart, repeat sync, reporting rejection, and upgrade with a pending batch. Synthetic tests do not establish real Tally compatibility or production reconciliation.

For the repeatable release gate, run from the repository root:

```powershell
powershell -NoProfile -File .\desktop\finance-sync\scripts\release-test.ps1
```

This developer-only suite creates isolated PostgreSQL and HTTPS test services, verifies the installer payload, runs regression tests and 19 packaged-app scenarios, and writes versioned evidence under `test-artifacts/release-*`. It does not install the app or contact production. Required tools, report interpretation and the Windows/Tally acceptance checklist are in [release testing](../../deploy/docs/finance-sync-release-testing.md). End users still need only the installer.
