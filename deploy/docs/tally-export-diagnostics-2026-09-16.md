# Tally export readiness and diagnostics

## Behavior

The source exporter explicitly requests company base currency and accounting dates, ledger bill opening allocations, and voucher bill references, types, amounts and credit periods. Raw source trees remain unchanged. Bill details improve the archived data available for ageing; they do not introduce a new ageing report or assume due dates when Tally omits them.

Streaming financial checks record missing closing balances, missing voucher amounts/postings, invalid dates/GUIDs, unsupported amounts and unbalanced postings. Explicit empty amounts remain zero where applicable; missing fields are not replaced with zero. Checks retain total error counts and the first 20 source locations per collection. The API still performs authoritative financial validation and publishes atomically.

Full captures also compare opening balances plus signed voucher movements against closing balances, with bounded memory (100000 ledger identities). Differences are advisory warnings requiring accounting review. Partial data, missing amount inputs, incomplete posting coverage, or a period capture against full ledger balances produce an explicit unavailable reconciliation warning. No financial values are manufactured and no report capability is removed.

Each manifest records exporter version, a hash of its source files, contract identity, per-collection readiness, and requested date context. Derived cumulative snapshots distinguish the latest capture's date context from cumulative historical coverage; incoming voucher readiness is not misrepresented as validation of the merged history.

## Finding a failure

Operations now has **Export failures and diagnostics**, filtered by company and optionally batch. It shows failures that happened before a source archive existed as well as collection and upload failures. Export history links to a batch's diagnostics.

Database table: `tally_diagnostics`. Authenticated UI endpoint: `GET /api/tally/diagnostics`. Sender endpoint: `POST /api/ingest/tally/diagnostics` using the existing ingestion token.

Saved evidence includes, where available:

- Run, batch and request IDs; exporter version/build hash.
- Company, collection, failure stage, requested date window and request hash.
- HTTP status, response encoding, bytes and records received/processed.
- XML path, line, column and invalid numeric character reference.
- Tally's own bounded server error text, nested transport error codes and suggested action.
- API operation, chunk index, SQL state/constraint/table and stack locations for publication/storage errors.

No request bodies, raw accounting responses, SQL parameters or PostgreSQL row DETAIL values are placed in diagnostic logs. Credential patterns are redacted in sender and API. Diagnostics are restricted by existing sender/session authentication; treat them as internal operational information.

Example investigation query (read only):

```sql
SELECT occurred_at, company_name, collection, event, message,
       batch_id, run_id, details, exporter
FROM tally_diagnostics
ORDER BY received_at DESC, id DESC
LIMIT 50;
```

## Offline and retry behavior

Errors are durably written with fsync into the agent's `state/diagnostics-outbox` before delivery. Failure IDs are stable across retries. The API acknowledges only committed rows, accepts identical retries, and rejects conflicting reuse of an ID.

The queue flushes on connection checks, before a live run, between companies and at run completion. It does not rerun the Tally export to obtain error details. Each flush has a ten-second maximum network budget and at most 25 events. An unavailable API leaves the events pending. Permanent payload rejections are isolated into `diagnostics-outbox/rejected`, preserving the original file while allowing other events through. Local corruption is also retained there. Transport failures during cancellation remain queued if the desktop worker is force-stopped before delivery.

An entirely offline API cannot receive diagnostics until the next connection. Disk/OS failure before a local write and forced process termination cannot guarantee a saved error. A database outage can also prevent the API from writing its own diagnostic; server logs and the sender's retained transport error are the fallback. These cases do not justify another accounting export merely to resend diagnostics.

## Rollout

1. Deploy the API migration `014_tally_diagnostics.sql` using the existing migration command before starting the updated API/UI.
2. Deploy the updated API and UI together.
3. Build and distribute the updated desktop installer or portable sender using existing release scripts. Both packaging allowlists include the new modules. Preserve configuration, credentials and all state/outboxes on upgrade.
4. Perform a manual connection check and inspect Operations diagnostics if it fails. Then capture when client Tally is available and independently reconcile real balances/transactions.

This code change does not deploy the services, upgrade the client installation, re-export accounting data, delete old data or modify existing reports. Earlier archives cannot acquire amounts or original error reasons that were never saved.

## Local verification

- Final isolated PostgreSQL/API run: 27 passed, zero skipped. An earlier repeat encountered leftover synthetic fixture counts; the final run used a fresh test schema.
- Sender/desktop suite: 76 passed; final targeted changes and packaged-module/shutdown checks: 14 passed.
- Angular: 58 tests passed; production build passed. No authenticated browser acceptance or real client Tally capture was performed.
- Sender/desktop regression tests, including offline retention, duplicate acknowledgement, cancellation, invalid-event isolation and shutdown ordering.
- Isolated PostgreSQL migration/HTTP tests: authenticated diagnostics, failures before snapshots, exact Tally error retention, idempotent persistence, conflict handling, source archive and period merge behavior.
- Angular tests and production build for the diagnostics view and existing report interactions.
- Client Tally method availability and real accounting reconciliation still require a future client capture; synthetic responses do not establish that acceptance.
