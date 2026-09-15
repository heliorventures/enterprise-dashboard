# Finance Sync release testing

Run from the repository root on Windows after building the installer from the current source:

```powershell
powershell -NoProfile -File .\desktop\finance-sync\scripts\release-test.ps1
```

Override the PostgreSQL executable directory or synthetic voucher volume when needed:

```powershell
powershell -NoProfile -File .\desktop\finance-sync\scripts\release-test.ps1 -PgBin 'C:\Program Files\PostgreSQL\17\bin' -Vouchers 10000
```

Prerequisites: installed Node matching the package engine requirements, restored desktop/agent/API dependencies, PostgreSQL binaries, OpenSSL (Git for Windows supplies it), and a current Windows x64 installer plus `release/win-unpacked`. OpenSSL is needed only on the developer/test machine, not by installed Finance Sync users. The runner searches PATH and Git for Windows locations; pass `-OpenSslBin 'C:\path\openssl.exe'` to override. The runner does not build the installer, install, publish, upgrade, or contact production. Run it in an ordinary user session that can launch Electron. No administrator rights should be necessary.

## Automated evidence

Every invocation creates a new ignored directory under `desktop/finance-sync/test-artifacts/release-<timestamp>-<random>/`. It initializes its own PostgreSQL cluster and synthetic database, binds PostgreSQL only to `127.0.0.1` on a discovered free port, and stops that cluster in `finally`. A port collision fails safely; rerun to allocate another port. It never adopts an existing cluster, starts a Windows PostgreSQL service, or deletes a database directory. Local trust authentication applies only to this temporary synthetic cluster; run on a trusted development/test machine.

Children receive an explicit environment allowlist and synthetic credentials, excluding inherited database passwords, PostgreSQL service settings, Node startup hooks, API credentials and URLs. API tests run with the evidence folder as their working directory so the API's default dotenv loader does not read the checkout's `.env`. The end-to-end harness must likewise launch the API with its isolated working directory. No production `.env` is needed.

Each run creates a new two-day self-signed certificate and private key for the loopback HTTPS API, with `127.0.0.1` and `localhost` subject alternative names. The certificate is trusted only by test child processes through `NODE_EXTRA_CA_CERTS`. TLS verification stays enabled and the Windows trust store is unchanged. This exercises the production HTTPS requirement without weakening the application. The generated key is synthetic test infrastructure material in the ignored evidence directory; never reuse it for a deployed service.

The runner executes these gates with bounded process timeouts and records exit codes, elapsed time and logs:

1. Verify the packaged archive against current UI/shared agent source and validate packaging exclusions, release configuration, icon and executable architecture. Read the exact-version NSIS installer's embedded x64 payload using the bundled 7-Zip executable, extract only its application archive/executable into the evidence directory, and require their SHA-256 values to match the unpacked files exercised by the tests. This reads archive contents without running the installer.
2. Initialize, start and create the isolated database.
3. Run shared agent and desktop tests together with TAP output.
4. Record the complete API test-file manifest (currently 15 files), reject an empty inventory, and run every file sequentially, including opt-in PostgreSQL and read-only SQL fixture tests. Each file gets a fresh `enterprise_dashboard_test` database in this run's isolated cluster, preventing one file's fixtures from contaminating another. Before each drop/create, a loopback connection verifies `SHOW data_directory` equals this run's exact `pgdata` path; a mismatch fails before any reset. Each identity check, reset and test file has a separate report stage and log.
5. Run the focused dashboard specification with a JSON test report and build the production Angular dashboard.
6. Run the existing packaged Electron smoke flow.
7. Run packaged Electron through the actual local API and PostgreSQL with simulated Tally. The E2E report records its detailed accounting, period, retry, isolation and stress checks; inspect that report for the exact exercised scenarios.
8. Recompute Git HEAD/status, tracked diff digest, untracked source hashes and installer/archive/executable hashes. Any change since the beginning invalidates the run; keep source and release artifacts unchanged throughout testing.
9. Stop PostgreSQL, including after a failed gate.

`summary.json` and `summary.md` identify every attempted stage, test skips/todos, exact-version installer/archive/executable SHA-256 values, Git HEAD, dirty state, tracked source diff digest and untracked file hashes. Raw tracked diffs are hashed in memory and are not written to evidence logs. `e2e-report.json` must satisfy the explicit required-scenario contract: missing, duplicate, unknown, failed or incomplete scenarios invalidate it. Summaries also include observed resource peaks from the sampled Electron processes. Per-stage `.log` files support diagnosis. A failed stage stops subsequent gates; their absence is not a pass. Any failure or skipped/todo test makes the automated result incomplete/nonzero. The runner never labels the release approved: manual installation, upgrade and real Tally gates remain pending even when synthetic tests pass.

Keep the complete evidence folder with the reviewed installer and source identity. Dirty builds require review of the local diff and untracked source against the recorded hashes; a Git HEAD alone does not identify them. Installer hashing and payload comparison identify the artifact and prove its application contents match the exercised package; they do not establish that NSIS installation or upgrading works. After changing source, rebuild and rerun. Do not substitute an older installer bearing the same version number.

If the runner is forcibly terminated or the host loses power, normal `finally` cleanup cannot run. Inspect `summary.json` or the printed evidence path and stop only that exact cluster:

```powershell
& 'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe' -D 'ABSOLUTE-RECORDED-RELEASE-DIRECTORY\pgdata' -m fast -w -t 45 stop
```

Do not point this command at a normal PostgreSQL data directory. Retain the stopped cluster until diagnosis is complete; no recursive cleanup is part of the runner.

## Windows installation and upgrade acceptance

Use a disposable Windows VM or designated test account. Record Windows edition/build, CPU, RAM, installer filename/version/SHA-256, source identity, test date and tester. Take a VM snapshot and back up test application data before upgrade tests. Use only an explicitly authorized test API destination and synthetic token for installation testing.

- [ ] Clean installation as a standard user completes without unexpected elevation, missing-file or security errors. Record SmartScreen/signature behavior without bypassing organizational policy.
- [ ] Start from the installed shortcut and confirm the visible version, window title, icon, initial idle state and readable controls. Check application files originate from the installed location.
- [ ] Check company discovery, company selection, date selection, sync, progress, history and Stop from the installed app. Confirm keyboard focus, readable scaling at 100%/150%, and usable controls on the smallest supported display.
- [ ] Close/relaunch and verify no unintended automatic synchronization, duplicate process or abandoned worker remains.
- [ ] Install the previous supported version, generate known test history/settings, close it, then run the new installer. Verify upgrade retains intended settings/history and still connects using the intended configuration. Record behavior when upgrading with the app running.
- [ ] Confirm the installed new version starts and completes a test sync after upgrade; check shortcuts and uninstall registration do not point at the old version.
- [ ] Exercise uninstall on the disposable machine and record the actual retention/removal behavior of application data. Reinstall and verify the documented behavior. Do not assume uninstall deletes credentials or history.

Attach screenshots and installer/runtime logs. Installation acceptance requires an installed executable run; loading `app.asar` through the test Electron runtime is insufficient evidence.

## Real Tally and financial reconciliation acceptance

Use a backed-up Tally test company or a copy of real accounting data with explicit permission. Use a designated test API/database, never an unapproved production destination. Record Tally version, company identifier, financial year, selected companies and period boundaries. Keep real accounting evidence in the approved restricted location, not in Git or a shared public artifact folder.

- [ ] Before syncing, independently export/count Tally vouchers by company, type and date; record ledger counts, debit/credit totals, sales, purchases, receipts, payments and opening/closing balances relevant to the selected period. Record export filters and sign conventions.
- [ ] Run a full sync and compare the API/database/dashboard results with those independently obtained totals. Resolve differences using specific voucher/ledger identifiers, rounding, cancellation, optional vouchers, duplicates and date inclusion rules. Counts or a successful HTTP response alone do not establish financial accuracy.
- [ ] Repeat the identical sync and confirm no duplicate vouchers, no doubled totals and stable records.
- [ ] Add, edit and remove known vouchers within a selected period. Resync that period and verify replacements/deletions, preservation outside the period and preservation of manual dashboard entries. Record exact boundary-date cases and an empty period.
- [ ] Select two distinguishable companies; verify each company's records and totals remain separate and an unselected company's records remain unchanged.
- [ ] Interrupt Tally connectivity and API connectivity separately. Verify clear failure feedback, safe retry, no misleading successful timestamp and no partial snapshot published as complete.
- [ ] Check character encoding with actual non-ASCII ledger/company descriptions and preserve evidence of any rejected source text.

## Responsiveness, resource and Stop acceptance

Choose acceptance thresholds before the run and record them alongside hardware/data size; the synthetic 10,000-voucher run is a baseline, not a capacity guarantee.

| Observation | Idle baseline | Full sync | Period sync | After Stop | After completion |
|---|---|---|---|---|---|
| App + worker CPU (%) | | peak/average | peak/average | | |
| App + worker working set (MB) | | peak | peak | | |
| Tally CPU/working set | | | | | |
| API/PostgreSQL CPU/working set | | | | | |
| UI input response (ms) | | | | | |
| Elapsed duration / voucher count | | | | | |

- [ ] Capture an idle baseline, then Task Manager/Performance Monitor samples at a fixed interval during a representative full sync and a period sync. Record dataset size and total elapsed time.
- [ ] While importing, move the window, navigate permitted controls and check progress rendering. Record response delay and any Windows “Not responding” interval.
- [ ] Press Stop during discovery/download, upload and a slow response where reproducible. Record click time, visible stopped time, worker exit time and any remaining connections/processes. Verify last-success/history do not falsely report completion.
- [ ] Reconcile database state after interruption: committed complete snapshots stay valid; incomplete work must not replace published data. Retry and reconcile totals again.
- [ ] Repeat representative sync/Stop cycles and measure whether memory/process counts settle. Record sustained growth, crashes or abandoned workers as failures requiring investigation.

Release sign-off must link the automated evidence folder, the exact installer hash, installation/upgrade evidence, independent real Tally reconciliations, resource measurements, authenticated dashboard browser acceptance and unresolved exceptions. Synthetic E2E ledger postings and voucher totals are checked against controlled fixtures; independently exported real Tally totals and real dashboard browser behavior still require acceptance. Synthetic API/SQL/Electron success does not close these manual gates.
