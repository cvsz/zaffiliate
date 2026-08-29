#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

[ $# -eq 1 ] || { echo "restore: usage — ./scripts/restore.sh <backup-file.sql.gz>  (explicit destination required)" >&2; exit 2; }
[ -f "$1" ] || { echo "restore: file not found: $1" >&2; exit 2; }
[ "${RESTORE_CONFIRM:-no}" = "yes" ] || { echo "restore: refusing to overwrite. Re-run with RESTORE_CONFIRM=yes" >&2; exit 2; }

docker compose ps --status running postgres | grep -q postgres || { echo "restore: postgres service not running" >&2; exit 2; }
gunzip -c "$1" | docker compose exec -T psql -U zaffiliate -d zaffiliate >/dev/null
echo "restore: applied $1"
