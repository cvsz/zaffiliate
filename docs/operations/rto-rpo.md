# RPO and RTO

## Targets

- **RPO** (Recovery Point Objective): 5 minutes. Maximum acceptable data loss is five minutes of transactions.
- **RTO** (Recovery Time Objective): 30 minutes. Maximum acceptable downtime is thirty minutes from failure declaration to restored service.

## Backup frequency mapping

| Tier | Backup type | Frequency | Retention | RPO contribution |
|------|-------------|-----------|-----------|------------------|
| PostgreSQL | full + WAL archiving | continuous WAL, weekly full | 35 days | < 5 min via PITR |
| Object storage | versioned replication | continuous | 90 days | < 5 min |
| Configuration | source-controlled + IaC | per-commit | indefinite | 0 |
| Secrets | secret-management platform export | daily | 30 days | < 24 h (manual restore) |

## Recovery procedure

1. Declare incident and assign commander.
2. Provision replacement infrastructure from IaC (target < 10 min).
3. Restore latest backup into target database (target < 10 min).
4. Apply any pending migration via expand/migrate/contract.
5. Run reconciliation checkpoints against source-of-truth providers.
6. Verify health/readiness endpoints and synthetic transactions.
7. Cut DNS/load-balancer routing to new instance.
8. Post-incident: verify no data loss beyond RPO window.

## Drill frequency

Full restore drill must be executed quarterly and after every significant schema or topology change. Results must be recorded with elapsed time and data-loss delta.
