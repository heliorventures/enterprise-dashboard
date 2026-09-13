# TallyPrime sender for Windows

`tally-008` corrects source parsing for confirmed Tally U+0004/U+0005 controls (numeric references and literal characters), preserving their decoded values in JSON. It uses a narrow adapter over the pinned saxes 6 parser; it does not globally disable XML validation or convert all exports to XML 1.1. Escaped text, CDATA references, Unicode text, and control markers retain their values. Source diagnostics show `tallyControlCharacters` parser counters. Existing source API/schema version 1 already stores these values; no new migration is needed beyond 004.

`tally-007` adds detailed export logging to the same dry-run command: request/response events, progress every 10 seconds, underlying network/parser codes, XML path/line/column, offending numeric character references when available, received byte/record counters and a final failed-collection summary. It does not alter source values or automatically repair malformed XML. Send the `tally_export_failed` events to diagnose failed captures; raw accounting values and response bodies are not printed.

## Source import is the default from tally-006

`Run-Sync.cmd` now captures company source data into PostgreSQL JSONB through the separate source archive protocol. It does not call the dashboard ledger/voucher converters, change amounts/dates, reject empty balances, exclude cancelled/optional vouchers, or update the old dashboard tables. Use `--dry-run` to capture JSON locally without contacting the API. See [source archive setup, storage and coverage](../docs/tally-source-archive.md).

Deploy the new API/UI release and migration `004_tally_source_archive.sql` before live source uploads. Preserve server `config.json`, `token.txt`, and all of `state` when replacing the full program bundle. Set `"importMode": "source"` in the existing config (also the default when absent). Source previews use `state/source-preview`; source retry batches use `state/source-outbox`. Old `state/outbox` dashboard batches are preserved but are not replayed in source mode.

The earlier dashboard sender is available only with `"importMode": "dashboard"`. The instructions and accounting conversions below describe that legacy mode, not the default source importer.

## Legacy dashboard import

To exercise the deployed API without Tally access, use the [two-version synthetic fixture test](fixtures/README.md).

Runs once, discovers all companies exposed by Tally's XML collection interface, uploads each company separately, writes a JSON-lines log, and exits. You create the Task Scheduler job. Nothing registers a task, service, or Docker container on the Tally server.

The `tally-004` bundle corrects collection parsing: response-header counters are not company records, and typed XML leaves retain their text. Matching record NAME attributes and NAME elements resolve to one string; conflicting identities still fail. Each ledger/voucher export already supplies the discovered name as `SVCURRENTCOMPANY`, so manually entering names is not required for this correction. Actual company records without a valid name or GUID still stop the run; they are not silently skipped. Validate against your server with `Run-Sync.cmd --dry-run` before uploads.

The `tally-005` bundle also maps an explicitly empty ledger `CLOSINGBALANCE` to `0.00`, following [Tally's empty Amount convention](https://help.tallysolutions.com/article/DeveloperReference/faq/7661.html). An absent field, repeated values, malformed amounts, currency decoration and unsupported precision remain errors. This rule is specific to ledger closing balances; general amount parsing and voucher handling remain strict.

## Deploy the API first

Build and deploy a NEW release containing migration `003_tally_uploads.sql`, the API changes and the UI Caddy route changes. Existing finance-001 images do not contain staged ingestion. From the repository:

```powershell
.\deploy\scripts\build-save-upload-images.ps1 -Tag finance-002 -DeployAfterUpload
```

Use another unused tag if finance-002 already exists. No changes to the shared HRMS/RMS Caddy blocks are needed for these paths.

## Portable Windows package

Build on your local development machine, not the Tally server:

```powershell
.\deploy\scripts\bundle-tally-agent.ps1 -Tag tally-001
```

The output is `deploy/bundles/tally-001/FinanceTallyAgent-tally-001-win-x64.zip`. The bundler downloads the pinned Windows x64 runtime from Node.js, verifies its SHA-256 against the official HTTPS checksum manifest, installs only locked production dependencies, and validates runtime loading. An explicit file allowlist excludes real credentials, fixture tools and runtime state. Use a new bundle tag for subsequent builds; `bundle-info.json` records the runtime version and checksum.

On the server, use File Explorer and Notepad only:

1. Extract the ZIP to `C:\FinanceTallyAgent`.
2. Edit `config.json`: set `tallyUrl` (default `http://localhost:9000`) and confirm `apiUrl`.
3. Paste only the existing **TALLY_INGEST_TOKEN** value into the included empty `token.txt`.
4. Add the Task Scheduler action below. No install commands, PowerShell execution-policy changes, or PATH changes are needed.

| Task Scheduler setting | Value |
| --- | --- |
| Program/script | `C:\FinanceTallyAgent\Run-Sync.cmd` |
| Arguments | Leave empty |
| Start in | `C:\FinanceTallyAgent` |
| Trigger | Every 15 minutes indefinitely |
| If already running | Do not start a new instance |

Use Task Scheduler's **Run** button for the initial run and inspect `state\logs`. For a dry run, set the action's arguments to `--dry-run`, inspect the preview data, then remove that argument before normal uploads. The included `START-HERE.txt` also gives a direct `runtime\node.exe` entry point if your task policy requires an executable.

The package includes its own Node.js runtime; the server needs no Node.js/npm installation. Windows must support the bundled runtime and permit executable execution. TallyPrime must be running with its private HTTP/XML interface enabled and companies accessible in that session. The task account needs folder write access and network access to Tally and the API.

Protect `token.txt`, logs and outbox using Windows folder Security permissions for only the task account and administrators. This token is not the dashboard password. The bundle deliberately contains no real token. Keep `config.json`, `token.txt` and the entire `state` folder when updating: stop/disable the old task first and replace only program files, dependencies and runtime, then re-enable it.

The launcher uses a Windows named-pipe lock tied to the resolved state directory. A concurrent invocation exits 2 and logs the overlap; Windows releases the lock on process exit. Exit 0 means success; exit 1 means failure. Source checkouts can still use `run-sync.ps1`, which calls the same launcher and prefers the bundled runtime if available. Use the same state directory for all scheduled invocations of this installation.

## Optional configurable Tally startup

`config.json` includes an opt-in `startup` section. Set `enabled: true` and provide your installation's `executablePath`, `arguments` array and optional `workingDirectory`. There is no built-in Tally executable path or company credential. The wait settings (`timeoutMs`, `pollIntervalMs`, `probeTimeoutMs`), `minimumCompanies`, and `requiredCompanies` names are configurable. Required names are readiness checks; the sender still imports **all available companies**. Leave the required list empty if any discovered company is sufficient.

The sender first retries pending uploads as before, then checks XML company readiness. If not ready, the Windows helper checks for a process at the configured executable path and starts it only when absent. It neither kills nor restarts existing Tally instances. A same-name process whose path cannot be verified fails safely. Only loopback Tally URLs allow local auto-start; remote hosts must be started on their own machines. Configured arguments are passed as data, not shell code. Startup and readiness results appear in the normal run log. Failed readiness prevents fresh extraction and upload; existing pending batches may already have been delivered.

Fill both `startup.login.username` and `startup.login.password` to enable built-in credential entry. These values are stored directly in your local config as requested. The helper passes them over stdin to a Windows UI Automation process; it does not use command-line passwords, the clipboard, or log field values. Keep filesystem access restricted to the task account and administrators. Bundles contain blank credential fields only.

The helper targets the configured executable in the same Windows session, identifies a username Edit and a password Edit, uses writable Value patterns to populate them, and submits once. With one matching pair, selector fields can remain blank. For multiple controls or windows, configure exact `windowTitle`, `usernameAutomationId`, `passwordAutomationId`, and optionally `submitAutomationId` or `submitButtonName`. Without a button selector it sends Enter only after checking foreground-window and password-field focus. Wrong/unsupported/ambiguous controls cause a logged failure; values are never typed into an arbitrary window. After submission, XML readiness still gates fresh synchronization. A rejected login is not resubmitted within that run.

For GUI login set Task Scheduler to **Run only when user is logged on** and keep an unlocked desktop. The task account must have access to Tally's window at the same privilege level; it cannot automate UAC or Windows sign-in. Tally may become visible when built-in login is enabled. The helper does not navigate company-selection or TallyVault screens. Configure [Tally's startup settings](https://help.tallysolutions.com/set-up-tallyprime-auto-login-language-multiple-addresses/) to load your companies. Tally's shared-credential auto-login can reuse a first company login for other companies, but this script makes only one credential submission per run. Actual Tally control accessibility and login compatibility require testing on your installation; no live Tally login has been validated here.

The earlier `startup.loginHelper` remains an optional external-program alternative. Use it OR built-in credentials, not both. The portable package includes the built-in login script and uses Windows PowerShell/.NET already present on the server; no additional Node installation is needed.

## Logs and retries

Each run writes `state\logs\<UTC timestamp>-<runId>.jsonl` and prints the same events. Events include company, batch ID, extracted ledgers/vouchers, excluded optional/cancelled vouchers, source and payload byte counts, chunks acknowledged, retry count, duplicate acknowledgement, duration, errors and final run totals. `company_success` means the API committed the whole company snapshot; acknowledged chunks alone do not mean live records were updated. HTTP errors log the operation and status, never response bodies, tokens, accounting rows or passwords. Default log retention is 30 days. Startup errors before a log can be created are printed to the task's console. Preview files are retained for manual inspection; remove old previews when no longer needed.

Fully extracted batches are saved under `state\outbox\<batchId>` before transmission. Interrupted/failed uploads stay there. The next run sends pending data first using the same batch ID and chunk contents; it skips a new extraction of that company until the next scheduled run. A failed or truncated extraction never receives a ready manifest and cannot be uploaded. Incomplete extraction files are removed on the next live run.

Network errors, HTTP 429 and server errors get up to four attempts per operation with backoff. HTTP 400/401/409/413 requires investigation; the batch remains for the next run. A stale snapshot (409) must not be silently discarded: check whether another sender updated that company before deciding to remove its pending directory and extract again. Inactive API staging expires after seven days; retained local chunks can be resent from the beginning.

## Large data and accounting boundaries

The sender streams XML and writes chunks to disk instead of loading an entire company into memory. It uses at most 500 records or roughly 500 KiB per chunk. The API permits 2,000 rows / 1 MiB per chunk, 10,000 chunks / 512 MiB normalized JSON per company, and 2 GiB aggregate pending staging across 100 batches. The sender stops at 500 MiB of outgoing JSON, before that server limit. Source XML has a 2 GiB limit per collection and a 2 MiB limit per record. These are explicit safety bounds, not unlimited capacity; exceeding one leaves live data unchanged and requires reviewing scale and VPS resources. Provision disk space for the outbox, PostgreSQL staging, WAL and the replacement transaction. Finalization streams chunks into PostgreSQL in one transaction and serializes imports; a large finalization can take longer than one schedule interval. This implementation is a full snapshot per run, not incremental synchronization.

Exports request the complete supported date range (1900-01-01 through 9999-12-31), not only the current financial year. No date-limited snapshot is sent. Unsupported dates, currency-decorated amounts, excessive decimal precision, long fields and malformed XML fail extraction instead of being guessed or truncated. Amounts are decimal strings. Ledger closing balances retain their sign. Vouchers retain a supplied top-level amount; if absent, balanced accounting entries produce a positive single-side total (not the zero sum of debit and credit). Optional and cancelled vouchers are excluded. Validate these conventions for your voucher types, multicurrency setup and custom TDL before enabling uploads.

Stable company GUIDs are mandatory. Empty ledger or voucher arrays are blocked by default to prevent an accidental empty dump. After inspecting dry runs, set `allowEmptyCompanies: true` only if empty snapshots are intentional. Each dump is a full extract; dashboard promote applies only inserts, updates, and removals. Manual vouchers and projects remain intact.

Company change markers are compared before and after extraction when Tally exposes them. Separate XML exports are **not** a transactionally consistent Tally backup. Logs report whether markers were available; use a quiet accounting period for reconciliation, particularly where these methods are unavailable. Real TallyPrime/server compatibility and large-volume throughput still require validation on your installation.

Protocol reference: [Tally XML examples](https://help.tallysolutions.com/sample-xml/) and [application ingestion contract](../docs/tally-ingestion.md).
