#!/bin/sh
set -eu

APP_ROOT=${TGG_APP_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
ENV_FILE=${TGG_ENV_FILE:-"$APP_ROOT/.env"}
BACKUP_ROOT=${TGG_BACKUP_ROOT:-/www/backup/tgg-shop/postgres}
RETENTION_DAYS=${TGG_BACKUP_RETENTION_DAYS:-14}

if [ ! -f "$ENV_FILE" ]; then
  echo "environment file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [ "${TGG_STORE_DRIVER:-}" != "pg" ] || [ -z "${TGG_PG_URL:-}" ]; then
  echo "PostgreSQL storage is not configured" >&2
  exit 1
fi

mkdir -p "$BACKUP_ROOT"
umask 077
stamp=$(date -u +%Y%m%d_%H%M%S)
target="$BACKUP_ROOT/tgg_shop_${stamp}.dump"
pg_dump --format=custom --no-owner --no-privileges "$TGG_PG_URL" > "$target"
find "$BACKUP_ROOT" -type f -name 'tgg_shop_*.dump' -mtime "+$RETENTION_DAYS" -delete
printf '%s backup=%s size=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$target" "$(wc -c < "$target")"
