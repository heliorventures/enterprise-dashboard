# Approved Tally sender and staged ingestion

Build a one-run Windows sender under deploy/tally-agent. Discover all companies exposed by TallyPrime XML on configurable localhost:9000. Stream records to a durable local outbox; preserve decimals and company GUIDs; reject malformed/incomplete exports. Upload bounded chunks with repeatable batch identities. Log company counts, bytes, timing and results without tokens or payloads. Provide a PowerShell runner with an OS-held lock, no scheduler registration.

API: retain the existing endpoint. Add authenticated begin/chunk/complete operations, immutable manifests, content hashes, bounded staging quotas and transactional finalization. Stream stored chunks into live tables inside one transaction; incomplete/conflicting batches cannot replace live data. Completed receipts make retries safe. Add migration without modifying applied migrations, and route new machine endpoints through UI Caddy.

Validation: protocol unit tests, HTTP authentication tests, disposable PostgreSQL tests for partial upload, retry, conflict and rollback; sender XML fixtures, chunk sizing and delivery retry tests. Actual TallyPrime reconciliation requires server access and representative exports. Release both API and UI before using the agent.
