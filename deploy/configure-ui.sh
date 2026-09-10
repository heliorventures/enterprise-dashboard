#!/usr/bin/env bash
# Receives username, base64 password and base64 template over encrypted SSH stdin.
set +x
set -Eeuo pipefail
umask 077
IFS= read -r username
IFS= read -r password64
IFS= read -r template64
[[ "$username" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$ ]] || exit 1
app=/opt/apps/enterprise-dashboard
mkdir -p "$app/shared"
exec 9>"$app/.deploy.lock"
flock -n 9 || { echo 'Another setup/deployment is running'; exit 1; }
# Caddy reads stdin through ReadBytes('\n'); EOF without a newline is an error.
hash=$({ printf '%s' "$password64" | base64 -d || exit 1; printf '\n'; } | docker run --rm -i caddy:2-alpine caddy hash-password --algorithm bcrypt)
unset password64
[[ "$hash" =~ ^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$ ]] || { echo 'Caddy did not return a valid bcrypt hash'; exit 1; }
temporary=$(mktemp "$app/shared/.ui.env.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
printf '%s' "$template64" | base64 -d | awk -v username="$username" -v hash="$hash" '
  /^DASHBOARD_USER=/ { print "DASHBOARD_USER=" username; users++; next }
  /^DASHBOARD_PASSWORD_HASH=/ { print "DASHBOARD_PASSWORD_HASH=" hash; hashes++; next }
  { print }
  END { if (users != 1 || hashes != 1) exit 1 }
' > "$temporary"
chmod 600 "$temporary"
mv -fT -- "$temporary" "$app/shared/ui.env"
test -s "$app/shared/ui.env"
grep -Fxq "DASHBOARD_USER=$username" "$app/shared/ui.env"
grep -Fxq "DASHBOARD_PASSWORD_HASH=$hash" "$app/shared/ui.env"
echo 'Dashboard login saved to /opt/apps/enterprise-dashboard/shared/ui.env.'
echo 'UI_ENV_SAVED'
