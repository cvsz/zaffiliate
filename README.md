# zaffiliate

Canonical affiliate-commerce platform consolidating the legacy `cvsz/zaffhub`, `cvsz/ztsaff`, `cvsz/tiktok-shop-bot`, `cvsz/tiktok-shop-sdk`, `cvsz/tiktokshop-php`, `cvsz/zlttbots`, and `cvsz/zttlbots` repositories.

## Current baseline

`zaffiliate` now contains a runnable Node.js API baseline, canonical tenant/affiliate contracts, deterministic tests, a non-root container image, local Postgres/Redis orchestration, and GitHub Actions validation/security guards.

The current API intentionally exposes only platform health/readiness while the marketplace adapters, persistence layer, durable workflow engine, attribution, billing, content AI, and operator UI are migrated behind evidence-gated slices.

## Local development (golden path)

Requirements: Node.js 22+, npm 10+, Docker Engine + compose plugin. Windows: PowerShell 7+ (`pwsh`).

```bash
cp .env.example .env          # bootstrap.ps1 on Windows; secrets auto-generated if empty
./scripts/bootstrap.sh        # checks tools, creates env, starts postgres+redis, migrates, prints endpoints
docker compose up -d          # full stack (API + dependencies)
./scripts/healthcheck.sh      # liveness/readiness/version evidence
./scripts/verify.sh           # syntax gate + tests + audit + secret scan (pre-PR gate)
```

Other commands:

```bash
./scripts/migrate.sh          # apply pending migrations (safe to rerun; drift fails closed)
./scripts/security-check.sh   # audit + secret scan + container-user check
docker compose down           # stop stack
```

The API serves `/healthz`, `/readyz`, `/metrics`, and `/api/v1/version` on `$PORT` (default 8080).

Health endpoints:

```text
GET /healthz
GET /readyz
```

`/readyz` fails closed with HTTP 503 when mandatory runtime dependencies are absent.

For the local dependency stack:

```bash
docker compose up --build
```

## Security boundary

Runtime credentials are never committed. Use `.env.example` only as the variable contract. `.env`, private keys, and `secrets/` are ignored, and CI rejects common tracked secret material.

The legacy `ztsaff` repository contains tracked secret-like values and remains under explicit rotation/history-scan quarantine. Those values must never be copied into this repository.

## Migration status

Migration is evidence-gated. Legacy repositories remain intact until 100% source classification, mirror/bundle backup + restore evidence, secret remediation, parity/security/CI/load evidence, reversible production cutover, and final retirement approval are all verified.

See `ROADMAP.md`, `EXEC-PLANNING.md`, `SECURITY.md`, `OPERATIONS.md`, and `docs/migration/` for the canonical migration contract and current blockers.
