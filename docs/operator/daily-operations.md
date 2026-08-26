# Operator Handbook — Daily Operations

## Morning checklist

1. `curl -s https://zaffiliate.zeaz.dev/healthz` — 200 expected.
2. `/api/v1/analytics/overview` per active tenant — conversion/commission counters advancing.
3. `/metrics`: watch `zaffiliate_http_requests_total{status=~"5.."}` rate, webhook failure events, rate-limit hits.
4. CI on `main` green? `gh run list --branch main --limit 1` — a red main blocks all releases.
5. Supabase dashboard: DB CPU, connection count, storage growth trend.

## Routine operations

| Task | Command / route |
|---|---|
| Restart API (config/env change) | `sudo systemctl restart zaffiliate` |
| Tail structured logs | `journalctl -u zaffiliate -f` (JSON lines; secrets are redacted by logger) |
| Apply pending migrations | `DATABASE_URL=... node packages/db/src/cli.js` (migrator; drift fails closed) |
| Regenerate perf baseline | `node scripts/perf-baseline.mjs` |
| Backup | `scripts/backup.sh` (compose postgres) or pg_dump via container against pooler |
| Restore rehearsal (quarterly + pre-release) | see `scripts/restore-rehearsal.mjs` header comment |

## Watch items and thresholds

| Signal | Warn | Act |
|---|---|---|
| healthz p95 (in-process baseline) | > 2× recorded baseline (~56ms idle, ~86ms under flood) | check host load, restart, roll back last deploy |
| 5xx rate | > 0.5% over 10 min | incident-response.md |
| Webhook signature failures | sustained climb | possible provider misconfig or attack — provider-health.md |
| Rate-limited tenants | repeated 429s for one tenant | coordinate before raising limits |

## Change discipline

- All changes ship through PRs/commits with green CI; production deploys use the exact artifact that passed CI (immutable commit).
- After any deploy: observe error rate + latency for 15 minutes before leaving it unattended (see §74 of master spec).
