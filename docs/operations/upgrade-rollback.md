# Upgrade and Rollback Procedure

## Pre-flight checks

1. Confirm CI green on release candidate SHA.
2. Verify release artifact provenance (signed tag, SBOM).
3. Snapshot current database state and verify backup is restorable.
4. Announce maintenance window to stakeholders.

## Upgrade steps

1. Pull latest container image and verify digest matches release manifest.
2. Deploy canary instance behind feature flag; verify smoke tests.
3. Run database migrations in expand/migrate/contract order.
4. Execute reconciliation checkpoints for migrated data.
5. Shift traffic to new instance in 10% increments; monitor SLOs at each step.
6. When 100% traffic is healthy, promote new instance to primary.
7. Retire legacy instance only after observation gate passes.

## Rollback triggers

Rollback is automatic if:
- error rate exceeds 5% within 5 minutes of traffic shift;
- P95 latency exceeds 1.5x baseline for 3 consecutive minutes;
- reconciliation checkpoint reports mismatch > 0.01%;
- health check fails for > 1 minute.

## Rollback steps

1. Cut traffic back to last known-good instance (reversible routing).
2. If database migration was destructive, restore from pre-migration snapshot.
3. Verify health/readiness on rolled-back instance.
4. Run synthetic transactions against rolled-back service.
5. File incident report with root cause and fix timeline.
6. Do not re-attempt upgrade until incident is resolved and root cause is understood.

## Database migration rules

- Migrations must be backward-compatible during the window.
- No migration may drop or rename columns/constraints until the previous version is fully retired.
- Each migration must have a documented rollback SQL path.
