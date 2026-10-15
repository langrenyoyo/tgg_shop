#!/bin/sh
set -eu

APP_ROOT=${TGG_APP_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
ENV_FILE=${TGG_ENV_FILE:-"$APP_ROOT/.env"}
HEALTH_URL=${TGG_HEALTH_URL:-https://shop.taoguoguo.cc/api/health}

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  HEALTH_URL=${TGG_HEALTH_URL:-$HEALTH_URL}
fi

response=$(curl --fail --silent --show-error --max-time 15 --proto '=https' --tlsv1.2 "$HEALTH_URL")
node -e 'const value = JSON.parse(process.argv[1]); if (!value.ok || value.storeReady === false || value.pgReady === false) process.exit(1);' "$response"
printf '%s health=ok url=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HEALTH_URL"
