# Validation — 2026-09-10

## Passed

- API tests: 5 passed, 0 skipped with disposable PostgreSQL 16. Coverage includes repeated migrations, empty initial data, query filtering/date/decimal results, authenticated HTTP validation, idempotent imports, stale/conflicting import rejection and transaction rollback after an injected database failure.
- Angular: clean `npm ci`, production build (302.89 kB initial bundle), and all 3 existing unit tests passed. Repaired missing lockfile entries and the existing application test's missing router provider.
- PowerShell parser and Compose configuration validation passed.
- Release orchestration tests passed in Windows/Git Bash and in a disposable Linux container. Docker/HTTP commands are simulated; Linux uses real symlink/move/locking utilities. Covers initial deployment, archive, rerun, failed-deploy recovery, rollback, resume after rollback without older migrations, and checksum rejection.
- API production image starts against PostgreSQL with a read-only filesystem. Read-only smoke checks passed for health, companies, dashboard, ledgers, vouchers and unauthenticated ingestion rejection.
- Database provisioning passed against the disposable PostgreSQL container: role/database creation, network authentication with the correct password, rejection of an incorrect password, and preservation of credentials on rerun.
- Independent deployment review completed; corrected network password verification and resume-after-rollback migration handling.

## Remaining acceptance

- The UI image compiled, but its Caddy base image failed at runtime with `exec format error`, including when run without this application's code. A copied `/bin/busybox` from that local image was zero bytes. Re-fetching the base image did not repair it; affected local BuildKit records remained in use after Docker Desktop recovery. Full UI-container routing/basic-auth/ingestion checks in `deploy/scripts/test-containers.ps1` are therefore **not passed**. Resolve the local image-store problem or repeat on a healthy Docker engine before release.
- No SSH upload, VPS database creation/migration, shared Caddy change, public HTTPS check or actual VPS deployment was performed. The production domain is confirmed as `finance.heliorsoft.com`; review live DNS, routing, certificate coverage and credentials first. Local templates supply the SSH defaults only.
- Real Tally sender delivery, accounting reconciliation, signed-in browser acceptance and database backup/restore acceptance remain outstanding. The sender service is not implemented by this repository.

The Docker Desktop restart was explicitly approved. No HRMS/RMS project files were edited, no global image/volume/cache pruning was performed, and no Git commits were created.
