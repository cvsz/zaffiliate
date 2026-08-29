#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${1:-backups/zaffiliate-${stamp}.sql.gz}"

docker compose ps --status running postgres | grep -q postgres || { echo "backup: postgres service not running (docker compose up -d postgres)" >&2; exit 2; }
docker compose exec -T postgres pg_dump -U zaffiliate -d zaffiliate --no-owner | gzip > "$target"
echo "backup: wrote ${target} ($(wc -c < "$target") bytes)"
