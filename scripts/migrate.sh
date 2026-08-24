#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ] && [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
fi

exec node packages/db/src/cli.js
