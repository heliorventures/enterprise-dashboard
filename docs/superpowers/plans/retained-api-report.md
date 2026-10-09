# Retained API verification

Owned files: `api/src/intelligence/routes.js`, `api/src/intelligence/reports.js`, `api/test/intelligenceRoutes.test.js`.

Retained quality, audit, account detail, exception reads/decisions and CSV endpoints use the existing session guard. Static routes precede import identities. Query/body validation rejects unsupported fields, repeated scalar filters, malformed UUIDs, invalid paging/status/amounts and oversized text before database/service work. Unexpected failures return generic JSON without database internals. The separate Intel migration export was removed; root owns the canonical runner integration.

CSV fetches up to 10,001 rows to enforce a 10,000-row ceiling with explicit 413 rather than silent truncation. Outstanding exports verify returned length equals total and reject incomplete reports with 409. CSV escapes headers and formula-like string cells, quotes commas/quotes/newlines, and preserves exact PostgreSQL decimal strings in known financial columns without converting them to floating point. Negative-looking account names/notes remain escaped.

Resume findings corrected:

- Multer previously failed before the route wrapper, returning 500 for malformed multipart. Upload parsing now runs inside the wrapper and returns safe 400 JSON (413 for the 80 MB limit).
- Missing/all company upload choices reached the import service before validation. Upload now requires an explicit positive Tally company identity before database/storage work.
- Omitted mapping target was implicitly treated as an ignore. Mapping requests now require a nonblank source header and explicit target text or null for deliberate ignore.
- Numeric strings were escaped as text, making negative financial values unusable. The serializer now preserves exact decimal strings only in known numeric fields.

Focused command: `rtk proxy node test/intelligenceRoutes.test.js` from `api` (direct node avoids Windows test-worker spawn permission issues).

Final focused evidence: 12 tests passed, 0 failed; direct node process exited 0. The real-service HTTP test uses a stubbed `db.query` and verifies current financial views, resolved company identity, scoped status/search, and a bound 10,001-row limit for outstanding/reconciliation/exceptions. It first exposed historical dashboard reads, then passed after the backend owner aligned the service. Source review additionally found an outstanding-status SQL placeholder missing its dollar marker; the backend owner corrected it, and the regression now explicitly verifies the marker. Earlier red-green runs reproduced and cleared all route findings above. Targeted `rtk git diff --check` exited 0.

No builds, commits, deployments or live database writes. HTTP tests exercise real Express authentication and route handling with database/service stubs; they do not prove PostgreSQL migration execution, production startup or browser acceptance.
# Final integration follow-up

Root subsequently changed exception lists to the counted paging envelope, aligned every shared Pager size with the 500-row API/service limit, and verified the actual sync service reaches records 501 through 1,000. SQL-contract tests isolate readSnapshot callbacks; real snapshot behavior is covered separately by PostgreSQL tests. Final affected retained API suite passed 15/15; this supersedes the earlier 12-test checkpoint below.

