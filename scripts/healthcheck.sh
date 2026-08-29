#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-8080}"
BASE="http://127.0.0.1:${PORT}"

liveness=0
if curl -sf "${BASE}/healthz" >/dev/null 2>&1; then
  echo "healthcheck: liveness OK (${BASE}/healthz)"
else
  echo "healthcheck: liveness FAILED — is the API running? (docker compose up -d)" >&2
  liveness=1
fi

readiness="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/readyz" 2>/dev/null || echo 000)"
case "$readiness" in
  200) echo "healthcheck: readiness OK" ;;
  503) echo "healthcheck: readiness DEGRADED (missing dependencies; see /readyz body)" ;;
  *) echo "healthcheck: readiness UNREACHABLE" ;;
esac

version="$(curl -s "${BASE}/api/v1/version" 2>/dev/null || true)"
[ -n "$version" ] && echo "healthcheck: version ${version}"

exit "$liveness"
