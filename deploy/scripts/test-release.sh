#!/usr/bin/env bash
# Exercise release state transitions with mocked Docker/HTTP, not a live VPS.
set -Eeuo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
fixture=$(mktemp -d "$root/.release-test.XXXXXX")
trap 'case "$fixture" in "$root"/.release-test.*) rm -rf -- "$fixture";; esac' EXIT
app="$fixture/app"
mkdir -p "$fixture/bin" "$app/shared" "$app/incoming"
printf 'configured=yes\n' > "$app/shared/api.env"
printf 'configured=yes\n' > "$app/shared/ui.env"
# Only remap the allowed filesystem root for the test; execute the actual release algorithm.
sed "s|/opt/apps/enterprise-dashboard|$app|g" "$root/deploy/deploy.sh" > "$fixture/deploy.sh"
cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
echo "$IMAGE_TAG $*" >> "$TEST_LOG"
if [[ "$*" == *' exec '* ]]; then cat >/dev/null; fi
if [[ "${FAIL_TAG:-}" == "$IMAGE_TAG" && "$*" == *' up '* ]]; then exit 1; fi
exit 0
MOCK
cat > "$fixture/bin/curl" <<'MOCK'
#!/usr/bin/env bash
case "${*: -1}" in */healthz) printf 'enterprise-dashboard %s' "$IMAGE_TAG";; *) printf 401;; esac
MOCK
chmod +x "$fixture/bin/"*
# Git Bash lacks flock and may emulate symlinks as copies. Mock those primitives
# on Windows; Linux runs the real utilities. This test proves orchestration only.
case "$(uname -s)" in MINGW*|MSYS*)
  printf '#!/usr/bin/env bash\nexit 0\n' > "$fixture/bin/flock"
  cat > "$fixture/bin/ln" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$2" > "$3"
MOCK
  cat > "$fixture/bin/readlink" <<'MOCK'
#!/usr/bin/env bash
file=${*: -1}
if [[ -f "$file" ]]; then cat "$file"; else printf '%s\n' "$file"; fi
MOCK
  chmod +x "$fixture/bin/"*
;; esac
export PATH="$fixture/bin:$PATH" TEST_LOG="$fixture/commands.log"
make_release() {
  local tag=$1 stage="$app/incoming/$1.abc"
  mkdir -p "$stage"
  cp "$fixture/deploy.sh" "$stage/deploy.sh"
  cp "$root/deploy/compose.yml" "$root/deploy/smoke.js" "$stage/"
  touch "$stage/enterprise-dashboard-api-$tag.tar" "$stage/enterprise-dashboard-ui-$tag.tar"
  (cd "$stage" && sha256sum compose.yml deploy.sh smoke.js *.tar > SHA256SUMS)
}
make_release one
bash "$fixture/deploy.sh" "$app" one https://test.example "$app/incoming/one.abc" >/dev/null
test "$(readlink "$app/current")" = "$app/releases/one"
make_release two
bash "$fixture/deploy.sh" "$app" two https://test.example "$app/incoming/two.abc" >/dev/null
test -d "$app/archive/one"
test "$(readlink "$app/current")" = "$app/releases/two"
bash "$fixture/deploy.sh" "$app" two https://test.example >/dev/null
test -d "$app/archive/one"
make_release three
if FAIL_TAG=three bash "$fixture/deploy.sh" "$app" three https://test.example "$app/incoming/three.abc" >/dev/null; then
  echo 'Expected deployment failure'; exit 1
fi
test "$(readlink "$app/current")" = "$app/releases/two"
grep -q 'two compose .* up ' "$TEST_LOG"
bash "$fixture/deploy.sh" "$app" one https://test.example >/dev/null
test "$(readlink "$app/current")" = "$app/releases/one"
test -d "$app/archive/two"
: > "$TEST_LOG"
bash "$fixture/deploy.sh" "$app" one https://test.example >/dev/null
if grep -q 'src/migrate.js' "$TEST_LOG"; then
  echo 'A previously successful release must not rerun older migrations after rollback'; exit 1
fi
make_release corrupt
printf 'corrupted' >> "$app/incoming/corrupt.abc/smoke.js"
if bash "$fixture/deploy.sh" "$app" corrupt https://test.example "$app/incoming/corrupt.abc" >/dev/null 2>&1; then
  echo 'Expected checksum rejection'; exit 1
fi
test "$(readlink "$app/current")" = "$app/releases/one"
echo 'Release transition tests passed: first deploy, archive, rerun, failure recovery, rollback, checksum rejection.'
