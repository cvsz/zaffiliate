# Development

## Prerequisites

- Node.js 22+
- npm
- Docker + Docker Compose
- PostgreSQL/Redis via `compose.yaml` for integration work

## Bootstrap

```bash
npm ci
docker compose up -d postgres redis
npm test
```

## Required checks

Before opening or merging a PR, run the applicable deterministic test/build/security checks defined by `package.json` and `.github/workflows/ci.yml`. Database changes must include forward migrations and cross-tenant/RLS tests where applicable.

## Production readiness verification

```bash
./scripts/verify.sh         # syntax gate + tests + audit + secret scan (pre-PR gate)
./scripts/security-check.sh # audit + secret scan + container-user check
npm run check               # syntax gate across all modules
npm test                    # full suite
```

Current evidence: `docs/PRODUCTION-READINESS.md` — all gates PASS with live Postgres evidence (`backup-restore-drill --run` + `restore-rehearsal` PASSED on localhost:5433).

## Architecture boundaries

- Provider credentials remain server-side.
- Tenant context is mandatory for tenant-owned resources.
- Mutating external actions require idempotency and policy/approval controls.
- Financial and billing mutations preserve ledger invariants.
- Migration provenance is recorded under `docs/migration/`.

## Local services

Use `compose.yaml` for development dependencies. Do not place real credentials in `.env.example` or commit runtime `.env` files.
