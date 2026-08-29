# EP-11 Production Infrastructure Execution Plan

Step-by-step guide to execute the EP-11 validation harnesses against real production-like infrastructure. This plan gates the cutover of the canonical `zaffiliate` runtime onto the staging cluster and is the runtime counterpart to the threat model in `docs/security/threat-model.md`.

Updated: 2026-08-22

---

## 0. Scope and gates

This execution plan exercises eight validation surfaces against a staging cluster that mirrors production topology (same schema, same provider integrations, same observability plane). The gates must pass in sequence; any stop-the-line condition halts the run and triggers the per-step rollback below.

| Gate | Surface | Artifact | Stop-the-line |
|------|---------|----------|---------------|
| 0 | Runtime deploy | Deployment manifest | Health/readiness not green |
| 1 | Postgres RLS negative tests | `db/tests/rls.sql` | Any assertion failure |
| 2 | Adapter contract tests (sandbox) | `test/adapters-marketplace.test.js` | Any provider contract failure |
| 3 | Load test | `dist/load-test-evidence.json` | p99 > 500ms or errorRate > 1% |
| 4 | Soak test | `dist/soak-test-evidence.json` | memoryGrowth > 20% or successRate < 99.9% |
| 5 | Fault injection | stdout JSON | recovery rate < 100% or recovery > 5s |
| 6 | Backup/restore DR drill | `dist/backup-restore-drill-evidence.json` | non-zero exit or SHA-256 mismatch |
| 7 | E2E smoke | `test/e2e.test.js` | Any failing subtest |

---

## 1. Prerequisites

### Access and environment

- [ ] Staging cluster reachable from the operator workstation (VPN / private network) with kubectl/API access.
- [ ] `DATABASE_URL` pointing at the staging PostgreSQL (16+) instance; the instance must have RLS enabled on all tenant-scoped tables.
- [ ] `REDIS_URL` pointing at the staging Redis 7+ instance.
- [ ] Monitoring stack online: Prometheus (scraping `zaffiliate_*` metrics) and Grafana dashboards loaded from `config/dashboards.json` (15 panels). Alert rules loaded from `config/alerts.json` (12 rules).
- [ ] Sandbox credentials for every provider adapter under test (TikTok, Shopee, Lazada, LINE, etc.) — read-only where possible.
- [ ] Load generator host with Node.js 22 runtime and a container runtime (Docker or containerd) available.
- [ ] A PostgreSQL client (`psql` 16+) on the operator path with `ON_ERROR_STOP` support.

### Database state

- [ ] Staging database is seeded with anonymized test data representing at least one full tenant lifecycle (products, links, orders, commissions, invoices).
- [ ] The `zaffiliate_app_test` database role exists and is mapped to the RLS session role used by `db/tests/rls.sql`.
- [ ] A pre-execution backup artifact exists and is verified restorable (see Gate 6).

### Test data isolation

- All test data uses tenant UUIDs in the `00000000-0000-0000-0000-*` reserved range.
- No production PII is present in the staging dataset. Data is anonymized per `docs/migration/reconciliation.md`.

---

## 2. Infrastructure requirements

### Minimum node specs

| Resource | Minimum | Production-like target |
|----------|---------|------------------------|
| CPU | 2 vCPU reserved / 4 vCPU burst | 4 vCPU reserved |
| RAM | 4 GB reserved / 8 GB burst | 8 GB reserved |
| Disk | 20 GB SSD (logs + temp) | 50 GB SSD, 30% headroom |
| Network | 1 Gbps, latency < 5 ms to DB/Redis | 10 Gbps, < 2 ms |

### Service versions

| Component | Required |
|-----------|----------|
| PostgreSQL | 16+ with RLS, row-level policies, and `pg_dump` 16+ |
| Redis | 7+ (`allkeys-lru`, `maxmemory` 4 GB) |
| Node.js | 22.x (`node --test` harness compatibility) |
| Container runtime | Docker 24+ or containerd 1.7+ |
| psql client | 16+ with `ON_ERROR_STOP` support |

### Observability

- Prometheus scraping `/metrics` on the API process; metrics namespace `zaffiliate_*`.
- Grafana dashboards loaded from `config/dashboards.json`.
- Alert rules from `config/alerts.json` firing into the on-call channel.
- `packages/observability/src/index.js` emitting structured logs, metrics, and traces with PII/secret redaction per `docs/security/threat-model.md`.

---

## 3. Step-by-step execution

### Step 0 — Deploy canonical runtime to staging

Deploy the canonical runtime build to the staging cluster and confirm it is healthy before executing any validation gate.

```bash
# Build and push the release candidate image; digest is recorded in the release manifest
node scripts/generate-release-manifest.mjs --sha <RELEASE_CANDIDATE_SHA>

# Deploy to staging (image digest verified)
kubectl set image deployment/zaffiliate-api \
  zaffiliate-api=zaffiliate:<IMAGE_DIGEST> \
  --namespace=zaffiliate-staging

# Confirm deployment rolls out
kubectl rollout status deployment/zaffiliate-api --namespace=zaffiliate-staging --timeout=300s
```

**Verification:**

```bash
STAGING_HOST=$(kubectl get svc zaffiliate-api -n zaffiliate-staging -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
curl -sf "http://${STAGING_HOST}:8080/healthz"   # expect: {"ok":true,"service":"zaffiliate-api"}
curl -sf "http://${STAGING_HOST}:8080/readyz"    # expect: {"ready":true,"missing":[]}
```

**Evidence:** `dist/deploy-staging-evidence.txt` — capture `kubectl rollout status` and both probe responses with timestamp.

**Stop-the-line:** Rollout does not complete within 300s, or `/healthz` or `/readyz` does not return the expected response.

**Rollback:** `kubectl rollout undo deployment/zaffiliate-api --namespace=zaffiliate-staging` and confirm probes recover.

---

#### Step 0.5 — Run Postgres RLS negative tests

Execute the cross-tenant isolation suite against the staging database. RLS policies must reject inserts from one tenant into another tenant's partition and enforce tenant-scoped visibility.

```bash
# Configure environment for the test role and tenant context
export PGSSLMODE=require
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/rls.sql
```

The script in `db/tests/rls.sql` performs:

1. Inserts two tenants (`tenant-a`, `tenant-b`) with UUIDs in the reserved test range.
2. Sets the session role to `zaffiliate_app_test` and the `app.tenant_id` GUC to tenant A.
3. Confirms tenant A can insert a product and sees exactly 1 product.
4. Attempts a cross-tenant insert for tenant B's partition — expects `insufficient_privilege`.
5. Confirms tenant B sees 0 products (no cross-tenant read leakage).

**Evidence:** `dist/rls-test-evidence.log` — full `psql` stdout/stderr with `\set ON_ERROR_STOP on`. The script wraps in `BEGIN`/`ROLLBACK` so no test data persists.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/rls.sql \
  > dist/rls-test-evidence.log 2>&1
```

**Pass criteria:** Exit code 0; no `RAISE EXCEPTION` messages; output confirms `tenant A expected 1 visible product` and `tenant B must not see tenant A product`.

**Stop-the-line:** Non-zero exit, cross-tenant insert succeeds, or visibility count differs from expected.

**Rollback:** This step is read-only (uses `ROLLBACK`); no rollback action required. To re-run after fixing policy, re-apply the RLS migration from `db/migrations/` and re-execute.

---

### Step 1 — Run adapter contract tests against sandbox providers

Execute the provider adapter contract suite against sandbox credentials to validate signing determinism, idempotency, consent suppression, and fail-closed error handling.

```bash
# Ensure sandbox credentials are injected from the secret manager
export TIKTOK_VERIFY_TOKEN=$(secret-manager get ztsaff/TIKTOK_VERIFY_TOKEN --format=raw)
export LINE_CHANNEL_SECRET=$(secret-manager get zlttbots/LINE_CHANNEL_SECRET --format=raw)
export SHOPEE_PARTNER_KEY=$(secret-manager get zlttbots/SHOPEE_PARTNER_KEY --format=raw)
export LAZADA_APP_SECRET=$(secret-manager get zlttbots/LAZADA_APP_SECRET --format=raw)

node --test test/adapters-marketplace.test.js 2>&1 | tee dist/adapter-contract-evidence.log
```

This test file (`test/adapters-marketplace.test.js`) validates:

- Shopee signature determinism over path + timestamp + partnerId + body; rejects tampering.
- Shopee client signs every request with unix-second timestamps; gates affiliate links with idempotency keys.
- Lazada signing concatenates sorted keys with HMAC-SHA256; rejects tampering.
- Publishing adapter fails closed on inline secrets, unsupported platforms, missing approval/idempotency, and invalid content shape.
- LINE adapter suppresses messaging without granted consent; validates webhook signature with timing-safe base64 HMAC comparison.
- Token bucket bursts then throttles with `retryAfterMs`.
- Provider error normalization maps per-platform retryability (Shopee `error_ratelimit` → retryable; Lazada code `13` → non-retryable, etc.).

**Evidence:** `dist/adapter-contract-evidence.log` — full `node --test` output.

**Pass criteria:** All subtests pass; exit code 0.

**Stop-the-line:** Any subtest fails or `PublishingProviderError` / `LineConsentSuppressedError` / `ShopeeProviderError` behaves incorrectly.

**Rollback:** No data mutation; revert sandbox credential to previous value via `secret-manager` and re-run. See `docs/closure/ep01-credential-rotation.md` Section C for credential rollback.

---

### Step 2 — Run load test with production-like concurrency

Execute the load test against the deployed staging API at production-like concurrency. The load test (`scripts/load-test.mjs`) issues concurrent `GET /healthz` requests and records a latency histogram.

```bash
TARGET="http://${STAGING_HOST}:8080" \
node scripts/load-test.mjs \
  --concurrency=100 \
  --durationMs=30000 \
  --target="$TARGET" 2>&1 | tee dist/load-test-evidence.json
```

The harness emits JSON with: `target`, `concurrency`, `durationMs`, `requests`, `errors`, `errorRate`, `p50`, `p95`, `p99`, `min`, `max`.

**Evidence:** `dist/load-test-evidence.json` — machine-readable JSON snapshot captured at end of run.

**Pass criteria (from `docs/operations/load-soak.md`):**

| Metric | Threshold |
|--------|-----------|
| p99 latency | <= 500 ms |
| errorRate | <= 1% |

**Stop-the-line:** p99 > 500ms or errorRate > 1%. Additionally, any critical alert from `config/alerts.json` (e.g., `http_5xx_rate > 1%`, `readyz_false`, `cross_tenant_access_violation`) firing during the run.

**Rollback:** No runtime mutation. If thresholds are exceeded, do not advance to the soak test. Investigate capacity per `docs/operations/capacity-model.md` and re-run at a lower concurrency to isolate the regression.

---

### Step 3 — Run soak test (minimum 1 hour)

Execute the soak test against the deployed staging API for a minimum of 1 hour, continuously sampling process memory and event-loop lag.

```bash
TARGET="http://${STAGING_HOST}:8080" \
node scripts/soak-test.mjs \
  --durationMs=3600000 \
  --sampleIntervalMs=1000 \
  --target="$TARGET" 2>&1 | tee dist/soak-test-evidence.json
```

The harness (`scripts/soak-test.mjs`) samples `GET /healthz` every `sampleIntervalMs` and records `at`, `status`, `latencyMs`, and `rss` per sample. At completion it emits: `samples`, `successRate`, `memoryGrowth`, `eventLoopLagP95`, `baselineRss`, `peakRss`.

**Evidence:** `dist/soak-test-evidence.json` — JSON snapshot captured at end of run.

**Pass criteria (from `docs/operations/load-soak.md`):**

| Metric | Threshold |
|--------|-----------|
| successRate | >= 99.9% |
| memoryGrowth | <= 20% (peak RSS vs baseline) |
| eventLoopLagP95 | < 500 ms (inferred from `docs/operations/capacity-model.md` P95 latency trigger) |

**Stop-the-line:** memoryGrowth > 20% or successRate < 99.9%, or any zero-tolerance invariant violated during the run window (cross-tenant access, webhook replay, ledger reconciliation delta non-zero).

**Rollback:** Stop the soak test (`Ctrl+C`), revert the runtime image to the previous known-good digest (`kubectl set image`), and confirm metrics return to baseline via Grafana dashboards in `config/dashboards.json`.

---

### Step 4 — Run fault injection against staged infrastructure

Execute the fault injection harness against the staged infrastructure with all scenarios. The harness (`scripts/fault-inject.mjs`) supports scenarios: `db`, `redis`, `ai`, `all`. With `--scenario=all`, it runs each scenario sequentially.

```bash
node scripts/fault-inject.mjs --scenario=all --durationMs=10000 2>&1 | tee dist/fault-inject-evidence.json
```

The harness emits JSON with: `scenario`, `durationMs`, `injectedFailures`, `recovered`, `recoveryDurationMs`, and `pass`.

**Evidence:** `dist/fault-inject-evidence.json` — JSON snapshot captured at end of run.

**Pass criteria (from `docs/operations/fault-injection.md`):**

| Metric | Threshold |
|--------|-----------|
| recovery rate | 100% (recovered === injectedFailures) |
| recoveryDurationMs | <= 5000 ms |

**Stop-the-line:** recovery rate < 100%, recovery time > 5s, or any unhandled exception during injection. Per `docs/security/threat-model.md` attack tree "Provider outage and rate-limit exercise", a `redis` failure must trigger circuit-breaker retry behavior and a `db` failure must preserve idempotency.

**Rollback:** Revert the runtime image to the previous digest and confirm all dependency health probes (`readyz`) return green. Re-run the fault injection at a shorter window to confirm recovery.

---

### Step 5 — Run backup/restore DR drill

Execute the backup-restore drill against the staged PostgreSQL and Redis instances. This verifies backup artifact creation, SHA-256 integrity, and restore validation.

```bash
# Dry-run first to confirm pg_dump is available
node scripts/backup-restore-drill.mjs 2>&1 | tee dist/backup-drill-plan.json

# Execute the drill
node scripts/backup-restore-drill.mjs --run 2>&1 | tee dist/backup-restore-drill-evidence.json
```

The harness (`scripts/backup-restore-drill.mjs`) with `--run`:

1. Creates `backups/` directory.
2. Runs `pg_dump zaffiliate_test -f backups/schema.sql`.
3. Computes SHA-256 of `backups/schema.sql` and writes `dist/backup-restore-drill-evidence.json` with `planned`, `executed`, `pgDumpAvailable`, `sha256`.
4. The plan lists `pg_dumpall`, `pg_dump`, and `redis-cli BGSAVE + cp dump.rdb` as backup commands; `psql -f` for restore; and validation SQL including `db/tests/rls.sql`, `db/tests/durable-workflow.sql`, and `db/tests/billing-ai-analytics.sql`.

**Evidence:**

- `dist/backup-restore-drill-evidence.json` — drill execution report with SHA-256.
- `backups/schema.sql` — the dump artifact.
- `dist/backup-sha256.log` — manual `sha256sum backups/schema.sql` for cross-check.

```bash
sha256sum backups/schema.sql > dist/backup-sha256.log
```

**Validate restore** (per `docs/operations/backup-restore.md`):

After restoring the dump into a clean database, run the validation SQL:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/durable-workflow.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/billing-ai-analytics.sql
```

**Pass criteria:**

| Criterion | Threshold |
|-----------|-----------|
| pg_dump exit code | 0 |
| SHA-256 match | backup artifact SHA matches `dist/backup-restore-drill-evidence.json` |
| validation SQL exit code | 0 |

**Stop-the-line:** pg_dump or restore exits non-zero, validation SQL exits non-zero, or SHA-256 mismatch between backup and restored artifact.

**Rollback:** Restore the pre-drill database state from the most recent verified backup (see `docs/operations/rto-rpo.md` recovery procedure). Revert the runtime image if the drill corrupted state.

---

#### Step 5.5 — Run reconciliation checkpoints

After the backup/restore drill, verify no data loss beyond the RPO window by running reconciliation checkpoints against source-of-truth providers.

```bash
node scripts/reconcile.mjs --dataset=commissions 2>&1 | tee dist/reconcile-commissions-evidence.json
node scripts/reconcile.mjs --dataset=billing 2>&1 | tee dist/reconcile-billing-evidence.json
node scripts/reconcile.mjs --dataset=webhooks 2>&1 | tee dist/reconcile-webhooks-evidence.json
```

The reconciliation harness (`scripts/reconcile.mjs`) compares recorded totals against attributed totals per dataset and computes a delta. It writes evidence to `dist/reconcile-<dataset>-evidence.json` with a `sha256` checksum.

**Evidence:** `dist/reconcile-commissions-evidence.json`, `dist/reconcile-billing-evidence.json`, `dist/reconcile-webhooks-evidence.json`.

**Pass criteria:** `balanced === true` (delta === 0) for all three datasets. See `docs/migration/reconciliation.md` for data source-of-truth alignment.

**Stop-the-line:** Any dataset reports `balanced: false` (non-zero delta).

**Rollback:** Restore the pre-drill backup, re-run reconciliation, and investigate source-of-truth divergence per the reconciliation runbook.

---

### Step 6 — Run E2E smoke against deployed environment

Execute the end-to-end smoke test against the deployed staging environment. The test (`test/e2e.test.js`) validates API and web server integration across seven surfaces.

```bash
node --test test/e2e.test.js 2>&1 | tee dist/e2e-evidence.log
```

The test starts both the API and web servers in-process on ephemeral ports and validates:

1. API `/healthz` returns `200` with `{ ok: true, service: 'zaffiliate-api' }`.
2. API `/readyz` returns `200` or `503`.
3. API `/metrics` returns `200` and body contains `zaffiliate_http_requests_total`.
4. Web root `/` returns `200` with `<title>` or `<nav` in body.
5. Web `/api/navigation` returns `200` JSON with a `sections` array (header `x-tenant-id: test`).
6. Web `/api/audit` returns `200` JSON with a `rows` array (header `x-tenant-id: test`).
7. Cross-origin request from web origin to API `/healthz` returns a response **without** `access-control-allow-origin` header (CORS blocked).

**Evidence:** `dist/e2e-evidence.log` — full `node --test` output including observability logger stdout.

**Pass criteria:** All seven subtests pass; exit code 0.

**Stop-the-line:** Any subtest fails. See `docs/operations/e2e-runbook.md` for per-surface stop-the-line conditions.

**Rollback:** Revert the runtime image to the previous digest and confirm the E2E smoke passes against the rolled-back instance. File an incident report with root cause per `docs/operations/upgrade-rollback.md` Section "Rollback steps".

---

## 4. Evidence collection

### Artifact index

| Gate | Artifact path | Format | Source |
|------|---------------|--------|--------|
| 0 | `dist/deploy-staging-evidence.txt` | text | kubectl + curl output |
| 0.5 | `dist/rls-test-evidence.log` | text | psql stdout/stderr |
| 1 | `dist/adapter-contract-evidence.log` | text | node --test output |
| 2 | `dist/load-test-evidence.json` | JSON | scripts/load-test.mjs |
| 3 | `dist/soak-test-evidence.json` | JSON | scripts/soak-test.mjs |
| 4 | `dist/fault-inject-evidence.json` | JSON | scripts/fault-inject.mjs |
| 5 | `dist/backup-restore-drill-evidence.json` | JSON | scripts/backup-restore-drill.mjs |
| 5 | `backups/schema.sql` | SQL dump | pg_dump output |
| 5 | `dist/backup-sha256.log` | text | sha256sum output |
| 5.5 | `dist/reconcile-commissions-evidence.json` | JSON | scripts/reconcile.mjs |
| 5.5 | `dist/reconcile-billing-evidence.json` | JSON | scripts/reconcile.mjs |
| 5.5 | `dist/reconcile-webhooks-evidence.json` | JSON | scripts/reconcile.mjs |
| 6 | `dist/e2e-evidence.log` | text | node --test output |

### Output directory

All evidence artifacts are written to `dist/` at the repository root. The `dist/` directory is in `.gitignore` and is treated as ephemeral. For durability, each evidence file must be archived to the operational artifact store before the staging cluster is torn down.

```bash
# Archive all evidence to the operational artifact store
tar -czf dist/ep11-evidence-$(date -u +%Y%m%dT%H%M%SZ).tar.gz dist/ backups/
# Upload to artifact store (e.g., S3 / GCS bucket with 30-day retention)
aws s3 cp dist/ep11-evidence-*.tar.gz s3://zaffiliate-artifacts/evidence/ep11/
```

### Retention policy

| Artifact class | Retention | Rationale |
|----------------|-----------|-----------|
| Evidence JSON logs | 90 days | Audit and incident review |
| SQL dump artifacts | 35 days | Matches PostgreSQL backup retention (`docs/operations/rto-rpo.md`) |
| Archived tarball | 30 days | Ephemeral operational evidence |
| Secret SHA-256 hashes | 30 days | Credential rotation audit (`docs/closure/ep01-credential-rotation.md`) |

### Format notes

- JSON evidence files from `load-test.mjs`, `soak-test.mjs`, `fault-inject.mjs`, `backup-restore-drill.mjs`, and `reconcile.mjs` are `Object.freeze`d snapshots — immutable by design.
- The `backup-restore-drill-evidence.json` includes a `sha256` field computed over the dump artifact bytes; this must be verified independently via `sha256sum backups/schema.sql`.
- All evidence filenames are prefixed with `ep11-` in the artifact store for traceability.

---

## 5. Thresholds and stop-the-line criteria

### Per-gate thresholds

| Gate | Metric | Pass threshold | Fail action |
|------|--------|----------------|-------------|
| 0 | Deploy / healthz | 200 + `{ok:true, service:zaffiliate-api}` | Rollback deployment |
| 0 | Deploy /readyz | `ready:true` | Rollback deployment |
| 0.5 | RLS cross-tenant insert | Rejected (`insufficient_privilege`) | Fix policy, re-apply migration |
| 0.5 | RLS tenant visibility | Tenant A: 1 product; Tenant B: 0 products | Fix RLS policy |
| 1 | Adapter contract | All subtests pass | Fix adapter, re-run |
| 2 | Load p99 | <= 500 ms | Do not advance; capacity review |
| 2 | Load errorRate | <= 1% | Do not advance; investigate errors |
| 3 | Soak successRate | >= 99.9% | Stop soak, rollback, investigate |
| 3 | Soak memoryGrowth | <= 20% | Stop soak, rollback, memory profile |
| 3 | Soak eventLoopLagP95 | < 500 ms | Stop soak, rollback, event-loop profile |
| 4 | Fault recovery rate | 100% | Rollback, fix recovery path |
| 4 | Fault recoveryDurationMs | <= 5000 ms | Rollback, tune timeout |
| 5 | Backup pg_dump exit | 0 | Restore from prior backup |
| 5 | SHA-256 match | Match | Investigate corruption |
| 5 | Validation SQL | Exit 0 | Fix schema/state, restore |
| 5.5 | Reconciliation delta | 0 (balanced: true) | Restore, re-run, investigate source |
| 6 | E2E smoke | All 7 subtests pass | Rollback image, incident report |

### Zero-tolerance invariants (from `docs/SLO.md`)

Any of the following during any gate immediately triggers a stop-the-line and full rollback:

- Cross-tenant data exposure (`cross_tenant_access_violation` alert).
- Authorization or approval bypass (any `webhook_replay_detected` or `cross_tenant_access_violation` critical alert).
- Active secret exposure (secret scan failure).
- Duplicate or lost financial/external mutation (non-zero `ledger_reconciliation_delta`).
- Irrecoverable backup failure (SHA-256 mismatch or non-zero exit on `backup-restore-drill`).
- Silent billing/commission corruption (non-zero reconciliation delta).

---

## 6. Rollback procedure per step

### General rollback (all steps)

```bash
# Revert runtime image to the last known-good digest
kubectl set image deployment/zaffiliate-api \
  zaffiliate-api=zaffiliate:${LAST_KNOWN_GOOD_DIGEST} \
  --namespace=zaffiliate-staging

# Confirm rollback
kubectl rollout status deployment/zaffiliate-api --namespace=zaffiliate-staging --timeout=300s
kubectl rollout undo deployment/zaffiliate-web --namespace=zaffiliate-staging
```

### Per-step rollback

| Step | Trigger condition | Rollback action |
|------|-------------------|-----------------|
| 0 (Deploy) | Probes fail or rollout timeout | `kubectl rollout undo deployment/zaffiliate-api --namespace=zaffiliate-staging`; verify `/healthz` and `/readyz` recover |
| 0.5 (RLS) | Cross-tenant insert succeeds or visibility wrong | Re-apply RLS migration from `db/migrations/`; re-run `db/tests/rls.sql`; no runtime rollback (read-only) |
| 1 (Adapter contract) | Contract test fails | Revert sandbox credential to prior value via `secret-manager`; re-run `test/adapters-marketplace.test.js`; see `docs/closure/ep01-credential-rotation.md` Section D for credential rollback |
| 2 (Load) | p99 > 500ms or errorRate > 1% | Do not advance; revert to prior image; review `docs/operations/capacity-model.md` scaling triggers; re-run at reduced concurrency |
| 3 (Soak) | memoryGrowth > 20% or successRate < 99.9% | Stop soak (`Ctrl+C`); revert runtime image; capture memory profile via `/metrics` (`zaffiliate_process_memory_rss_bytes`); re-run soak with fix applied |
| 4 (Fault inject) | recovery rate < 100% or recovery > 5s | Revert runtime image; inspect circuit-breaker config in `packages/adapters/src/rate-limit.js`; re-run fault injection at shorter window |
| 5 (Backup/restore) | pg_dump fails or SHA-256 mismatch | Restore pre-drill DB from latest verified backup per `docs/operations/rto-rpo.md`; do not tear down staging; re-run drill |
| 5.5 (Reconciliation) | `balanced: false` for any dataset | Restore from pre-drill backup; re-run `scripts/reconcile.mjs` for failed dataset; investigate source-of-truth divergence |
| 6 (E2E) | Any subtest fails | Revert runtime image; run synthetic transactions against rolled-back instance per `docs/operations/upgrade-rollback.md` rollback steps; file incident report |

### Database rollback (for destructive steps)

If any step mutates the staging database and must be rolled back:

```bash
# Restore from the most recent verified backup (see Gate 5)
createdb zaffiliate_test_rollback --owner zaffiliate_app
pg_restore -d zaffiliate_test_rollback backups/schema.sql
# Point the application at the restored database
kubectl set env deployment/zaffiliate-api DATABASE_URL="postgres://...@/zaffiliate_test_rollback" --namespace=zaffiliate-staging
kubectl rollout restart deployment/zaffiliate-api --namespace=zaffiliate-staging
kubectl rollout status deployment/zaffiliate-api --namespace=zaffiliate-staging --timeout=300s
```

### Post-rollback verification

After any rollback, re-run the E2E smoke to confirm baseline health:

```bash
STAGING_HOST=$(kubectl get svc zaffiliate-api -n zaffiliate-staging -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
TARGET="http://${STAGING_HOST}:8080" node --test test/e2e.test.js
```

---

## 7. Execution order summary

```
Step 0  -> Deploy canonical runtime (verify probes)
   |
   v
Step 0.5 -> Postgres RLS negative tests (db/tests/rls.sql)
   |
   v
Step 1  -> Adapter contract tests (test/adapters-marketplace.test.js, sandbox)
   |
   v
Step 2  -> Load test (scripts/load-test.mjs, concurrency=100, 30s)
   |
   v
Step 3  -> Soak test (scripts/soak-test.mjs, 1h minimum)
   |
   v
Step 4  -> Fault injection (scripts/fault-inject.mjs --scenario=all)
   |
   v
Step 5  -> Backup/restore DR drill (scripts/backup-restore-drill.mjs --run)
   |
   v
Step 5.5 -> Reconciliation checkpoints (scripts/reconcile.mjs, 3 datasets)
   |
   v
Step 6  -> E2E smoke (node --test test/e2e.test.js)
   |
   v
Sign-off (see `docs/PRODUCTION-READINESS.md` sign-off template)
```

All gates must pass before the cutover is considered production-ready. Evidence artifacts must be archived to the operational artifact store (90-day retention) before tearing down the staging cluster.
