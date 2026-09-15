# Enterprise dashboard deployment

## Application and technology

The Windows Tally sender is under [tally-agent](tally-agent/README.md). It runs once, logs company statistics, resumes pending uploads and supports staged large snapshots. Deploy the API migration and UI routing changes before enabling its scheduled job.

Angular 21 / TypeScript 5.9 provides the dashboard, ledger browser and transaction day book. Express 5 on Node.js 22 serves JSON APIs. PostgreSQL stores companies, ledgers, projects, vouchers and import receipts. Caddy serves the compiled Angular application, protects browser access and proxies API calls.

The business flow is: a service on the Tally server extracts data, POSTs a complete company snapshot to this application, and users view the stored figures. The VPS needs no inbound connection to Tally. The sender service itself is a separate deliverable; the receiving API and contract are included here.

The dashboard shows revenue, expenses, profit, receivables, payables and cash across companies, plus project budget/spend indicators. Ledger and voucher screens support filtering, pagination and CSV export. Current KPI classifications use ledger-group name matching; they are management summaries, not a validated statutory accounting calculation. Project progress is spend divided by budget, not operational completion. There is no project-editing workflow or per-user/company RBAC yet. Browser access uses one administrator password; the separate sender token can import all companies. Production adoption beyond trusted administrators needs identity/authorization design and reconciliation against real Tally figures. Numeric storage and incoming decimal strings are exact; the existing browser/API aggregate display uses JavaScript numbers and is not an arbitrary-precision accounting interface.

## Shared VPS layout

Local HRMS/RMS templates use SSH `deploy@159.198.70.19`, PostgreSQL container `postgres` (16-alpine), shared network `apps_app-network` and Caddy container `caddy`. Scripts default to that SSH target; verify it before running. These values were read from local scripts, not confirmed by accessing the VPS.

Only `/opt/apps/enterprise-dashboard` and Compose project `enterprise-dashboard` are managed. No PostgreSQL service, Caddy service, host port, shared `.env` reconciliation, global Docker cleanup or automatic Git commit is added.

```text
/opt/apps/enterprise-dashboard/
  shared/api.env          # database credentials and sender token, mode 600
  shared/ui.env           # dashboard username and bcrypt hash, mode 600
  incoming/<tag>.<uuid>/   # staged uploads
  releases/<tag>/         # current or unpromoted release artifacts
  current -> releases/<tag>
  archive/<previous-tag>/ # previous images, checksums, Compose and helpers
```

Requires Linux Bash, curl, flock, sha256sum, SSH/SCP and Docker Compose **2.30 or newer** (raw env-file support). The account must manage Docker and own this dedicated app directory. Commands build Linux amd64 images by default; use `-Platform linux/arm64` if the VPS is ARM.

## First deployment preparation

1. The confirmed domain is `finance.heliorsoft.com`. Verify its DNS and the existing Docker network. Keep PostgreSQL private. Add only the site block from `Caddyfile.example` to the existing shared Caddyfile, using the confirmed finance domain. Preserve the HRMS/RMS blocks in the supplied shared-file reference. The Cloudflare origin certificate option must cover the chosen domain. Back up and validate the full shared file before reloading:

   ```bash
   cp /opt/apps/Caddyfile /opt/apps/Caddyfile.before-enterprise-dashboard
   # Edit /opt/apps/Caddyfile to add the reviewed site block.
   docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
   ```

   The deployment script does not rewrite shared Caddy automatically because its live contents and certificate coverage must be verified. Public validation requires this routing to be prepared first.

2. Run initialization from local PowerShell. The command streams `initialize-database.sh` over SSH and executes it on the VPS; no separate upload or database tunnel is needed:

   ```powershell
   .\deploy\scripts\initialize-database.ps1
   ```

   SSH prompts for your VPS password or key passphrase if required and allowed by the server. You can pass `-SshIdentityFile`, `-VpsHost`, `-VpsUser`, `-SshPort`, `-PostgresContainer` and `-DockerNetwork`; use `-NonInteractive` for unattended key-based execution. SSH host-key verification remains enabled. Build/deploy commands also allow prompts by default and accept `-NonInteractive` for automation.

   It generates random API/database credentials on the server, creates only the `enterprise_dashboard` database and non-superuser role, and verifies authentication. You do not enter a new database password. It never resets an existing role password. Existing `api.env` is preserved. An interrupted setup retains `api.env.pending`; investigate a role/password mismatch instead of deleting this recovery file. The deployment account needs Docker access and permission to create the app directory (an administrator can create/chown that directory first); the initializer does not run sudo automatically.

3. Generate and save the dashboard login from local PowerShell:

   ```powershell
   .\deploy\scripts\configure-ui.ps1 -DashboardUser admin -GeneratePassword
   ```

   Save the generated password displayed once after success. Omit `-GeneratePassword` to enter your own password at a hidden prompt. The script connects over SSH, hashes the password using a temporary Caddy container, and creates or atomically replaces `/opt/apps/enterprise-dashboard/shared/ui.env` from `ui.env.example` with permissions `600`. Only the hash is saved; failed hashing or template validation preserves the existing file. Running this command again changes the saved login; deploy afterward to apply it. It does not restart existing applications or change database credentials. The same SSH options as initialization are supported.

   Env files use raw format: no surrounding quotes and no doubling `$`. Never place the ingestion token in Angular code or browser storage. Configure the Tally sender with the token from `shared/api.env` using a secure channel.

## Build, upload, deploy and test

From this repository in PowerShell, after setup (the scripts default to the confirmed finance domain):

```powershell
.\deploy\scripts\build-save-upload-images.ps1 -Tag finance-008 -PublicBaseUrl https://finance.heliorsoft.com -DeployAfterUpload
```

This builds both images locally, saves tarballs, computes SHA-256 hashes, uploads to a unique staging directory, verifies checksums on the VPS, loads images, validates UI configuration, applies database migrations, starts the containers, runs API checks and verifies public health/access protection. It archives the previous release only after validation succeeds. Repeat with a new immutable tag:

```powershell
.\deploy\scripts\build-save-upload-images.ps1 -Tag finance-0015 -PublicBaseUrl https://finance.heliorsoft.com -DeployAfterUpload
```

Useful variations:

```powershell
# Build only; neither upload nor deploy:
.\deploy\scripts\build-save-upload-images.ps1 -Tag finance-003 -SkipUpload
# Upload a completed local build, then deploy:
.\deploy\scripts\build-save-upload-images.ps1 -Tag finance-003 -SkipBuild -PublicBaseUrl https://finance.heliorsoft.com -DeployAfterUpload
# Resume an uploaded but not yet promoted staging directory (use the actual printed path):
.\deploy\scripts\deploy-on-vps.ps1 -Tag finance-003 -StagingDir /opt/apps/enterprise-dashboard/incoming/finance-003.ACTUAL_UUID -PublicBaseUrl https://finance.heliorsoft.com
# Retry a release already moved into releases/:
.\deploy\scripts\deploy-on-vps.ps1 -Tag finance-003 -PublicBaseUrl https://finance.heliorsoft.com
# Restore an archived release:
.\deploy\scripts\deploy-on-vps.ps1 -Tag finance-001 -PublicBaseUrl https://finance.heliorsoft.com
```

Both scripts accept `-VpsHost`, `-VpsUser`, `-SshPort`, and `-SshIdentityFile`. SSH host-key checking remains enabled. On initial connection verify the host key using your normal SSH process. Never reuse a tag for different artifacts. Incomplete builds have no completed manifest; use a new tag. Interrupted uploads can be re-uploaded with `-SkipBuild`; the unused staging folder is retained for inspection.

SSH/SCP may prompt separately for each connection. For unattended operation, use an SSH key/agent and `-NonInteractive`. If authentication fails after a completed build, retry the same tag with `-SkipBuild -DeployAfterUpload`; no rebuild is necessary. Passwords are never accepted as script arguments or saved by these scripts.

Failed post-start validation attempts to restore the previous application containers. First-deploy failures have no earlier release to restore. Archived rollback skips migration execution and requires the current schema to support the older images. Schema migrations are forward-only: design additive/backward-compatible changes, and take a database backup before future destructive changes. Release archives are **not database backups**. Add the separate database to the existing VPS backup/restore process before storing real data. Secrets are deliberately not copied into release archives. Nothing prunes images, volumes or older releases automatically.

## Development and verification

Use `api/.env.example` for a local PostgreSQL database, then:

```powershell
cd api
npm ci
npm run migrate
npm start
```

In another terminal run `npm ci` and `npm start` from `ui`. The dev proxy forwards `/api` to port 3000. Startup does not insert demonstration companies or financial records. The old SQL Server `.bak` is retained as an existing file and is not used.

`npm test` in `api` runs validation and HTTP-auth tests; database tests run only when `DB_NAME=enterprise_dashboard_test`. Set DB_HOST/PORT/USER/PASSWORD to a **disposable** PostgreSQL database of that name; the integration tests truncate their test tables. Production image/API smoke checks are read-only and never submit a valid import.

Official references: [node-postgres transactions](https://node-postgres.com/features/transactions), [parameterized queries](https://node-postgres.com/features/queries), [Compose env files](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/), [Caddy basic authentication](https://caddyserver.com/docs/caddyfile/directives/basic_auth).
