# Migration Rollback Classification

Per master-spec §42. Updated: 2026-08-25 · GM-B5.

Rules that override every row below:

1. **No automatic rollback is ever claimed.** Rollback is an operator decision executed by documented command.
2. A schema rollback never reverts external side effects (published provider content, sent outreach, emitted webhooks). Those require reconciliation, not DDL.
3. Any destructive rollback on data-bearing tables requires a fresh verified backup first (`scripts/backup.sh`; app-scope restore path per `scripts/restore-rehearsal.mjs` evidence).
4. Forward-fix is preferred over rollback once real tenant data exists under a migration's schema.

| Migration | Contents | Rollback safety | Data backfill | Compatibility window | Method |
|---|---|---|---|---|---|
| `001_core_tenant_rls.sql` | tenants/memberships/products/offers/links/audit tables, `app_current_tenant_id()`, RLS policies | **FORWARD_FIX_REQUIRED post-data.** Schema-only reversible while empty (`DROP TABLE ... CASCADE; DROP FUNCTION ...`) — destroys all tenant data if used after ingestion | n/a | Pre-data only | Empty-env: drop objects. Post-data: restore from backup instead |
| `002_workflow_outreach.sql` | creator_contacts, outreach_outbox, jobs, approvals, idempotency_records + policies | **FORWARD_FIX_REQUIRED post-data** (operational job/approval state lives here) | n/a | Pre-data only | Same policy as 001 |
| `003_billing_ai_analytics.sql` | ledger/billing/AI usage/analytics surfaces | **FORWARD_FIX_REQUIRED post-data** (financial records) | n/a | Pre-data only | Same policy as 001 |
| `004_canonical_analytics_types.sql` | widened `event_type` CHECK to canonical 17-type set | **FORWARD_FIX_REQUIRED once canonical rows exist**: old CHECK rejects canonical values, so reverting the constraint after canonical writes fails or orphans rows | none needed (widening only) | None required (additive widening) | Constraint revert only valid on pre-canonical data |
| `005_publication_jobs.sql` | publication_jobs table, dispatch index, RLS policy | **REVERSIBLE WHILE EMPTY** (`DROP TABLE publication_jobs CASCADE`). Post-publication: table holds orchestration state; dropping loses retry/DLQ state — backup then archive instead | n/a | Until first production publication job | Empty: drop. Post-data: backup + forward-fix |
| `006_tenants_rls_force.sql` | FORCE RLS + isolation policy on `tenants` | **SAFE** — pure hardening; no data touched. Revert = `DROP POLICY tenants_isolation ON tenants; ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;` | n/a | None required | Policy-only revert anytime |

## Rehearsal evidence backing this file

- Restore rehearsal (GM-B5): live Supabase dump → isolated postgres:17 → migration 006 applied forward onto restored snapshot with `pending=0 drift=0` — proves the release migrator is the supported "roll-forward" path on restored environments.
- The migrator itself refuses checksum drift fail-closed and applies each migration in its own transaction (`packages/db/src/migrator.js`, `test/db.test.js`).
