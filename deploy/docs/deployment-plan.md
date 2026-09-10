# PostgreSQL and VPS deployment

Approved direction: start with an empty PostgreSQL database in the existing VPS PostgreSQL container. Keep Angular and Express, deploy versioned images using PowerShell, SCP and Docker Compose, and retain previous releases. No commits or production writes during implementation.

## Design

The existing Caddy routes `finance.heliorsoft.com` to enterprise-dashboard-ui on the existing apps_app-network. The UI container serves Angular, authenticates requests with Caddy basic authentication, and proxies /api to a private API network. The API also joins the existing network to access PostgreSQL. Neither application container publishes a host port. User clarification: a separate service on the Tally server pushes snapshots to a bearer-token-authenticated endpoint; no VPS-to-Tally connection is needed.

The application owns a separate database and role. Versioned, checksummed SQL migrations run explicitly before startup. Queries use PostgreSQL parameters, exact NUMERIC storage and DATE values. Startup never seeds data. Each company Tally snapshot is committed atomically under a transaction lock; failed imports report failure and preserve the previous snapshot. Sender batch IDs are idempotent; older snapshots and conflicting retries are rejected. Payloads are complete snapshots, limited to 20 MB and 50,000 rows per collection. Sender implementation is separate from the receiving API.

The release directory contains both image tarballs, checksums, Compose and deployment helpers. Uploads use a unique staging directory. A server lock serializes releases. The deploy helper checks inputs, loads images, runs migrations, starts only this Compose project and verifies health/authentication. Only successful releases become current; the prior release moves to archive. Rollback restores previous application images; schema changes must remain backward compatible. Secrets remain in shared server files outside archives. Existing HRMS/RMS Compose, Caddy and database files are not overwritten.

## Implementation and verification

- [x] Add PostgreSQL schema, migration runner and pooled queries; test empty startup, repeat migrations, search/date/pagination and financial totals against PostgreSQL.
- [x] Convert Tally writes; test failure rollback and repeated synchronization with a synthetic Tally source.
- [ ] Finish UI-container runtime acceptance. API/UI files and builds are implemented; API runtime passed. The local Caddy base image has empty executables. See validation.md.
- [x] Add versioned build/upload/deploy/resume/rollback commands; syntax-check scripts and test release state transitions.
- [x] Document business scope, setup, security limits, commands and remaining live acceptance inputs.

The confirmed domain is `finance.heliorsoft.com`. Live deployment still requires verification of DNS, the SSH target, database/network details and credentials. Sender-to-API delivery requires separate acceptance; no VPS-to-Tally connection is needed. Existing local HRMS references use postgres:16-alpine, container postgres and apps_app-network; these are template observations, not live VPS verification.
