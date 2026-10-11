#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
app=${1:?application directory required}
tag=${2:?image tag required}
stage=${3:-}
[[ "$app" == /opt/apps/enterprise-dashboard ]] || { echo 'Invalid application directory'; exit 1; }
[[ "$tag" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,100}$ ]] || exit 1
exec 9>"$app/.deploy.lock"
flock -n 9 || { echo 'Another setup, migration or deployment is running.' >&2; exit 1; }
export APP_SHARED_DIR="$app/shared" IMAGE_TAG="$tag"
for file in api.env ui.env; do
  test -s "$APP_SHARED_DIR/$file" || { echo "Missing $file; initialize the application first." >&2; exit 1; }
done
mkdir -p "$app/releases"
release="$app/releases/$tag"
if [[ -z "$stage" && ! -d "$release" && ! -d "$app/archive/$tag" ]]; then
  shopt -s nullglob
  candidates=("$app/incoming/$tag."*)
  if [[ ${#candidates[@]} != 1 ]]; then
    echo 'Expected one uploaded staging directory. Upload first, or supply -StagingDir from the upload output.' >&2
    exit 1
  fi
  stage=${candidates[0]}
fi
verify() {
  local directory=$1
  for artifact in compose.yml deploy.sh smoke.js "enterprise-dashboard-api-$tag.tar" "enterprise-dashboard-ui-$tag.tar"; do
    test -f "$directory/$artifact" || { echo "Missing release artifact: $artifact" >&2; return 1; }
    # A present file must also be authenticated by the uploaded manifest.
    awk -v name="$artifact" '$2 == name || $2 == "*" name { found=1 } END { exit !found }' "$directory/SHA256SUMS" || return 1
  done
  (cd "$directory" && sha256sum --strict -c SHA256SUMS)
}
if [[ -n "$stage" ]]; then
  [[ "$stage" == "$app/incoming/$tag."* && "$stage" =~ ^[a-zA-Z0-9/_.-]+$ && ! -L "$stage" ]] || exit 1
  suffix=${stage#"$app/incoming/$tag."}
  [[ "$suffix" =~ ^[a-fA-F0-9]{32}$ ]] || { echo 'Invalid staging directory'; exit 1; }
  verify "$stage"
  if [[ -d "$release" ]]; then
    cmp "$stage/SHA256SUMS" "$release/SHA256SUMS" || { echo 'Tag already exists with different content; use a new tag'; exit 1; }
  elif [[ -d "$app/archive/$tag" ]]; then
    release="$app/archive/$tag"
    cmp "$stage/SHA256SUMS" "$release/SHA256SUMS" || { echo 'Archived tag has different content; use a new tag'; exit 1; }
  else
    mv "$stage" "$release"
  fi
elif [[ ! -d "$release" && -d "$app/archive/$tag" ]]; then
  release="$app/archive/$tag"
fi
verify "$release"
# Loading the new image does not replace running application containers.
docker load -i "$release/enterprise-dashboard-api-$tag.tar"
[[ ! -L "$APP_SHARED_DIR/storage" ]] || { echo 'Storage directory must not be a symbolic link'; exit 1; }
mkdir -p "$APP_SHARED_DIR/storage"
docker run --rm --network none --read-only --user 0:0 \
  --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges:true \
  --mount "type=bind,src=$APP_SHARED_DIR/storage,dst=/app/storage" \
  "enterprise-dashboard-api:$tag" sh -eu -c '
    mkdir -p /app/storage/imports
    chown node:node /app/storage /app/storage/imports
    chmod 700 /app/storage /app/storage/imports
  '
docker compose -p enterprise-dashboard-migrations -f "$release/compose.yml" config --quiet
docker compose -p enterprise-dashboard-migrations -f "$release/compose.yml" run --rm -T --no-deps enterprise-dashboard-api node src/migrate.js
echo "Database migrations applied for $tag. Application containers and current release are unchanged."
