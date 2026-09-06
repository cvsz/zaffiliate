# zaff → zaffiliate Final Closure Plan

**Updated:** 2026-09-06  
**Canonical repository:** `cvsz/zaffiliate`  
**Status:** Code consolidation complete; production closure in progress.

## Current verified baseline

- ZAFF → ZAFFILIATE high-value code consolidation: **COMPLETE**.
- Main CI for `2bf67961a05f1439de24c7e7758f46d04dca0795`: **PASS**.
- CodeQL for the same commit: **PASS**.
- Canonical runtime: `zaffiliate`; `zaff` is provenance/parity donor only.
- Closed historical blockers: B1, B3, B4, B5, B6, B8, B9, B10.
- Remaining release blockers: **B2 live provider enablement** and **B7 object-storage write permission**.

## Critical path to DONE

| Order | Gate | Owner | State | Exit evidence |
|---:|---|---|---|---|
| 0 | Main CI + CodeQL + Redis Runtime | repository | PASS | GitHub Actions green on current baseline, including live Redis stream integration |
| 1 | B2 provider credentials/approval | maintainer + providers | BLOCKED_EXTERNAL | live credentials are provisioned outside git; approved capability probes pass |
| 2 | B7 object-storage permission | maintainer + storage provider | BLOCKED_EXTERNAL | write/read/signed-url/delete probe passes with tenant-safe policy |
| 3 | Production dependency wiring | operator | READY_AFTER_1_2 | Postgres + Redis + storage readiness green; no required memory fallback |
| 4 | EP-01 credential closure | operator | READY | rotation/revocation evidence; secret scans green |
| 5 | Live provider verification | operator + providers | READY_AFTER_1 | OAuth/refresh/revoke, capability, webhook, idempotency and reconciliation evidence |
| 6 | EP-11 production harness | operator | READY_AFTER_2_5 | RLS/adapter/load/soak/fault/restore/E2E evidence meets thresholds |
| 7 | Performance re-baseline | operator | READY_AFTER_6 | representative production-host baseline artifact |
| 8 | Financial reconciliation gate | operator | READY_AFTER_5 | zero duplicate financial mutations; ledger/commission reconciliation clean |
| 9 | EP-12 shadow cutover | operator | READY_AFTER_6_8 | dual-write counts match; no legacy mutation dependency |
| 10 | EP-12 traffic enable | release owner | AUTH_REQUIRED | routing flipped; legacy mutations zero; SLO watch green |
| 11 | EP-12B release candidate | release owner | READY_AFTER_10 | checksPassed=true, manifest + SBOM + migration set verified |
| 12 | Gold Master approval | release owner | AUTH_REQUIRED | all blockers closed; no unresolved high/critical release finding |
| 13 | Production release + smoke | release owner | AUTH_REQUIRED | health/readiness/metrics/core transaction smoke passes |
| 14 | EP-11B signed attestation | signing-key owner | BLOCKED_EXTERNAL | signed commit/tag verified |
| 15 | Seven-day observation | operator | FUTURE_TIME_GATE | SLO/error budget/provider/storage/reconciliation healthy for 7 days |
| 16 | EP-13 legacy retirement | owner | AUTH_REQUIRED_AFTER_15 | archive + restore proof + zero dependency + owner approval |
| 17 | DONE | owner | PENDING | zaffiliate sole canonical production runtime; final readiness ledger updated |

## Non-negotiable safety/release rules

1. Never commit provider, OAuth, database, Redis, storage, signing or admin credentials.
2. Never mark a live capability production-ready from mock/sandbox evidence.
3. Never bypass failed CI/security/readiness gates to complete the checklist.
4. Never flip production traffic, publish a Gold Master, delete legacy infrastructure, or revoke rollback credentials without explicit release-owner authorization.
5. Never retire `zaff` before the seven-day post-release observation and restore/archive evidence are complete.
6. Any external blocker remains explicitly BLOCKED; documentation must not convert absence of evidence into PASS.

## Operator commands once external prerequisites are provisioned

Run from a clean checkout of `main` with production secrets injected by the deployment environment:

```bash
npm ci
npm run check
npm test
npm audit --omit=dev --audit-level=high
./scripts/security-check.sh

# Production harness / evidence
# Follow docs/closure/ep11-production-execution.md exactly.

node scripts/cutover.mjs --phase=shadow
# Inspect dist/cutover-evidence.json before any traffic change.

# Explicit release-owner authorization is required before:
node scripts/cutover.mjs --phase=enable

node scripts/release-candidate.mjs --version=<version>
node scripts/post-release-smoke.mjs --target=<production-url>
```

If a cutover validation fails:

```bash
node scripts/cutover.mjs --phase=rollback
```

## B2 closure checklist

- TikTok URL ownership verified.
- TikTok review/demo submitted and approved.
- Shop Partner AppKey/AppSecret has the Affiliate product/capabilities required by production.
- TikTok live read/write capability probe passes.
- OAuth refresh, revoke and REAUTH_REQUIRED paths pass.
- Signed webhook + replay + idempotency tests pass against live configuration.
- Shopee/Lazada/LINE capabilities are live-verified only if advertised as production-ready.
- Meta/YouTube remain PARTIAL/unsupported until their own credentials and live canaries pass.
- Capability registry and release-readiness document record only evidence-backed states.

## B7 closure checklist

- Correct S3-compatible endpoint/region/bucket configured.
- Write-enabled credential is injected outside git.
- Put object passes.
- Read object passes.
- MIME/media validation passes.
- Signed URL passes.
- Tenant/object-key isolation passes.
- Delete/cleanup passes.
- Failure modes remain fail-closed.
- Evidence contains hashes/status metadata, never credentials.

## EP-11 acceptance

Required evidence:

- tenant/RLS negative tests;
- cross-tenant golden E2E;
- provider adapter contracts;
- webhook replay/idempotency;
- SAST/SCA/CodeQL/secret/container checks;
- SBOM;
- production load test;
- soak >= 1 hour;
- DB/Redis/provider fault injection;
- clean backup/restore rehearsal;
- production E2E smoke.

Target thresholds from the closure plan:

- p99 <= 500 ms;
- error rate <= 1%;
- success rate >= 99.9%;
- memory growth <= 20%;
- recovery rate = 100%.

## Gold Master definition of done

Gold Master may be approved only when B2 and B7 are CLOSED, CI and security gates are green, live-provider/storage evidence passes, restore/reconciliation/load/soak/fault evidence passes, cutover evidence passes, and no unresolved release-blocking High/Critical finding remains.

## Final production definition of done

`zaffiliate` is the sole canonical production runtime; production-advertised providers are live-verified; Postgres/Redis/storage are durable and operational; backup/restore and financial reconciliation are clean; release artifacts are signed/attested; post-release SLOs remain healthy for seven days; legacy runtime retirement is explicitly approved and evidenced.

**Automation boundary:** repository work can continue automatically. B2/B7 credentials, provider approval, production traffic enablement, signing-key use, Gold Master authorization and irreversible legacy retirement require the responsible human/provider and cannot be truthfully auto-completed.
