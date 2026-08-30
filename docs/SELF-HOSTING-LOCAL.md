# Local Self-hosting

This profile runs zaffiliate entirely on one local Docker host with no required Supabase, Cloudflare, or managed Redis dependency.

## Prerequisites

- Docker Engine + Docker Compose v2 (Docker Desktop is also supported for WSL2)
- `curl`
- `openssl` or Node.js (only used by the helper to generate secrets)

## Start

```bash
bash scripts/selfhost-local.sh up
```

The first start creates `.env.selfhost` with random local-only secrets and mode `0600`, builds the production image, starts PostgreSQL 17 and Redis 7, applies every database migration before the API is allowed to start, then probes the API health endpoint.

Default loopback endpoints:

- API: `http://127.0.0.1:8080`
- Control-plane web: `http://127.0.0.1:3100`

PostgreSQL and Redis are intentionally **not published to the host**. They are reachable only on the private Docker backend network. The API is attached to both the private backend and an egress-capable edge network so provider/OAuth HTTPS calls remain possible.

## Operations

```bash
bash scripts/selfhost-local.sh status
bash scripts/selfhost-local.sh logs
bash scripts/selfhost-local.sh logs api
bash scripts/selfhost-local.sh migrate
bash scripts/selfhost-local.sh restart
bash scripts/selfhost-local.sh down
```

`down` preserves the named PostgreSQL and Redis volumes. To permanently remove local data, an explicit destructive confirmation is required:

```bash
ZAFFILIATE_CONFIRM_DESTROY=YES bash scripts/selfhost-local.sh destroy
```

## Ports

Edit only the generated `.env.selfhost` file:

```dotenv
ZAFFILIATE_PORT=8080
ZAFFILIATE_WEB_PORT=3100
```

The Compose profile binds both ports to `127.0.0.1` by default. Do not change them to `0.0.0.0` unless the host firewall, TLS termination, and authentication boundary are deliberately configured for LAN/public access.

## Persistence and upgrades

Persistent data lives in Docker named volumes:

- `zaffiliate-selfhost_postgres-data`
- `zaffiliate-selfhost_redis-data`

Every `up` rebuild uses the same production Dockerfile. The one-shot `migrate` service must complete successfully before the API starts. Migration checksum drift fails closed through the repository migrator.

For a source upgrade:

```bash
git pull --ff-only
bash scripts/selfhost-local.sh up
```

A migration failure blocks the API from moving onto the new schema/runtime combination. Inspect with:

```bash
bash scripts/selfhost-local.sh logs migrate postgres api
```

## Local authentication

The local-auth flow does not require an external OAuth provider. OIDC/OAuth is optional and remains disabled when `OAUTH_PROVIDER_ID` is unset.

If an external OIDC provider is enabled later, its redirect URI and provider endpoints must satisfy the production HTTPS/SSRF validation rules. A purely loopback HTTP callback is intentionally not accepted as production OIDC configuration.

## Backup note

Before destructive maintenance or major upgrades, create a PostgreSQL backup from the running local stack, for example:

```bash
docker compose --env-file .env.selfhost -f compose.selfhost.yaml exec -T postgres \
  pg_dump -U zaffiliate -d zaffiliate -Fc > zaffiliate-local.dump
```

Store dumps outside the repository and protect them as tenant data.
