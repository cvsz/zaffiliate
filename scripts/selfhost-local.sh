#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="${ZAFFILIATE_COMPOSE_FILE:-compose.selfhost.yaml}"
ENV_FILE="${ZAFFILIATE_ENV_FILE:-.env.selfhost}"
ACTION="${1:-up}"

fail() {
  printf 'selfhost: ERROR: %s\n' "$1" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

need docker
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"

random_hex() {
  local bytes="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  else
    need node
    node -e "console.log(require('crypto').randomBytes(${bytes}).toString('hex'))"
  fi
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    umask 077
    cat >"$ENV_FILE" <<EOF
POSTGRES_PASSWORD=$(random_hex 24)
REDIS_PASSWORD=$(random_hex 24)
SESSION_SECRET=$(random_hex 32)
ENCRYPTION_KEY=$(random_hex 32)
VISITOR_SALT=$(random_hex 32)
ZAFFILIATE_PORT=8080
ZAFFILIATE_WEB_PORT=3100
LOG_LEVEL=info
EOF
    printf 'selfhost: generated %s with mode 600\n' "$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"

  local required=(POSTGRES_PASSWORD REDIS_PASSWORD SESSION_SECRET ENCRYPTION_KEY VISITOR_SALT)
  local key
  for key in "${required[@]}"; do
    grep -Eq "^${key}=.{32,}$" "$ENV_FILE" || fail "$ENV_FILE is missing a strong $key"
  done
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

read_env() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

wait_for_api() {
  local port
  port="$(read_env ZAFFILIATE_PORT)"
  port="${port:-8080}"
  local attempt
  for attempt in $(seq 1 60); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then
      printf 'selfhost: API healthy at http://127.0.0.1:%s\n' "$port"
      return 0
    fi
    sleep 2
  done
  compose ps >&2 || true
  compose logs --tail=80 api migrate postgres redis >&2 || true
  fail "API did not become healthy"
}

case "$ACTION" in
  up|start)
    need curl
    ensure_env
    compose config -q
    compose up -d --build
    wait_for_api
    web_port="$(read_env ZAFFILIATE_WEB_PORT)"
    web_port="${web_port:-3100}"
    printf 'selfhost: web UI http://127.0.0.1:%s\n' "$web_port"
    printf 'selfhost: data is persisted in Docker named volumes; Postgres and Redis are not published to the host.\n'
    ;;
  down|stop)
    ensure_env
    compose down
    printf 'selfhost: stopped; persistent volumes preserved\n'
    ;;
  restart)
    ensure_env
    compose down
    compose up -d --build
    need curl
    wait_for_api
    ;;
  status)
    ensure_env
    compose ps
    ;;
  logs)
    ensure_env
    shift || true
    if [ "$#" -gt 0 ]; then
      compose logs -f --tail=200 "$@"
    else
      compose logs -f --tail=200
    fi
    ;;
  migrate)
    ensure_env
    compose up -d postgres
    compose run --rm migrate
    ;;
  destroy)
    ensure_env
    [ "${ZAFFILIATE_CONFIRM_DESTROY:-}" = "YES" ] || fail "set ZAFFILIATE_CONFIRM_DESTROY=YES to delete local database and Redis volumes"
    compose down -v --remove-orphans
    printf 'selfhost: local persistent volumes deleted\n'
    ;;
  *)
    cat >&2 <<'USAGE'
Usage: ./scripts/selfhost-local.sh [up|down|restart|status|logs [service...]|migrate|destroy]

Defaults:
  compose file: compose.selfhost.yaml
  env file:     .env.selfhost (generated automatically, chmod 600)

Destroy is intentionally gated:
  ZAFFILIATE_CONFIRM_DESTROY=YES ./scripts/selfhost-local.sh destroy
USAGE
    exit 2
    ;;
esac
