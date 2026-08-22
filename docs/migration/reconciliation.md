# Migration Runbook

## Idempotent data migration

Command: `node scripts/migrate-data.mjs [--dry-run] [--source=docs/migration/SOURCE-SNAPSHOT-LEDGER.json]`

Outputs reconciliation report: transformed count, skipped count, target record count, SHA-256, balanced boolean.

Dry-run does not write to disk.

## Stop-the-line

- transformed count != target count
- SHA-256 mismatch between runs
- source ledger missing or invalid JSON
