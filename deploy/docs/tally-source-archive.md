# Tally source archive (profile company-business-v1)

## Export diagnostics (tally-007)

Run the usual `Run-Sync.cmd --dry-run`. No diagnostic command or config flag is needed. `state/logs` contains `tally_export_started`, `tally_export_response`, 10-second `tally_export_progress`, and `tally_export_finished`/`tally_export_failed`. A request ID joins these events. Failures include the company/collection, phase, stage, HTTP status, byte/record counters, elapsed time, nested network error codes, XML category/path/line/column and an action hint. Response events show content type/charset and declared content length. Discovery, startup probes and post-capture consistency checks also use this transport logging. The final `failedCollections` list summarizes collection failures.

For example, `XML_INVALID_CHARACTER_REFERENCE` identifies a numeric XML reference problem, `XML_TRUNCATED` identifies an unfinished document, and `ECONNREFUSED` indicates the configured endpoint refused a connection. These are diagnostic categories, not automatic data repairs. No source character is stripped or replaced. Source text/attributes and raw network/parser exception messages are not printed, avoiding accidental logging of accounting values, credentials or URL query parameters.

The source import captures first; business interpretation happens later. It keeps source objects in PostgreSQL JSONB without numeric conversion, date validation, balance calculations, field truncation, or exclusion of cancelled/optional vouchers. Current `Companies`, `Ledgers`, `Vouchers` and manual/project data remain untouched. New reports can query this archive or derive reporting tables in later migrations without re-fetching the historical source records.

## Coverage

The fixed version-1 catalog requests Company, Group, Ledger, Voucher Type, Currency, Cost Category, Cost Centre, Stock Group, Stock Category, Stock Item, Unit, Godown and Voucher. Each request sets `SVCURRENTCOMPANY` and the full supported date window (1900-01-01 through 9999-12-31). Company collections are additionally matched to the discovered GUID, because Tally may return multiple loaded companies despite the selected context.

Requests use `Fetch: *` for exposed methods and subcollections, as documented in [Tally's object/collection reference](https://help.tallysolutions.com/objects-and-collections/). This retains bill references, bank entries, cost allocations, inventory/batch allocations, tax details and UDF fields that actually appear in the responses. It does not guarantee that every method/customization is exposed by every installation; no Tally installation was available for complete profile acceptance. Unsupported exports appear as failed coverage, not successful empty collections. Dedicated payroll masters are not requested; shared voucher exports are unfiltered and may contain payroll-related transactions. This is not a binary Tally backup or a complete recreation of derived Tally reports.

Tally warns that broad wildcard fetching can be slower in [its fetch guidance](https://help.tallysolutions.com/how-to-choose-the-right-approach-from-tdl/). Measure real capture times and storage before selecting a repeat interval.

## Storage

Migration `004_tally_source_archive.sql` adds:

| Object | Purpose |
| --- | --- |
| `tally_source_snapshots` | Company GUID/name, capture time, profile/version, coverage and manifest for every archived capture |
| `tally_source_records` | One JSONB source object per collection/ordinal, with an optional indexed GUID/master ID |
| `tally_source_latest` | Latest complete capture for each company/version; partial or older retries do not displace it |
| `tally_source_uploads` | Immutable upload manifest, quota usage, and retry receipt |
| `tally_source_chunks` | Temporary transfer chunks, removed after transactional finalization |

Example source payload (not a converted accounting row):

```json
{
  "tag": "LEDGER",
  "attributes": { "NAME": "Example" },
  "content": [
    { "tag": "CLOSINGBALANCE", "attributes": { "TYPE": "Amount" }, "content": [] },
    { "tag": "UDF:EXAMPLE", "attributes": {}, "content": ["  original text  "] }
  ]
}
```

Ordered `content` arrays retain nested objects, repeated fields, whitespace and decoded text. An empty XML element remains an empty content array; missing fields remain missing. Attribute values and field text stay strings. XML entity spellings, CDATA boundaries, comments and the transport envelope are not reproduced; the archive preserves exported object data, not byte-identical response files. Optional `source_id` is only an index hint; the payload remains authoritative and is retained even when that hint is absent.

No source history purge is automatic. Full capture history can grow quickly; monitor database, backups and sender disk. Do not delete staging/outbox data as a routine fix for failed uploads.

## Transfer and completeness

The authenticated endpoints are `POST /api/ingest/tally/source/begin`, `/chunk`, and `/complete`, using the existing `TALLY_INGEST_TOKEN`. The source namespace prevents an old API from silently discarding source fields. Authentication runs before JSON parsing; no source read endpoint is exposed publicly.

The manifest has schemaVersion `1`, profile `company-business-v1`, batch ID, timezone-qualified capture timestamp, company identity, chunk/record totals, every catalog collection's `success`/`failed` status and count, and consistency (`stable`, `unavailable`, `changed`). These are transport metadata, not validation of the exported accounting values. A completed empty collection is distinct from a failed collection. Failed collection prefixes are not published as complete data. Successful collections in a partial capture are archived for later inspection.

Structural checks enforce authentication, JSON/XML framing, routing identity, resource limits, immutable retries, sequential record ordinals and complete delivery. They do not interpret the business fields. SQL transactions commit the snapshot, its records and the receipt together. Per-chunk hashes survive completion, so changed retries are rejected even after staging payloads have been removed. Canonical hashing tolerates PostgreSQL JSONB object-key ordering.

A complete profile means every catalog request finished and no change was detected. It does not prove all possible Tally data is exposed. `consistency: unavailable` means Tally did not expose change markers; even `stable` is not a transactionally consistent Tally backup. A changed or failed capture is stored as `partial`, returns a nonzero agent exit code, and cannot become the latest complete snapshot.

Limits: 64 XML nesting levels, 2 MiB estimated source object size, 2 GiB XML per collection, 500 MiB sender capture/transfer per company, 3 MiB sender chunk target, 4 MiB API records per chunk, 500 records per chunk, 10,000 chunks, 5,000,000 records per collection, 512 MiB server staging per company and 2 GiB aggregate source staging over at most 100 incomplete batches. Oversize exports fail visibly rather than truncate data. Original dashboard staging has separate quotas. Incomplete source staging expires after seven idle days; local complete batches retain their IDs and can resend all chunks. Completed archive history remains.

## Deployment and server steps

1. Build/deploy a new matching API and UI release from this checkout. Use an unused release tag:

   ```powershell
   .\deploy\scripts\build-save-upload-images.ps1 -Tag finance-source-001 -DeployAfterUpload
   ```

   This builds, uploads, runs migrations and deploys. It has not been run as part of local implementation. New deployment smoke checks assert migration 004 and source endpoints. `finance-002` does not support source imports.

2. Copy/extract `tally-006` on the Windows Tally server. Replace the complete program bundle, not only `tally.js`. Preserve `config.json`, `token.txt`, and the entire `state` directory. Add `"importMode": "source"` to your existing configuration; absence also defaults to source in tally-006.
3. Run `Run-Sync.cmd --dry-run`. Inspect `state/source-preview/<batch>/manifest.json` and numbered JSON chunks. The dry run does not contact the API or check credentials/migrations.
4. After API deployment and coverage inspection, run `Run-Sync.cmd` to upload. Inspect `source_snapshot_saved`, `coverageStatus` and `run_finished`. Failed uploads remain in `state/source-outbox`; the next run retries them before contacting Tally and skips fresh capture for those companies until the following run.
5. Configure the scheduler only after manual acceptance, keeping “Do not start a new instance”. The same startup/login/session requirements still apply. A full source archive can take much longer than a dashboard extraction.

Legacy normalized ingestion is available only via `"importMode": "dashboard"`. Its existing `state/outbox` is preserved but not replayed by source mode. The old standalone `tally.amount()` diagnostic still rejects blank text by design and is not a test of source import. Use the actual dry-run command.

## Database checks and future reporting

Read capture coverage:

```sql
SELECT company_external_id, company_name, captured_at, coverage_status,
       manifest->'collections' AS collections,
       manifest->>'consistency' AS consistency
FROM tally_source_snapshots
ORDER BY captured_at DESC;
```

Read source objects for one company's latest complete capture (bind `$1`):

```sql
SELECT r.collection, r.ordinal, r.source_id, r.payload
FROM tally_source_latest s
JOIN tally_source_records r USING (batch_id)
WHERE s.company_external_id = $1
ORDER BY r.collection, r.ordinal;
```

Future reporting transformations must explicitly interpret amounts, units, currencies, debit/credit signs, dates, tax structures and company identity, and reconcile against Tally. This release provides the retained source data and coverage needed for that work; it does not add report projections or alter current dashboard values.
