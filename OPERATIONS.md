# Operations and Production Readiness

## SLO baseline

Define per-surface SLOs before production traffic: API availability/latency, webhook acceptance/delivery, durable job completion, token refresh success, outreach delivery, billing reconciliation and background queue age. Alert on user-visible symptoms and error-budget burn, not only host metrics.

## Required telemetry

- structured logs with `tenant_id`, `request_id`, `correlation_id`, `job_id`, actor and platform account identifiers where non-sensitive;
- RED metrics for APIs and USE metrics for infrastructure;
- traces across API -> DB/outbox -> worker -> platform adapter;
- immutable audit events for privileged/mutating operations;
- dashboards for platform quota/rate-limit pressure, webhook lag, DLQ depth, token-refresh failures and billing reconciliation.

## Runbooks

Required before cutover:

1. platform API outage / elevated 429s;
2. OAuth/token refresh storm;
3. webhook signature failures or replay spike;
4. queue backlog/DLQ growth;
5. billing/ledger mismatch;
6. database failover/restore;
7. secret exposure/credential rotation;
8. bad release rollback;
9. tenant isolation incident;
10. provider/LLM cost anomaly.

## Backup and DR

- PostgreSQL: scheduled full + PITR-capable backups where supported.
- Object storage: versioning/retention for business evidence.
- Configuration: IaC and sanitized config are source-controlled; secrets are backed up only through the secret-management platform.
- Legacy repositories: mirror clone + verified git bundle + SHA-256 manifest before archive/delete.

Target RPO/RTO must be declared per environment and proven with restore drills. A backup that has not been restored successfully is not a deletion gate.

## Release strategy

Use immutable build artifacts and environment promotion. Prefer canary/blue-green deployment for API/workers. Database changes follow expand/migrate/contract. Feature flags isolate newly migrated capabilities. Do not run legacy and canonical workers concurrently against the same mutating workload unless idempotency ownership is explicitly partitioned.

## Rollback

Rollback preserves data compatibility. Application rollback must not require reversing destructive schema changes. Cutover routing must be reversible independently of deployment. Data migration requires reconciliation checkpoints and a documented reverse-sync/restore strategy during the migration window.

## Capacity and quotas

Enforce tenant and platform quotas centrally. Monitor queue depth, worker saturation, API quota consumption, database connections and external-provider concurrency. Autoscaling is bounded by upstream quota and cost budgets.

## Operational readiness gate

Production cutover requires: green CI, release artifact provenance, successful staging soak, load test at expected peak + safety margin, backup/restore drill, alert delivery verification, runbook exercise, on-call ownership, zero unresolved high/critical security defects, migration reconciliation at 100%, and rollback rehearsal.
