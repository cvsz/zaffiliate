# Alerts

Operational alert rules for the zaffiliate platform. Rules mirror the machine-readable definitions in `config/alerts.json`. Metric names use the `zaffiliate_` namespace emitted from the observability plane (`packages/observability` + `apps/api`).

## Rule index

| Name | Severity | Condition | Threshold | Window (s) | Evaluation interval | Stop-the-line | Runbook |
|------|----------|-----------|-----------|-----------|---------------------|---------------|---------|
| http_5xx_rate | warning | 5xx rate exceeds bound | 1 % | 300 | 60 s | false | docs/operations/upgrade-rollback.md |
| http_p99_latency | warning | p99 request latency exceeds bound | 500 ms | 300 | 60 s | false | docs/operations/capacity-model.md |
| readyz_false | critical | readiness probe down | 60 s | 120 | 30 s | true | docs/operations/rto-rpo.md |
| slo_budget_exhausted | warning | SLO error budget consumed | 0 | 3600 | 300 s | false | docs/SLO.md |
| memory_rss_growth | warning | RSS growth exceeds bound | 20 % | 3600 | 300 s | false | docs/operations/capacity-model.md |
| disk_usage | warning | disk utilization exceeds bound | 85 % | 300 | 60 s | false | docs/operations/backup-restore.md |
| queue_depth_high | warning | pending workflow jobs exceed bound | 5000 | 300 | 60 s | false | docs/operations/capacity-model.md |
| dead_letter_queue_not_empty | critical | any job in dead-letter queue | 0 | 300 | 60 s | true | docs/operations/upgrade-rollback.md |
| approval_pending_ttl_expiry | warning | approval pending TTL expired | 0 | 600 | 60 s | false | docs/operations/upgrade-rollback.md |
| webhook_replay_detected | critical | replayed/invalid webhook accepted | 0 | 300 | 60 s | true | docs/SECURITY.md |
| cross_tenant_access_violation | critical | cross-tenant data access observed | 0 | 300 | 60 s | true | docs/SECURITY.md |
| ledger_reconciliation_delta | critical | ledger reconciliation delta non-zero | 0 | 300 | 60 s | true | docs/operations/backup-restore.md |

## Rule details

### http_5xx_rate
- Severity: warning
- Description: Fraction of HTTP requests returning a 5xx status. Indicates platform errors, not provider/downstream errors (which are attributed to the offending adapter).
- Condition: `100 * sum by(instance) (rate(zaffiliate_http_requests_total{status=~"5.."}[5m])) / sum by(instance) (rate(zaffiliate_http_requests_total[5m])) > 1`
- Threshold: 1 %, window: 300 s, evaluation interval: 60 s
- Escalation path: post to `#oncall` (P3); review within 15 minutes; page on-call SRE if sustained above 5 %.
- Stop-the-line: false

### http_p99_latency
- Severity: warning
- Description: 99th percentile request latency. A leading indicator of user-visible performance degradation before error budget is consumed.
- Condition: `histogram_quantile(0.99, sum by(le) (rate(zaffiliate_http_request_duration_ms_bucket[5m]))) > 500`
- Threshold: 500 ms, window: 300 s, evaluation interval: 60 s
- Escalation path: post to `#oncall` (P3); review within 30 minutes; page if p99 > 1500 ms.
- Stop-the-line: false

### readyz_false
- Severity: critical
- Description: Health/readiness probe (`GET /readyz`, see `apps/api/src/server.js`) reports not-ready, meaning a required dependency (`DATABASE_URL`, `REDIS_URL`) is unreachable. Service is being drained from the load balancer.
- Condition: `zaffiliate_readyz_up{job="zaffiliate-api"} == 0`
- Threshold: probe down for > 60 s, window: 120 s, evaluation interval: 30 s
- Escalation path: page on-call SRE (P1) and auto-notify incident commander; target first response < 5 minutes.
- Stop-the-line: true

### slo_budget_exhausted
- Severity: warning
- Description: Monthly error budget for the API SLO (`docs/SLO.md`) is fully consumed. Release-acceleration gates must block; no further deployments until the next SLO window resets or budget is recovered.
- Condition: `zaffiliate_slo_error_budget_remaining{job="zaffiliate-api"} <= 0`
- Threshold: 0, window: 3600 s, evaluation interval: 300 s
- Escalation path: post to `#sre` and `#release`; block release gates; review within 15 minutes.
- Stop-the-line: false

### memory_rss_growth
- Severity: warning
- Description: Resident set size growth over a 1-hour sample exceeds 20 %, indicating a memory leak or unbounded buffer in the observability/metric store (see `MAX_BUFFERED_LINES`).
- Condition: `abs((zaffiliate_process_memory_rss_bytes - zaffiliate_process_memory_rss_bytes offset 1h) / zaffiliate_process_memory_rss_bytes offset 1h * 100) > 20`
- Threshold: 20 %, window: 3600 s, evaluation interval: 300 s
- Escalation path: post to `#oncall` (P3); review within 30 minutes; page if growth > 50 %.
- Stop-the-line: false

### disk_usage
- Severity: warning
- Description: Disk utilization for the active volume (logs/local temp per capacity model) exceeds 85 %. Page at > 95 %.
- Condition: `100 * (zaffiliate_disk_used_bytes / zaffiliate_disk_total_bytes) > 85`
- Threshold: 85 %, window: 300 s, evaluation interval: 60 s
- Escalation path: post to `#infra` (P3); review within 30 minutes; page on-call SRE if > 95 %.
- Stop-the-line: false

### queue_depth_high
- Severity: warning
- Description: Workflow engine pending-job queue depth exceeds 5000, signalling insufficient workers for the declared capacity model. Scale trigger from `docs/operations/capacity-model.md`.
- Condition: `zaffiliate_workflow_queue_depth > 5000`
- Threshold: 5000 jobs, window: 300 s, evaluation interval: 60 s
- Escalation path: post to `#oncall` (P3); add workers; review within 15 minutes.
- Stop-the-line: false

### dead_letter_queue_not_empty
- Severity: critical
- Description: One or more jobs entered the workflow dead-letter queue, breaching the 99.99 % accepted-job durability SLO. Potential job/data loss.
- Condition: `zaffiliate_workflow_dead_letter_count > 0`
- Threshold: 0 (any), window: 300 s, evaluation interval: 60 s
- Escalation path: page on-call SRE (P2); investigate within 15 minutes; initiate DLQ drain runbook.
- Stop-the-line: true

### approval_pending_ttl_expiry
- Severity: warning
- Description: A bound approval expired its pending TTL (fail-closed), blocking an approval gate. Not an approval bypass (that is zero-tolerance), but indicates stalled workflow or oversized TTL.
- Condition: `zaffiliate_workflow_approval_expired_total - zaffiliate_workflow_approval_expired_total offset 1m > 0`
- Threshold: 0 (any), window: 600 s, evaluation interval: 60 s
- Escalation path: post to `#oncall` and workflow owner (P3); review within 1 hour.
- Stop-the-line: false

### webhook_replay_detected
- Severity: critical
- Description: A replayed or invalid-signature webhook was detected and blocked. Zero-tolerance invariant per `docs/SLO.md`; any accepted replay is a stop-the-line incident.
- Condition: `zaffiliate_webhook_replay_blocked_total - zaffiliate_webhook_replay_blocked_total offset 5m > 0`
- Threshold: 0 (any), window: 300 s, evaluation interval: 60 s
- Escalation path: page on-call SRE + security lead (P1); halt deploys; investigate source.
- Stop-the-line: true

### cross_tenant_access_violation
- Severity: critical
- Description: Cross-tenant data access observed (RLS isolation breach). Zero-tolerance invariant; immediate isolation and incident response.
- Condition: `zaffiliate_security_cross_tenant_access_total - zaffiliate_security_cross_tenant_access_total offset 5m > 0`
- Threshold: 0 (any), window: 300 s, evaluation interval: 60 s
- Escalation path: page on-call SRE + security lead (P1); halt deploys; run isolation runbook in `docs/SECURITY.md`.
- Stop-the-line: true

### ledger_reconciliation_delta
- Severity: critical
- Description: Financial/commission ledger reconciliation delta is non-zero. Zero-tolerance invariant; halt cutover/release gates until resolved.
- Condition: `abs(zaffiliate_ledger_reconciliation_delta) != 0`
- Threshold: 0, window: 300 s, evaluation interval: 60 s
- Escalation path: page on-call SRE + billing/finance lead (P1); halt cutover; run reconciliation tooling.
- Stop-the-line: true

## Notes

- All `zaffiliate_*` metrics are emitted by the observability plane (`packages/observability/src/index.js`) and the API (`apps/api/src/server.js:25`).
- `readyz_false` is backed by `readiness()` in `apps/api/src/server.js`, which fails when `DATABASE_URL` or `REDIS_URL` is unset.
- Zero-tolerance invariants and stop-the-line policy are defined in `docs/SLO.md`.
