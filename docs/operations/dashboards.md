# Dashboards

Dashboard configuration reference for the zaffiliate platform. Panels mirror the machine-readable definitions in `config/dashboards.json`. Metric names use the `zaffiliate_` namespace; target `expr` values are PromQL-compatible snapshots usable in Grafana (or imported into Graylog, Prometheus, etc.).

## Layout

Recommended dashboard rows, ordered top-to-bottom:

| Row | Order | Panels |
|-----|-------|--------|
| Overview | 1 | HTTP Request Rate, HTTP Error Rate, HTTP Latency Histogram |
| SLO | 2 | SLO Budget Remaining, SLO Success Ratio |
| Workflow | 3 | Workflow Queue Depth, Dead-Letter Queue Count, Approval Wait Time, Outbox Lag |
| Security | 4 | Cross-Tenant Access Count, Webhook Replay Attempts |
| Infrastructure | 5 | Memory RSS, Database Connection Pool, Redis Hit Rate, Disk Usage |

## Overview

### HTTP Request Rate
- Type: `timeseries`
- Description: Inbound request rate, split by route.
```json
{
  "title": "HTTP Request Rate",
  "type": "timeseries",
  "targets": [
    {
      "refId": "A",
      "expr": "sum by(route) (rate(zaffiliate_http_requests_total[5m]))",
      "legendFormat": "{{route}}",
      "title": "requests per second"
    }
  ],
  "position": { "row": "Overview", "x": 0, "y": 0, "w": 6, "h": 6 }
}
```

### HTTP Error Rate
- Type: `timeseries`
- Description: 5xx error rate by route and status.
```json
{
  "title": "HTTP Error Rate",
  "type": "timeseries",
  "targets": [
    {
      "refId": "A",
      "expr": "sum by(route, status) (rate(zaffiliate_http_requests_total{status=~\"5..\"}[5m]))",
      "legendFormat": "{{route}} {{status}}",
      "title": "5xx requests per second"
    }
  ],
  "position": { "row": "Overview", "x": 6, "y": 0, "w": 6, "h": 6 }
}
```

### HTTP Latency Histogram
- Type: `heatmap`
- Description: p99 latency (line) over request-duration buckets (heatmap).
```json
{
  "title": "HTTP Latency Histogram",
  "type": "heatmap",
  "targets": [
    {
      "refId": "A",
      "expr": "sum by(le) (rate(zaffiliate_http_request_duration_ms_bucket[5m]))",
      "legendFormat": "{{le}}",
      "title": "request duration (ms) buckets"
    },
    {
      "refId": "B",
      "expr": "histogram_quantile(0.99, sum by(le) (rate(zaffiliate_http_request_duration_ms_bucket[5m])))",
      "legendFormat": "p99",
      "title": "p99 latency"
    }
  ],
  "position": { "row": "Overview", "x": 0, "y": 6, "w": 6, "h": 6 }
}
```

## SLO

### SLO Budget Remaining
- Type: `gauge`
- Description: Remaining monthly error budget for the API SLO. Drains toward 0; gates release acceleration.
```json
{
  "title": "SLO Budget Remaining",
  "type": "gauge",
  "targets": [
    {
      "refId": "A",
      "expr": "zaffiliate_slo_error_budget_remaining",
      "legendFormat": "budget",
      "title": "remaining error budget"
    }
  ],
  "position": { "row": "SLO", "x": 0, "y": 12, "w": 6, "h": 6 }
}
```

### SLO Success Ratio
- Type: `stat`
- Description: Rolling success ratio against the API SLO target.
```json
{
  "title": "SLO Success Ratio",
  "type": "stat",
  "targets": [
    {
      "refId": "A",
      "expr": "zaffiliate_slo_success_ratio",
      "legendFormat": "success_ratio",
      "title": "rolling success ratio"
    }
  ],
  "position": { "row": "SLO", "x": 6, "y": 12, "w": 6, "h": 6 }
}
```

## Workflow

### Workflow Queue Depth
- Type: `timeseries`
- Description: Pending workflow jobs awaiting a worker.
```json
{
  "title": "Workflow Queue Depth",
  "type": "timeseries",
  "targets": [
    {
      "refId": "A",
      "expr": "zaffiliate_workflow_queue_depth",
      "legendFormat": "queue_depth",
      "title": "pending jobs"
    }
  ],
  "position": { "row": "Workflow", "x": 0, "y": 18, "w": 6, "h": 6 }
}
```

### Dead-Letter Queue Count
- Type: `stat`
- Description: Jobs that exhausted retry/backoff and entered the dead-letter queue.
```json
{
  "title": "Dead-Letter Queue Count",
  "type": "stat",
  "targets": [
    {
      "refId": "A",
      "expr": "zaffiliate_workflow_dead_letter_count",
      "legendFormat": "dead_letter",
      "title": "dead-letter jobs"
    }
  ],
  "position": { "row": "Workflow", "x": 6, "y": 18, "w": 6, "h": 6 }
}
```

### Approval Wait Time
- Type: `timeseries`
- Description: Time approvals have been pending; compared against bounded-approval TTL.
```json
{
  "title": "Approval Wait Time",
  "type": "timeseries",
  "targets": [
    {
      "refId": "A",
      "expr": "zaffiliate_workflow_approval_wait_seconds",
      "legendFormat": "approval_wait_seconds",
      "title": "seconds awaiting approval"
    }
  ],
  "position": { "row": "Workflow", "x": 0, "y": 24, "w": 6, "h": 6 }
}
```

### Outbox Lag
- Type: `timeseries`
- Description: Unsynced domain events in the transactional outbox.
```json
{
  "title": "Outbox Lag",
  "type": "timeseries",
  "targets": [
    {
      "refId": "A",
      "expr": "zaffiliate_workflow_outbox_lag",
      "legendFormat": "outbox_lag",
      "title": "unpublished domain events"
    }
  ],
  "position": { "row": "Workflow", "x": 6, "y": 24, "w": 6, "h": 6 }
}
```

## Security

### Cross-Tenant Access Count
- Type: `timeseries`
- Description: Rate of cross-tenant access violations (RLS isolation metric).
```json
{
  "title": "Cross-Tenant Access Count",
  "type": "timeseries",
  "targets": [
    {
      "refId": "A",
      "expr": "increase(zaffiliate_security_cross_tenant_access_total[5m])",
      "legendFormat": "violations",
      "title": "cross-tenant access attempts"
    }
  ],
  "position": { "row": "Security", "x": 0, "y": 30, "w": 6, "h": 6 }
}
```

### Webhook Replay Attempts
- Type: `timeseries`
- Description: Replayed/invalid-signature webhooks blocked by the webhook replay guard.
```json
{
  "title": "Webhook Replay Attempts",
  "type": "timeseries",
  "targets": [
    {
      "refId": "A",
      "expr": "increase(zaffiliate_webhook_replay_blocked_total[5m])",
      "legendFormat": "replays_blocked",
      "title": "replay attempts blocked"
    }
  ],
  "position": { "row": "Security", "x": 6, "y": 30, "w": 6, "h": 6 }
}
```

## Infrastructure

### Memory RSS
- Type: `timeseries`
- Description: Per-instance process resident set size.
```json
{
  "title": "Memory RSS",
  "type": "timeseries",
  "targets": [
    {
      "refId": "A",
      "expr": "zaffiliate_process_memory_rss_bytes",
      "legendFormat": "{{instance}}",
      "title": "resident set size (bytes)"
    }
  ],
  "position": { "row": "Infrastructure", "x": 0, "y": 36, "w": 6, "h": 6 }
}
```

### Database Connection Pool
- Type: `gauge`
- Description: Used connections as a percentage of the configured pool max.
```json
{
  "title": "Database Connection Pool",
  "type": "gauge",
  "targets": [
    {
      "refId": "A",
      "expr": "100 * zaffiliate_db_connections_used / zaffiliate_db_connections_max",
      "legendFormat": "pool_utilization_percent",
      "title": "connection pool utilization"
    }
  ],
  "position": { "row": "Infrastructure", "x": 6, "y": 36, "w": 6, "h": 6 }
}
```

### Redis Hit Rate
- Type: `gauge`
- Description: Redis cache hit rate as a percentage.
```json
{
  "title": "Redis Hit Rate",
  "type": "gauge",
  "targets": [
    {
      "refId": "A",
      "expr": "100 * zaffiliate_redis_hits_total / (zaffiliate_redis_hits_total + zaffiliate_redis_misses_total)",
      "legendFormat": "hit_rate_percent",
      "title": "cache hit rate"
    }
  ],
  "position": { "row": "Infrastructure", "x": 0, "y": 42, "w": 6, "h": 6 }
}
```

### Disk Usage
- Type: `gauge`
- Description: Disk utilization as a percentage of total volume capacity.
```json
{
  "title": "Disk Usage",
  "type": "gauge",
  "targets": [
    {
      "refId": "A",
      "expr": "100 * (zaffiliate_disk_used_bytes / zaffiliate_disk_total_bytes)",
      "legendFormat": "disk_used_percent",
      "title": "disk utilization"
    }
  ],
  "position": { "row": "Infrastructure", "x": 6, "y": 42, "w": 6, "h": 6 }
}
```

## Grid notes

- Two panels per row (`w: 6` each); 12-column grid.
- `y` is an absolute baseline for the top of each row block (Overview 0, SLO 12, Workflow 18, Infrastructure 36, Security 30).
- The Security row is placed immediately above Infrastructure for operator visibility of zero-tolerance signals.
