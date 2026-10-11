#!/usr/bin/env bash
# Test real preparation logic with disposable files and a mocked Docker command.
set -Eeuo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
fixture=$(mktemp -d "$root/.release-test.XXXXXX")
trap 'case "$fixture" in "$root"/.release-test.*) rm -rf -- "$fixture";; esac' EXIT
app="$fixture/app"
mkdir -p "$fixture/bin" "$app/shared" "$app/incoming"
printf 'configured=yes\n' > "$app/shared/api.env"
printf 'configured=yes\n' > "$app/shared/ui.env"
printf 'previous-release\n' > "$app/current"
sed "s|/opt/apps/enterprise-dashboard|$app|g" "$root/deploy/migrate-database.sh" > "$fixture/migrate.sh"
cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
echo "$*" >> "$TEST_LOG"
if [[ "${FAIL_MIGRATION:-}" == 1 && "$*" == *src/migrate.js* ]]; then exit 1; fi
MOCK
case "$(uname -s)" in MINGW*|MSYS*) printf '#!/usr/bin/env bash\nexit 0\n' > "$fixture/bin/flock";; esac
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH" TEST_LOG="$fixture/commands.log"
suffix=0123456789abcdef0123456789abcdef
make_release() {
  local tag=$1 stage="$app/incoming/$1.$suffix"
  mkdir -p "$stage"
  for name in compose.yml deploy.sh smoke.js "enterprise-dashboard-api-$tag.tar" "enterprise-dashboard-ui-$tag.tar"; do
    printf 'fixture\n' > "$stage/$name"
  done
  (cd "$stage" && sha256sum compose.yml deploy.sh smoke.js *.tar > SHA256SUMS)
}
make_release first
bash "$fixture/migrate.sh" "$app" first > /dev/null
test -f "$app/releases/first/compose.yml"
grep -q 'load -i .*enterprise-dashboard-api-first.tar' "$TEST_LOG"
grep -q 'run --rm -T --no-deps enterprise-dashboard-api node src/migrate.js' "$TEST_LOG"
test "$(cat "$app/current")" = previous-release
if grep -Eq '(^| )up( |$)' "$TEST_LOG"; then echo 'Migration must not start application services'; exit 1; fi
bash "$fixture/migrate.sh" "$app" first > /dev/null
make_release corrupt
printf broken >> "$app/incoming/corrupt.$suffix/smoke.js"
: > "$TEST_LOG"
if bash "$fixture/migrate.sh" "$app" corrupt > /dev/null 2>&1; then echo 'Expected checksum rejection'; exit 1; fi
test ! -s "$TEST_LOG"
make_release ambiguous
cp -r "$app/incoming/ambiguous.$suffix" "$app/incoming/ambiguous.abcdef0123456789abcdef0123456789"
if bash "$fixture/migrate.sh" "$app" ambiguous > /dev/null 2>&1; then echo 'Expected staging ambiguity rejection'; exit 1; fi
bash "$fixture/migrate.sh" "$app" ambiguous "$app/incoming/ambiguous.$suffix" > /dev/null
make_release failed
if FAIL_MIGRATION=1 bash "$fixture/migrate.sh" "$app" failed > /dev/null 2>&1; then echo 'Expected migration failure'; exit 1; fi
test "$(cat "$app/current")" = previous-release
bash "$fixture/migrate.sh" "$app" failed > /dev/null
echo 'Database-first tests passed: prepare, load, migrate, retry, checksum rejection, ambiguity and failure isolation.'
