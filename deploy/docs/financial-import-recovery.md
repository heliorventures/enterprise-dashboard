# Financial import validation and recovery

The subsequent database, sync and UI reporting phase is documented in [Source reporting models](source-reporting-models.md). This file records the initial export/validation correction; the newer document describes the expanded collection coverage and release requirements.

## Implemented safeguards

- The source agent retains broad voucher fetch coverage alongside explicit amount and ledger-entry methods. Ledger requests explicitly fetch opening and closing balances. Explicit method fetching follows [Tally's collection guidance](https://help.tallysolutions.com/how-to-write-remote-compliant-tdl-reports-in-tdl/).
- Export is a source capture, not financial validation. Missing, empty and unsupported business values are preserved as returned. Only XML/collection, transport, identity, consistency and integrity failures affect capture completion. Financial checks belong to the separate sync job.
- Reporting promotion accepts complete snapshots only. Missing voucher amounts are rejected instead of becoming zero; opening balances cannot substitute for missing closing balances.
- Any rejected or duplicate ledger record, invalid voucher or projection error blocks the entire promotion before reporting writes. Legitimate cancelled/optional exclusions do not block promotion. Existing applied batches are also revalidated before being reported as already applied.
- Force reprocessing remains available after validation. It uses the ingestion transaction and lock, retains the existing ingestion marker, and refuses to replay older data over newer imports. It no longer deletes a marker before starting the import transaction.
- Archive completion commits the source first, then automatically triggers sync for complete captures. Archive `ok` and `coverageStatus` remain independent of the downstream `reportingStatus` (validated/error/blocked). Sync failure never undoes an acknowledged archive. Retries recheck sync.
- The agent counts complete, acknowledged archives as successful independently of sync and logs its separate reporting status. Operations / Sync Tally and the existing API/CLI can retry validation and reporting updates.
- The default `source` agent mode follows this flow. The explicit legacy `dashboard` mode and its direct normalized ingestion endpoints remain for compatibility and bypass raw archiving; use `source` mode for this architecture.

## Release and recovery sequence

1. Review and release the API and updated Tally agent together. There is no schema migration. Historical status records and previously imported balances are not rewritten by this code change.
2. When the remote Tally server is available, deploy the agent and run its existing dry-run mode with a new capture. This session does not require remote access. Do not force-reprocess old archives to repair absent fields.
3. Check collection diagnostics and a fresh sample for closing balances, voucher amounts and accounting entries. If Tally omits them, investigate the installed version/customizations and response before proceeding. Local mocked tests do not prove the deployed Tally response.
4. Reconcile the sample with the Tally Trial Balance and vouchers at the same accounting cutoff, including debit/credit direction and source coverage.
5. Review the prospective insert/update/remove counts and then authorize production import of a fresh complete snapshot. Verify company totals, source counts and reporting status afterward.

The current source date range and financial classifications have not been redesigned here. Group/voucher-type master normalization, signed posting models, currency context, cost allocation tables and invoice ageing remain separate reporting work. No unsupported calculations or budgets were invented.

## Verification

The stage-separation follow-up is covered by mocked missing-field exports and HTTP tests proving archive success is independent of automatic sync failure.

- Full agent regression suite: 31 passed. Updated delivery-status assertions subsequently passed in the seven-test source suite.
- API importer, sync, archive and HTTP checks: 10 passed; four PostgreSQL integration tests skipped. Database name/port were overridden to disable access to the live database during tests.
- A subsequent HTTP test verifies complete/partial archives, failed promotion and duplicate retries return distinct reporting statuses; both HTTP tests passed.
- Tests include genuine zero values, missing fields, invalid applied archives causing no writes, error precedence over duplicate/success status, and force replay protection against newer data.
- Live Tally dry run, disposable PostgreSQL integration tests, deployment and production reconciliation remain pending. No production records were changed and no commit was created.
