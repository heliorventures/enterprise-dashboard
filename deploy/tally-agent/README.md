# TallyPrime sender for Windows

Runs once, discovers all companies exposed by Tally's XML collection interface, uploads each company separately, writes a JSON-lines log, and exits. You create the Task Scheduler job. Nothing registers a task, service, or Docker container on the Tally server.

## Deploy the API first

Build and deploy a NEW release containing migration `003_tally_uploads.sql`, the API changes and the UI Caddy route changes. Existing finance-001 images do not contain staged ingestion. From the repository:

```powershell
.\deploy\scripts\build-save-upload-images.ps1 -Tag finance-002 -DeployAfterUpload
```

Use another unused tag if finance-002 already exists. No changes to the shared HRMS/RMS Caddy blocks are needed for these paths.

## Install on the Windows Tally server

Copy this entire directory, including package-lock.json, to e.g. `C:\FinanceTallyAgent`. Install Node.js 22.12 or newer and make `node` accessible to the Windows account running the task. In PowerShell:

```powershell
Set-Location C:\FinanceTallyAgent
npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund
Copy-Item config.example.json config.json
notepad config.json
notepad token.txt
```

Put only the existing **TALLY_INGEST_TOKEN** from the VPS's `/opt/apps/enterprise-dashboard/shared/api.env` in `token.txt`. This is the sender token, not the dashboard password or database password. Do not create a new unrelated token. Protect this folder using Windows Security permissions: allow only the task account and administrators. `token.txt`, the outbox and previews contain sensitive information; POSIX file modes do not set Windows ACLs. Do not commit or share them.

`config.json` defaults to Tally `http://localhost:9000`, API `https://finance.heliorsoft.com`, and state paths relative to the configuration file. Enable/verify TallyPrime's HTTP/XML server when you have server access. Keep the interface private. Tally must be running with the companies available to that interface under the required user/session. Discovery cannot open unloaded or inaccessible companies.

First inspect a dry run (does not need the token and never calls the ingestion API):

```powershell
.\run-sync.ps1 -DryRun
```

Inspect `state\logs` and the extracted JSON chunks under `state\preview\<batchId>`. Reconcile company names, counts, dates, signs and totals against Tally. Then upload:

```powershell
.\run-sync.ps1
```

Task Scheduler action for every 15 minutes, using your configured service account:

- Program: `powershell.exe`
- Arguments: `-NoProfile -File "C:\FinanceTallyAgent\run-sync.ps1"`
- Start in: `C:\FinanceTallyAgent`

Follow your organization's PowerShell execution/signing policy. Select “Do not start a new instance.” The runner also holds an exclusive OS file handle in the state directory; another run using that directory exits 2 and logs the overlap. Exit 0 means all attempted company operations succeeded; exit 1 means a failure. One company failure does not stop the remaining companies. Configure all tasks for this application to use the same state directory; do not run multiple sender installations for the same company.

## Logs and retries

Each run writes `state\logs\<UTC timestamp>-<runId>.jsonl` and prints the same events. Events include company, batch ID, extracted ledgers/vouchers, excluded optional/cancelled vouchers, source and payload byte counts, chunks acknowledged, retry count, duplicate acknowledgement, duration, errors and final run totals. `company_success` means the API committed the whole company snapshot; acknowledged chunks alone do not mean live records were updated. HTTP errors log the operation and status, never response bodies, tokens, accounting rows or passwords. Default log retention is 30 days. Startup errors before a log can be created are printed to the task's console. Preview files are retained for manual inspection; remove old previews when no longer needed.

Fully extracted batches are saved under `state\outbox\<batchId>` before transmission. Interrupted/failed uploads stay there. The next run sends pending data first using the same batch ID and chunk contents; it skips a new extraction of that company until the next scheduled run. A failed or truncated extraction never receives a ready manifest and cannot be uploaded. Incomplete extraction files are removed on the next live run.

Network errors, HTTP 429 and server errors get up to four attempts per operation with backoff. HTTP 400/401/409/413 requires investigation; the batch remains for the next run. A stale snapshot (409) must not be silently discarded: check whether another sender updated that company before deciding to remove its pending directory and extract again. Inactive API staging expires after seven days; retained local chunks can be resent from the beginning.

## Large data and accounting boundaries

The sender streams XML and writes chunks to disk instead of loading an entire company into memory. It uses at most 500 records or roughly 500 KiB per chunk. The API permits 2,000 rows / 1 MiB per chunk, 10,000 chunks / 512 MiB normalized JSON per company, and 2 GiB aggregate pending staging across 100 batches. The sender stops at 500 MiB of outgoing JSON, before that server limit. Source XML has a 2 GiB limit per collection and a 2 MiB limit per record. These are explicit safety bounds, not unlimited capacity; exceeding one leaves live data unchanged and requires reviewing scale and VPS resources. Provision disk space for the outbox, PostgreSQL staging, WAL and the replacement transaction. Finalization streams chunks into PostgreSQL in one transaction and serializes imports; a large finalization can take longer than one schedule interval. This implementation is a full snapshot per run, not incremental synchronization.

Exports request the complete supported date range (1900-01-01 through 9999-12-31), not only the current financial year. No date-limited snapshot is sent. Unsupported dates, currency-decorated amounts, excessive decimal precision, long fields and malformed XML fail extraction instead of being guessed or truncated. Amounts are decimal strings. Ledger closing balances retain their sign. Vouchers retain a supplied top-level amount; if absent, balanced accounting entries produce a positive single-side total (not the zero sum of debit and credit). Optional and cancelled vouchers are excluded. Validate these conventions for your voucher types, multicurrency setup and custom TDL before enabling uploads.

Stable company GUIDs are mandatory. Empty ledger or voucher arrays are blocked by default to prevent an accidental clear. After inspecting dry runs, set `allowEmptyCompanies: true` only if empty snapshots are intentional; complete snapshots replace imported records. Manual vouchers and projects remain intact.

Company change markers are compared before and after extraction when Tally exposes them. Separate XML exports are **not** a transactionally consistent Tally backup. Logs report whether markers were available; use a quiet accounting period for reconciliation, particularly where these methods are unavailable. Real TallyPrime/server compatibility and large-volume throughput still require validation on your installation.

Protocol reference: [Tally XML examples](https://help.tallysolutions.com/sample-xml/) and [application ingestion contract](../docs/tally-ingestion.md).
