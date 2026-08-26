# Developer Handbook — Local Setup

## Requirements

- Node 22+ (repo developed on 22.x), npm
- Docker (optional: compose stack + restore rehearsals + containerized pg_dump)
- A Supabase project for persistence work (or any Postgres 15+); local compose Postgres also works

## Bootstrap

```sh
npm ci                       # deterministic install; single pinned runtime dep (pg) + dev deps
cp .env.example .env         # fill DATABASE_URL / REDIS_URL if you have them; secrets auto-generate
npm test                     # full suite; DB-gated integrations skip when Postgres unreachable
npm run check                # syntax gate across every module (CI enforces the same list)
```

## Environment files

- `.env` — your local values (gitignored).
- `.env.example` — template of record.
- Never commit real credentials; `.env.*` is gitignored except `.env.example`. Secrets in code are always `ref:` paths resolved through `packages/security/src/secrets.js`.

## Useful entry points

| Want to... | Run |
|---|---|
| Full suite | `npm test` |
| Live-PG integrations | `DATABASE_URL=<pooler-url> npm test` |
| Boot API locally | `node apps/api/src/server.js` (PORT env) |
| Perf baselines | `node scripts/perf-baseline.mjs` |
| Restore rehearsal | see header of `scripts/restore-rehearsal.mjs` |

## Conventions

- Zero-dependency runtime policy (exceptions require explicit approval, e.g. `pg`).
- ESM everywhere; `node --test`; no test frameworks.
- Every slice: code + tests (RED→GREEN) + docs + changelog + CI evidence. See `CONTRIBUTING.md`.
