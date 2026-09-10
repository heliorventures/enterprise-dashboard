#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
app=${1:?application directory required}
tag=${2:?image tag required}
public_url=${3:?public HTTPS URL required}
stage=${4:-}
[[ "$app" == /opt/apps/enterprise-dashboard ]] || { echo 'Invalid application directory'; exit 1; }
[[ "$tag" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,100}$ ]] || exit 1
[[ "$public_url" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]] || { echo 'An HTTPS origin is required'; exit 1; }
for command in docker curl flock sha256sum; do command -v "$command" >/dev/null; done
mkdir -p "$app" "$app/releases" "$app/archive" "$app/shared"
exec 9>"$app/.deploy.lock"
flock -n 9 || { echo 'Another deployment is running'; exit 1; }
export APP_SHARED_DIR="$app/shared" IMAGE_TAG="$tag"
export DOCKER_NETWORK=${DOCKER_NETWORK:-apps_app-network}
docker network inspect "$DOCKER_NETWORK" >/dev/null
for file in api.env ui.env; do
  test -s "$APP_SHARED_DIR/$file" || { echo "Missing $APP_SHARED_DIR/$file; follow deploy/README.md"; exit 1; }
  if grep -q 'REPLACE_WITH' "$APP_SHARED_DIR/$file"; then echo "Unconfigured $file"; exit 1; fi
  chmod 600 "$APP_SHARED_DIR/$file"
done

target="$app/releases/$tag"
if [[ -n "$stage" ]]; then
  [[ "$stage" == "$app/incoming/$tag."* && "$stage" =~ ^[a-zA-Z0-9/_.-]+$ ]] || exit 1
  (cd "$stage" && sha256sum --strict -c SHA256SUMS)
  if [[ -d "$target" ]]; then
    cmp "$stage/SHA256SUMS" "$target/SHA256SUMS" || { echo 'Tag already exists with different content; use a new tag'; exit 1; }
  elif [[ -d "$app/archive/$tag" ]]; then
    cmp "$stage/SHA256SUMS" "$app/archive/$tag/SHA256SUMS" || { echo 'Archived tag has different content; use a new tag'; exit 1; }
    target="$app/archive/$tag"
  else
    mv "$stage" "$target"
  fi
elif [[ ! -d "$target" && -d "$app/archive/$tag" ]]; then
  target="$app/archive/$tag"
fi
test -d "$target" || { echo 'Release not found; upload it first'; exit 1; }
(cd "$target" && sha256sum --strict -c SHA256SUMS)
previous=$(readlink -f "$app/current" || true)
if [[ -n "$previous" && "$previous" != "$app/current" ]]; then
  [[ "$previous" == "$app/releases/"* || "$previous" == "$app/archive/"* ]] || exit 1
else previous=''; fi
compose() { docker compose -p enterprise-dashboard -f "$target/compose.yml" "$@"; }
# Never print the expanded configuration: it includes runtime credentials.
compose config --quiet
docker load -i "$target/enterprise-dashboard-api-$tag.tar"
docker load -i "$target/enterprise-dashboard-ui-$tag.tar"
compose run --rm --no-deps enterprise-dashboard-ui caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# Runs before replacing healthy containers. Migrations must support the previous image.
if [[ ! -f "$target/.deployed" && "$target" != "$app/archive/"* ]]; then
  compose run --rm --no-deps enterprise-dashboard-api node src/migrate.js
fi

restore_previous() {
  result=$?
  trap - ERR
  if [[ -n "$previous" && "$previous" != "$target" ]]; then
    echo 'Validation failed; restoring previous application containers.'
    IMAGE_TAG=$(basename "$previous") docker compose -p enterprise-dashboard -f "$previous/compose.yml" up -d --wait --wait-timeout 180 || echo 'Automatic recovery failed; inspect containers immediately.'
  else
    echo 'Validation failed. No different previous release is available; inspect this Compose project.'
  fi
  exit "$result"
}
trap restore_previous ERR
compose up -d --wait --wait-timeout 180
compose exec -T enterprise-dashboard-api node < "$target/smoke.js"
test "$(curl --fail --silent --show-error --max-time 30 "$public_url/healthz")" = "enterprise-dashboard $tag"
test "$(curl --silent --show-error --max-time 30 -o /dev/null -w '%{http_code}' "$public_url/api/companies")" = 401
test "$(curl --silent --show-error --max-time 30 -X POST -o /dev/null -w '%{http_code}' "$public_url/api/ingest/tally")" = 401

# Promote only after all checks. Keep all previous artifacts; no image/volume pruning.
touch "$target/.deployed"
if [[ "$target" == "$app/archive/"* ]]; then
  mv "$target" "$app/releases/$tag"
  target="$app/releases/$tag"
fi
ln -sfn "$target" "$app/current.next"
mv -Tf "$app/current.next" "$app/current"
trap - ERR
if [[ -n "$previous" && "$previous" != "$target" && -d "$previous" ]]; then
  old_tag=$(basename "$previous")
  if [[ "$previous" != "$app/archive/$old_tag" ]]; then mv "$previous" "$app/archive/$old_tag"; fi
fi
echo "Release $tag is healthy at $public_url. Previous artifacts retained in $app/archive."
