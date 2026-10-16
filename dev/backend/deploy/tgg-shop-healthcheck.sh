#!/bin/sh
set -eu

APP_ROOT=${TGG_APP_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
if [ -n "${TGG_ENV_FILE:-}" ]; then
  ENV_FILE=$TGG_ENV_FILE
elif [ -f /etc/tgg-shop/tgg-shop.env ]; then
  ENV_FILE=/etc/tgg-shop/tgg-shop.env
else
  ENV_FILE="$APP_ROOT/.env"
fi
HEALTH_URL=${TGG_HEALTH_URL:-https://shop.taoguoguo.cc/api/health}
NODE_BIN=${TGG_NODE_BIN:-$(command -v node || true)}

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  HEALTH_URL=${TGG_HEALTH_URL:-$HEALTH_URL}
fi

response=$(curl --fail --silent --show-error --max-time 15 --proto '=https' --tlsv1.2 "$HEALTH_URL")
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "node executable not found; set TGG_NODE_BIN" >&2
  exit 1
fi
"$NODE_BIN" -e 'const value = JSON.parse(process.argv[1]); if (!value.ok || value.storeReady === false || value.pgReady === false) process.exit(1);' "$response"
printf '%s health=ok url=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HEALTH_URL"
