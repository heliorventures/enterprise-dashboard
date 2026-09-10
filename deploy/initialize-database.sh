#!/usr/bin/env bash
# Run once on the VPS after reviewing. Creates ONLY enterprise_dashboard database/role.
set -Eeuo pipefail
umask 077
container=${POSTGRES_CONTAINER:-postgres}
network=${DOCKER_NETWORK:-apps_app-network}
app=/opt/apps/enterprise-dashboard
command -v openssl >/dev/null
docker network inspect "$network" >/dev/null
mkdir -p "$app/shared"
exec 9>"$app/.deploy.lock"
flock -n 9 || { echo 'Another setup/deployment is running'; exit 1; }
if [[ -e "$app/shared/api.env" ]]; then
  echo 'api.env already exists; preserving credentials. Verify connectivity using the deployment command.'
  exit 0
fi
# If setup was interrupted, preserve the generated secret for a safe retry.
pending="$app/shared/api.env.pending"
if [[ ! -f "$pending" ]]; then
  printf 'DB_HOST=%s\nDB_PORT=5432\nDB_NAME=enterprise_dashboard\nDB_USER=enterprise_dashboard\nDB_PASSWORD=%s\nTALLY_INGEST_TOKEN=%s\n' \
    "$container" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > "$pending"
fi
export DASHBOARD_DB_PASSWORD
DASHBOARD_DB_PASSWORD=$(sed -n 's/^DB_PASSWORD=//p' "$pending")
test -n "$DASHBOARD_DB_PASSWORD"
docker exec -i -e DASHBOARD_DB_PASSWORD "$container" sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres' <<'SQL'
\getenv dashboard_password DASHBOARD_DB_PASSWORD
SELECT pg_advisory_lock(74312003);
SELECT format('CREATE ROLE enterprise_dashboard LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'dashboard_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enterprise_dashboard') \gexec
SELECT 'CREATE DATABASE enterprise_dashboard OWNER enterprise_dashboard'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'enterprise_dashboard') \gexec
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enterprise_dashboard' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
    RAISE EXCEPTION 'Existing enterprise_dashboard role has unexpected privileges; inspect manually';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = 'enterprise_dashboard' AND pg_get_userbyid(datdba) <> 'enterprise_dashboard') THEN
    RAISE EXCEPTION 'Existing database has a different owner; inspect manually';
  END IF;
END $$;
REVOKE ALL ON DATABASE enterprise_dashboard FROM PUBLIC;
SQL
# Verify generated credentials before promoting the file. Never rotate an existing role silently.
export PGPASSWORD="$DASHBOARD_DB_PASSWORD"
postgres_image=$(docker inspect --format '{{.Config.Image}}' "$container")
# A separate client exercises the same Docker-network authentication as the API.
# Loopback inside PostgreSQL may use trust authentication and cannot verify a password.
docker run --rm --network "$network" --env PGPASSWORD "$postgres_image" \
  psql -X -h "$container" -U enterprise_dashboard -d enterprise_dashboard -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null
if PGPASSWORD="deliberately-invalid-$(openssl rand -hex 16)" docker run --rm --network "$network" --env PGPASSWORD "$postgres_image" \
  psql -X -h "$container" -U enterprise_dashboard -d enterprise_dashboard -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null 2>&1; then
  echo 'PostgreSQL accepted an incorrect password on the application network. Require password authentication before continuing.'
  exit 1
fi
unset DASHBOARD_DB_PASSWORD PGPASSWORD
mv "$pending" "$app/shared/api.env"
echo "Database prepared. API credentials are in $app/shared/api.env (mode 600). Prepare ui.env next."
