#!/usr/bin/env bash
set -euo pipefail

if [[ "${CI:-}" != "true" && "${ALLOW_PRODUCTION_EQUIVALENT_DRILL:-}" != "YES" ]]; then
  echo "Refusing DR rehearsal without CI=true or ALLOW_PRODUCTION_EQUIVALENT_DRILL=YES" >&2
  exit 2
fi

mkdir -p dist/release-evidence
evidence="dist/release-evidence/production-equivalent-drill.json"
candidate_image="${CANDIDATE_IMAGE:-zaffiliate:candidate}"
known_good_image="${KNOWN_GOOD_IMAGE:-zaffiliate:known-good}"
network="${DR_NETWORK:-zaffiliate-selfhost_backend}"
db_password="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}"
redis_password="${REDIS_PASSWORD:?REDIS_PASSWORD required}"
session_secret="${SESSION_SECRET:?SESSION_SECRET required}"
encryption_key="${ENCRYPTION_KEY:?ENCRYPTION_KEY required}"
visitor_salt="${VISITOR_SALT:?VISITOR_SALT required}"

cleanup() {
  docker rm -f zaff-dr-api zaff-dr-restore >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker image inspect "$candidate_image" >/dev/null 2>&1; then echo "candidate image missing" >&2; exit 2; fi
if ! docker image inspect "$known_good_image" >/dev/null 2>&1; then echo "known-good image missing" >&2; exit 2; fi
if ! docker network inspect "$network" >/dev/null 2>&1; then echo "drill network missing: $network" >&2; exit 2; fi

marker="dr-${GITHUB_RUN_ID:-local}-$(date +%s)"
marker_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker compose --env-file .env.selfhost -f compose.selfhost.yaml exec -T postgres   psql -U zaffiliate -d zaffiliate -v ON_ERROR_STOP=1   -c "CREATE TABLE IF NOT EXISTS release_recovery_markers (id text primary key, created_at timestamptz not null);"   -c "INSERT INTO release_recovery_markers(id,created_at) VALUES ('$marker','$marker_at');"

dump_start="$(date +%s%3N)"
docker compose --env-file .env.selfhost -f compose.selfhost.yaml exec -T postgres   pg_dump -U zaffiliate -d zaffiliate --format=custom --no-owner --no-privileges > dist/release-evidence/production-equivalent.dump
dump_ms="$(( $(date +%s%3N) - dump_start ))"
dump_sha="$(sha256sum dist/release-evidence/production-equivalent.dump | awk '{print $1}')"

docker run -d --name zaff-dr-restore -e POSTGRES_DB=zaffiliate_restore -e POSTGRES_USER=zaffiliate   -e POSTGRES_PASSWORD="$db_password" -p 127.0.0.1:55432:5432 postgres:17-alpine >/dev/null
stable_ready=0
for _ in $(seq 1 90); do
  if docker exec zaff-dr-restore pg_isready -U zaffiliate -d zaffiliate_restore >/dev/null 2>&1; then
    stable_ready=$((stable_ready + 1))
    if [[ "$stable_ready" -ge 4 ]]; then break; fi
  else
    stable_ready=0
  fi
  sleep 1
done
if [[ "$stable_ready" -lt 4 ]]; then
  docker logs zaff-dr-restore >&2 || true
  echo "restore PostgreSQL did not become stably ready" >&2
  exit 1
fi

restore_start="$(date +%s%3N)"
docker exec -i zaff-dr-restore pg_restore -U zaffiliate -d zaffiliate_restore --exit-on-error --no-owner --no-privileges < dist/release-evidence/production-equivalent.dump
RESTORED_DATABASE_URL="postgresql://zaffiliate:$db_password@127.0.0.1:55432/zaffiliate_restore"   node scripts/restore-rehearsal.mjs
restore_ms="$(( $(date +%s%3N) - restore_start ))"

restored_marker="$(docker exec zaff-dr-restore psql -U zaffiliate -d zaffiliate_restore -Atqc "SELECT created_at::text FROM release_recovery_markers WHERE id='$marker'")"
test -n "$restored_marker"
synthetic_rpo_seconds=0

run_api() {
  local image="$1"
  docker rm -f zaff-dr-api >/dev/null 2>&1 || true
  docker run -d --name zaff-dr-api --network "$network" -p 127.0.0.1:18080:8080     -e APP_ENV=production -e NODE_ENV=production -e PORT=8080     -e DATABASE_URL="postgresql://zaffiliate:$db_password@postgres:5432/zaffiliate"     -e REDIS_URL="redis://:$redis_password@redis:6379/0"     -e SESSION_SECRET="$session_secret" -e ENCRYPTION_KEY="$encryption_key" -e VISITOR_SALT="$visitor_salt"     "$image" >/dev/null
  for _ in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:18080/healthz >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  docker logs zaff-dr-api >&2 || true
  return 1
}

run_api "$candidate_image"
candidate_health_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
rollback_start="$(date +%s%3N)"
run_api "$known_good_image"
rollback_rto_ms="$(( $(date +%s%3N) - rollback_start ))"
known_good_health_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$evidence" <<JSON
{
  "kind": "production_equivalent_ephemeral_rehearsal",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "candidateImage": "$candidate_image",
  "knownGoodImage": "$known_good_image",
  "snapshotSha256": "$dump_sha",
  "snapshotDurationMs": $dump_ms,
  "restoreDurationMs": $restore_ms,
  "syntheticRpoSeconds": $synthetic_rpo_seconds,
  "rollbackRtoMs": $rollback_rto_ms,
  "recoveryMarker": "$marker",
  "recoveryMarkerAt": "$marker_at",
  "restoredMarkerAt": "$restored_marker",
  "candidateHealthyAt": "$candidate_health_at",
  "knownGoodHealthyAt": "$known_good_health_at",
  "result": "PASS",
  "scope": "ephemeral production-equivalent topology; operator must repeat with an approved production snapshot before cutover"
}
JSON
cat "$evidence"
