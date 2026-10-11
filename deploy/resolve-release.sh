#!/usr/bin/env bash
# Select an immutable release or one unambiguous uploaded bundle. The selected
# release's deploy.sh retains checksum validation, locking and recovery ownership.
set -Eeuo pipefail
app=${1:?application directory required}
tag=${2:?image tag required}
public_url=${3:?public HTTPS URL required}
stage=${4:-}
[[ "$app" == /opt/apps/enterprise-dashboard ]] || exit 1
[[ "$tag" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,100}$ ]] || exit 1
[[ "$public_url" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]] || exit 1
if [[ -z "$stage" ]]; then
  for directory in "$app/releases/$tag" "$app/archive/$tag"; do
    if [[ -f "$directory/deploy.sh" ]]; then
      exec bash "$directory/deploy.sh" "$app" "$tag" "$public_url"
    fi
  done
  shopt -s nullglob
  candidates=("$app/incoming/$tag."*)
  if [[ ${#candidates[@]} == 0 ]]; then
    echo "Release $tag not found. Build and upload it before deploying." >&2
    exit 1
  fi
  if [[ ${#candidates[@]} != 1 ]]; then
    echo "Multiple uploads found for $tag. Supply -StagingDir with the exact path printed by the upload command." >&2
    exit 1
  fi
  stage=${candidates[0]}
fi
prefix="$app/incoming/$tag."
suffix=${stage#"$prefix"}
[[ "$stage" == "$prefix"* && "$suffix" =~ ^[a-f0-9]{32}$ && ! -L "$stage" && -f "$stage/deploy.sh" ]] || {
  echo 'Invalid or incomplete staging directory; use the path printed by the upload command.' >&2
  exit 1
}
exec bash "$stage/deploy.sh" "$app" "$tag" "$public_url" "$stage"
