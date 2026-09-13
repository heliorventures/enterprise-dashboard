# Helior Finance Sync

Windows 10/11 Intel/AMD x64 desktop app and unsigned EXE installer. It uses the existing source agent in `deploy/tally-agent` and the existing `/api/ingest/tally/source/{begin,chunk,complete}` API. No backend changes or database migrations are required for this app. The deployed API must already support source archival and its separate reporting acknowledgement.

## Accountant workflow

1. Install the configured EXE. It bundles Electron and the agent dependencies; no Node.js, npm, terminal, or configuration editing is needed on the accountant's computer.
2. Open Tally on that computer, load the required companies and complete their login. The configured local HTTP/XML server must be enabled.
3. Open **Helior Finance Sync** from its desktop or Start menu shortcut.
4. All currently accessible companies are selected. Uncheck any company to skip for this run, then choose **Sync now**.
5. Review the per-company results. After fixing a problem in Tally, use **Check again**. Every fresh check selects all available companies again.

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

This creates `release/Helior-Finance-Sync-1.0.0-Setup.exe`. It builds only; it does not upload or deploy anything. The build fails before packaging if configuration is missing or invalid. No production credential is read from another project or an API environment file. The installer includes your configuration automatically. Update `package.json` version for subsequent releases and keep the lockfile in sync.

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

Cancellation aborts network work and stops between extraction steps. Interrupted extraction is never uploaded as a completed capture. Ready batches survive interruption and uncertain server acknowledgements. Duplicate-run protection includes the desktop single-instance lock and the existing lock keyed to the state directory. Separate installations with separate state directories do not share that lock.

`Data uploaded` means the source archive was acknowledged. Only a complete archive with `reportingStatus: validated` is shown as `Synced`. Partial capture, reporting failure and older APIs returning no reporting status are shown as needing attention. A whole-run successful timestamp requires every selected company to be validated. The existing API may save an archive even if reporting validation fails; the app preserves that distinction.

Recent results survive restart. **Export diagnostic log** saves bounded, sanitized events and pending-upload counts for administrator investigation. It omits tokens, raw exceptions, record payloads and local filesystem paths. It can include company names and GUIDs. Agent JSONL logs are also retained locally according to the existing 30-day retention policy; preview data is not generated by the desktop workflow.

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

`build:test` creates `release/Helior-Finance-Sync-TEST-Setup.exe` with dummy credentials. The test installer permits connection checks but disables captures/uploads, and uses a separate `test-state` directory. It is not a customer release. The smoke harness uses synthetic companies and the actual renderer/preload/worker in a hidden window; it never contacts production. Screenshots are saved under `test-artifacts`. Test fixtures and developer scripts are excluded from the installed application.

For the complete agent and desktop suite, from repository root:

```powershell
node --test deploy/tally-agent/test/*.test.js desktop/finance-sync/test/*.test.js
```

Before distribution, validate the configured installer on actual target Windows/Tally machines: initial installation/shortcuts, Tally closed, no company loaded, login/permission restrictions, company disappearing, large capture, interrupted upload, restart, repeat sync, reporting rejection, and upgrade with a pending batch. Synthetic tests do not establish real Tally compatibility or production reconciliation.
