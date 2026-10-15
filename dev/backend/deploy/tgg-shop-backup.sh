#!/bin/sh
set -eu

APP_ROOT=${TGG_APP_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
ENV_FILE=${TGG_ENV_FILE:-"$APP_ROOT/.env"}
BACKUP_ROOT=${TGG_BACKUP_ROOT:-/www/backup/tgg-shop/postgres}
RETENTION_DAYS=${TGG_BACKUP_RETENTION_DAYS:-14}
PG_DUMP_BIN=${TGG_PG_DUMP_BIN:-}

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

if [ -z "$PG_DUMP_BIN" ]; then
  for candidate in /www/server/pgsql/bin/pg_dump /usr/bin/pg_dump /usr/local/bin/pg_dump; do
    if [ -x "$candidate" ]; then
      PG_DUMP_BIN=$candidate
      break
    fi
  done
fi
if [ -z "$PG_DUMP_BIN" ] || [ ! -x "$PG_DUMP_BIN" ]; then
  echo "pg_dump executable not found; set TGG_PG_DUMP_BIN" >&2
  exit 1
fi

mkdir -p "$BACKUP_ROOT"
umask 077
stamp=$(date -u +%Y%m%d_%H%M%S)
target="$BACKUP_ROOT/tgg_shop_${stamp}.dump"
temporary="$target.tmp"
trap 'rm -f "$temporary"' EXIT
"$PG_DUMP_BIN" --format=custom --no-owner --no-privileges "$TGG_PG_URL" > "$temporary"
if [ ! -s "$temporary" ]; then
  echo "pg_dump produced an empty archive" >&2
  exit 1
fi
mv -f "$temporary" "$target"
find "$BACKUP_ROOT" -type f -name 'tgg_shop_*.dump' -mtime "+$RETENTION_DAYS" -delete
printf '%s backup=%s size=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$target" "$(wc -c < "$target")"
