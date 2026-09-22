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

## Architecture boundaries

- Provider credentials remain server-side.
- Tenant context is mandatory for tenant-owned resources.
- Mutating external actions require idempotency and policy/approval controls.
- Financial and billing mutations preserve ledger invariants.
- Migration provenance is recorded under `docs/migration/`.

## Local services

Use `compose.yaml` for development dependencies. Do not place real credentials in `.env.example` or commit runtime `.env` files.
