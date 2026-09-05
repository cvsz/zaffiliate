#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

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
  echo "ensure-secrets: generated ${key}"
}

update_env_value() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env && rm -f .env.bak
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
  echo "ensure-secrets: updated ${key}"
}

[ -f .env ] || { echo "ensure-secrets: .env not found — run 'cp .env.example .env' first" >&2; exit 1; }

ensure_env_value SESSION_SECRET "$(generate_secret)"
ensure_env_value ENCRYPTION_KEY "$(generate_secret)"
ensure_env_value VISITOR_SALT   "$(generate_secret)"
ensure_env_value DATABASE_PASSWORD "$(generate_secret)"
ensure_env_value REDIS_PASSWORD   "$(generate_secret)"

DB_PASS=$(grep -E '^DATABASE_PASSWORD=' .env | cut -d= -f2-)
REDIS_PASS=$(grep -E '^REDIS_PASSWORD=' .env | cut -d= -f2-)
DB_USER=$(grep -E '^DATABASE_URL=' .env | sed -E 's|.*://([^:]+):.*|\1|')
DB_NAME=$(grep -E '^DATABASE_URL=' .env | sed -E 's|.*/([^/?]+).*|\1|')
DB_HOST=$(grep -E '^DATABASE_URL=' .env | sed -E 's|.*@([^:/]+).*|\1|')
DB_PORT=$(grep -E '^DATABASE_URL=' .env | sed -E 's|.*:([0-9]+)/.*|\1|')

update_env_value DATABASE_URL "postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
update_env_value REDIS_URL "redis://:${REDIS_PASS}@${DB_HOST}:6379/0"

echo "ensure-secrets: done"
