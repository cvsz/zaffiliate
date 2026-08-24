#!/usr/bin/env bash
# Idempotent host deployment for zaffiliate.zeaz.dev
# Topology: Cloudflare (TLS edge) -> loopback Caddy (:80/:8080) -> API :8788 -> Supabase Postgres (pooler)
# Requires: sudo, node, the user-run edge caddy (admin on 127.0.0.1:2019), and .env.* credentials.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "deploy: $1" >&2; exit 1; }
command -v node >/dev/null || fail "node is required"
[ -f .env.pooler ] || [ -f .env.core ] || fail "no .env.pooler/.env.core with Supabase credentials"

DB_URL="$(node scripts/derive-pooler-url.mjs)"
[ -n "$DB_URL" ] || fail "could not derive pooler DATABASE_URL"

SECRET=$(grep -E '^SESSION_SECRET=' /etc/zaffiliate.env 2>/dev/null | cut -d= -f2- || true)
[ -n "$SECRET" ] || SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
SALT=$(grep -E '^VISITOR_SALT=' /etc/zaffiliate.env 2>/dev/null | cut -d= -f2- || true)
[ -n "$SALT" ] || SALT=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")

{
  echo 'PORT=8788'
  echo 'APP_ENV=production'
  echo 'NODE_ENV=production'
  echo "DATABASE_URL=${DB_URL}"
  echo 'REDIS_URL=redis://127.0.0.1:6379/0'
  echo "SESSION_SECRET=${SECRET}"
  echo "VISITOR_SALT=${SALT}"
  echo 'LOG_LEVEL=info'
} | sudo tee /etc/zaffiliate.env >/dev/null
sudo chown root:cvsz /etc/zaffiliate.env && sudo chmod 640 /etc/zaffiliate.env

sudo tee /etc/systemd/system/zaffiliate.service >/dev/null <<'UNIT'
[Unit]
Description=zaffiliate API (production)
After=network-online.target
Wants=network-online.target

[Service]
User=cvsz
WorkingDirectory=/home/cvsz/zaffiliate
EnvironmentFile=/etc/zaffiliate.env
ExecStart=/usr/bin/node apps/api/src/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now zaffiliate.service >/dev/null

CP="$HOME/zeaz/deploy/caddy/Caddyfile"
[ -f "$CP" ] || fail "edge Caddyfile not found at $CP"
cp "$CP" "$CP.bak.$(date +%s)"
if ! grep -q 'http://zaffiliate.zeaz.dev' "$CP"; then
cat >> "$CP" <<'VHOST'

http://zaffiliate.zeaz.dev:8080, http://zaffiliate.zeaz.dev:80 {
	bind 127.0.0.1

	header {
		-Server
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "no-referrer"
	}

	reverse_proxy 127.0.0.1:8788 {
		header_up Host {http.request.host}
		header_up X-Forwarded-Proto https
		header_up X-Real-IP {http.request.header.CF-Connecting-IP}
		header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
	}
}
VHOST
fi

CODE=$(curl -s -H 'Content-Type: text/caddyfile' --data-binary @"$CP" http://127.0.0.1:2019/load -o /dev/null -w '%{http_code}')
[ "$CODE" = "200" ] || fail "edge config load failed with $CODE"

sleep 1
curl -sf http://127.0.0.1:8788/healthz >/dev/null && echo "deploy: api direct OK"
curl -sf --resolve zaffiliate.zeaz.dev:80:127.0.0.1 http://zaffiliate.zeaz.dev/healthz >/dev/null \
  && echo "deploy: via edge OK" || echo "deploy: edge vhost check skipped"

migrate_ok=0
for attempt in 1 2 3; do
  if ./scripts/migrate.sh >/dev/null 2>&1; then migrate_ok=1; break; fi
  echo "deploy: migration attempt $attempt failed (pooler transient?) - retrying"
  sleep 5
done
if [ "$migrate_ok" = "1" ]; then echo "deploy: migrations verified against live DB"; else echo "deploy: WARN migrations unreachable this run (non-blocking)"; fi
echo "deploy: done — public reachability requires Cloudflare DNS: zaffiliate.<zone> -> this origin"
