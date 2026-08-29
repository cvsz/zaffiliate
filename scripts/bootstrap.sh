#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

fail() { echo "bootstrap: $1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "node is required (>=22): https://nodejs.org"
command -v docker >/dev/null 2>&1 || fail "docker is required: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || fail "docker compose plugin is required"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "bootstrap: created .env from .env.example"
fi

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

ensure_env_value() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=.+$" .env; then return 0; fi
  if grep -qE "^${key}=$" .env; then
    sed -i.bak "s|^${key}=$|${key}=${value}|" .env && rm -f .env.bak
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
  echo "bootstrap: generated local ${key}"
}

ensure_env_value SESSION_SECRET "$(generate_secret)"
ensure_env_value ENCRYPTION_KEY "$(generate_secret)"
ensure_env_value VISITOR_SALT "$(generate_secret)"

mkdir -p dist logs

echo "bootstrap: starting dependency services (postgres, redis)"
docker compose up -d postgres redis

echo "bootstrap: waiting for postgres readiness"
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U zaffiliate -d zaffiliate >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ "${ready:-0}" = "1" ] || fail "postgres did not become healthy"

echo "bootstrap: running migrations"
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" ./scripts/migrate.sh

echo "bootstrap: done. Start the full stack with: docker compose up -d"
echo "endpoints: http://localhost:${PORT:-8080}/healthz · /readyz · /metrics · /api/v1/version"
