#!/usr/bin/env bash
set -Eeuo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
fixture=$(mktemp -d "$root/.release-test.XXXXXX")
trap 'case "$fixture" in "$root"/.release-test.*) rm -rf -- "$fixture";; esac' EXIT
app="$fixture/app"
mkdir -p "$app/incoming" "$app/releases" "$app/archive"
sed "s|/opt/apps/enterprise-dashboard|$app|g" "$root/deploy/resolve-release.sh" > "$fixture/resolve.sh"
export TEST_LOG="$fixture/selected.log"
make_helper() {
  mkdir -p "$1"
  cat > "$1/deploy.sh" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$0" "$@" > "$TEST_LOG"
MOCK
}
first="$app/incoming/fresh.0123456789abcdef0123456789abcdef"
second="$app/incoming/fresh.abcdef0123456789abcdef0123456789"
make_helper "$first"
bash "$fixture/resolve.sh" "$app" fresh https://test.example
grep -Fxq "$first/deploy.sh" "$TEST_LOG"
test "$(tail -n 1 "$TEST_LOG")" = "$first"
make_helper "$second"
if bash "$fixture/resolve.sh" "$app" fresh https://test.example > "$fixture/error" 2>&1; then echo 'Expected ambiguous upload rejection'; exit 1; fi
grep -q 'StagingDir' "$fixture/error"
bash "$fixture/resolve.sh" "$app" fresh https://test.example "$second"
grep -Fxq "$second/deploy.sh" "$TEST_LOG"
make_helper "$app/releases/fresh"
bash "$fixture/resolve.sh" "$app" fresh https://test.example
grep -Fxq "$app/releases/fresh/deploy.sh" "$TEST_LOG"
make_helper "$app/archive/previous"
bash "$fixture/resolve.sh" "$app" previous https://test.example
grep -Fxq "$app/archive/previous/deploy.sh" "$TEST_LOG"
if bash "$fixture/resolve.sh" "$app" missing https://test.example > "$fixture/error" 2>&1; then echo 'Expected missing upload rejection'; exit 1; fi
grep -q 'upload' "$fixture/error"
make_helper "$app/incoming/invalid.not-an-upload-id"
if bash "$fixture/resolve.sh" "$app" invalid https://test.example > /dev/null 2>&1; then echo 'Expected invalid staging rejection'; exit 1; fi
echo 'Release discovery passed: staged, explicit, prepared, archived, ambiguous, missing and invalid paths.'
