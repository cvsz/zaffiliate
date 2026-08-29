# Backup and Restore Runbook

## Dry-run plan

Command: `node scripts/backup-restore-drill.mjs`

Outputs the drill plan and writes `dist/backup-restore-drill-evidence.json` with planned=true.

## Execute drill

Command: `node scripts/backup-restore-drill.mjs --run`

Requires `pg_dump` available on PATH. Performs pg_dump of zaffiliate_test, computes SHA-256, and writes evidence.

## Validate restore

After restore, run:
- `psql -v ON_ERROR_STOP=1 -f db/tests/rls.sql`
- `psql -v ON_ERROR_STOP=1 -f db/tests/durable-workflow.sql`
- `psql -v ON_ERROR_STOP=1 -f db/tests/billing-ai-analytics.sql`

## Rollback

Restore previous backup artifact and re-run validation SQL.

## Stop-the-line

- pg_dump or restore exits non-zero
- validation SQL exits non-zero
- SHA-256 mismatch between backup and restored artifact
