# Capacity Model

## Baseline assumptions

- Expected steady-state QPS: 500 requests per second at peak.
- Memory per request: 2 MB (request body, provider response, tracing context).
- Database connection pool size: 50 connections per application instance.
- Redis maxmemory policy: `allkeys-lru` with `maxmemory` set to 4 GB.

## Scaling triggers

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| API QPS | > 400 for 5 min | > 600 for 2 min | scale API workers |
| P95 latency | > 500 ms | > 1 s | scale API + DB |
| DB connections | > 35 (70%) | > 45 (90%) | add read replica |
| Redis memory | > 3.2 GB (80%) | > 3.6 GB (90%) | scale Redis / evict cold keys |
| Queue depth | > 5 000 jobs | > 20 000 jobs | add workers |
| Provider error rate | > 2% | > 5% | apply circuit breaker + retry |

## Resource budget per instance

- CPU: 2 vCPU reserved, 4 vCPU burst.
- Memory: 4 GB reserved, 8 GB burst.
- Disk: 20 GB SSD for logs and local temp.

## Headroom policy

Capacity planning must maintain 30% headroom at declared peak. Load/soak tests must validate at peak + 50% before production cutover.
