#!/usr/bin/env bash
# Offline regression: emulate Caddy's newline-terminated stdin contract.
set -Eeuo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
fixture=$(mktemp -d "$root/.ui-config-test.XXXXXX")
trap 'rm -rf -- "$fixture"' EXIT
sed "s|app=/opt/apps/enterprise-dashboard|app=$fixture/app|" "$root/deploy/configure-ui.sh" | tr -d '\r' > "$fixture/setup.sh"
flock() { return 0; }
docker() {
  local password
  IFS= read -r password || { echo 'Error: EOF' >&2; return 1; }
  [[ "$password" == 'Offline-password-123' ]] || return 1
  [[ "${FAIL_HASH:-0}" == 0 ]] || return 1
  printf '$2a$14$'
  printf 'a%.0s' {1..53}
  printf '\n'
}
export -f flock docker
payload() {
  printf 'admin\n'
  printf 'Offline-password-123' | base64 -w0
  printf '\n'
  tr -d '\r' < "$root/deploy/ui.env.example" | base64 -w0
  printf '\n'
}
# Prove the mock rejects the original unterminated input.
if printf 'Offline-password-123' | docker 2>/dev/null; then
  echo 'Test did not detect missing newline' >&2; exit 1
fi
payload | bash "$fixture/setup.sh" > "$fixture/output"
grep -Fxq UI_ENV_SAVED "$fixture/output"
grep -Fxq DASHBOARD_USER=admin "$fixture/app/shared/ui.env"
printf 'existing configuration\n' > "$fixture/app/shared/ui.env"
export FAIL_HASH=1
if payload | bash "$fixture/setup.sh"; then exit 1; fi
grep -Fxq 'existing configuration' "$fixture/app/shared/ui.env"
unset FAIL_HASH
payload | bash "$fixture/setup.sh" > "$fixture/output"
grep -Fxq UI_ENV_SAVED "$fixture/output"
grep -Fxq DASHBOARD_USER=admin "$fixture/app/shared/ui.env"
echo 'PASS: newline contract, create, replace, and preservation on hash failure (mock Docker).'
