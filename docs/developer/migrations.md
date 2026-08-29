# Developer Handbook — Migrations

Files: `db/migrations/NNNN_name.sql` (4-digit prefix). Applied by the checksummed migrator (`packages/db/src/migrator.js`) inside one transaction per migration, recorded in `schema_migrations`.

## Rules

1. **Never edit an applied migration.** Checksums are verified; drift refuses to continue (fail-closed by design).
2. Add a new numbered file for every change; include RLS `ENABLE`+`FORCE` + isolation policy for any tenant-owned table.
3. Money = `numeric(20,6)` minor-unit discipline or integer minor units; CHECK constraints for non-negativity.
4. Classify rollback posture per master-spec §42 in `db/migrations/ROLLBACK.md` in the same commit.

## Workflow

```sh
# plan against any environment
DATABASE_URL=... node packages/db/src/cli.js          # applies pending, skips applied, refuses drift

# fresh-database proof (CI also does this)
docker run -d --name dev-pg -e POSTGRES_PASSWORD=dev -p 127.0.0.1:15432:5432 postgres:17-alpine
DATABASE_URL=postgresql://postgres:dev@127.0.0.1:15432/postgres node packages/db/src/cli.js
```

Both paths must succeed before merge (§40): fresh database AND existing release database.

## Restore-first mindset

Schema changes ship together with rehearsal capability: `scripts/restore-rehearsal.mjs` restores the app-scope archive into a clean Postgres and forward-applies migrations onto it (`pending=0 drift=0` is the pass condition). If your migration can't survive that drill, it isn't done.
