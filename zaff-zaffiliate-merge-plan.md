# zaff ↔ zaffiliate — Executed Merge Ledger

**Original plan date:** 2026-08-23  
**Execution refresh:** 2026-09-05  
**Canonical target:** `cvsz/zaffiliate`  
**Source donor:** `cvsz/zaff`  
**Mode:** Executed/current-state ledger

This file supersedes the original report-only assumptions. The original plan correctly identified `zaffiliate` as the canonical target and `zaff` as the infrastructure donor, but the repository has advanced substantially since that report. Current implementation evidence is authoritative; duplicate ports are explicitly avoided.

## Canonical decisions

| Decision | Resolution |
|---|---|
| Target repository | `cvsz/zaffiliate` |
| Runtime language | JavaScript ESM; do not mechanically convert to zaff TypeScript workspace |
| Persistence | Postgres in production; in-memory remains available for deterministic unit tests |
| Event delivery | Redis Streams for durable delivery with bounded in-memory fallback/test mode |
| Affiliate runtime | zaffiliate `affiliate-core` with DB repository port |
| TikTok implementation | zaffiliate TikTok Shop SDK is canonical |
| Security boundary | zaffiliate security + transport boundary is canonical |
| RBAC | zaffiliate tenant-aware grants model remains canonical; donor semantics are parity inputs, not a second authorization stack |
| Session/API-key model | zaffiliate identity/billing model remains canonical |
| Contract strategy | Preserve the canonical JavaScript contract surface; introduce schema validation only behind compatibility-safe boundaries rather than forcing a wholesale Zod migration |

## Execution status by original phase

### Phase 0 — Contracts & tooling — COMPLETE / CONSOLIDATED

Canonical tenancy, grants, audit-chain and domain contracts are already established in `packages/contracts`. The repository has extensive regression and tenant-isolation coverage. A wholesale TypeScript/Zod workspace conversion is intentionally rejected because it would replace the richer canonical runtime rather than port missing infrastructure behind stable interfaces.

### Phase 1 — Persistence layer — COMPLETE

Implemented in `zaffiliate`:

- `packages/db` pooled client and checksummed migrator;
- drift detection/fail-closed migration behavior;
- production SQL migrations under `db/migrations`;
- tenant/RLS integration coverage;
- publication-job repositories;
- affiliate-core persistence repository;
- auth/OAuth repositories;
- campaign/conversion reconciliation repositories;
- Postgres-backed integration workflows in GitHub Actions.

Do not copy `zaff/packages/db` wholesale. The required donor capability has already been ported into the canonical JavaScript architecture.

### Phase 2 — Durable events — COMPLETE

`packages/events` now includes the Redis Streams reliability features the original report identified as missing:

- consumer-group creation;
- batch `XREADGROUP` consumption;
- `XAUTOCLAIM` pending-message recovery;
- ACK only after successful processing;
- retry-attempt tracking;
- bounded DLQ behavior;
- Redis-backed idempotency/deduplication;
- stable caller-supplied event IDs;
- fail-closed behavior when Redis is required;
- deterministic in-memory mode for tests/degraded environments.

### Phase 3 — Auth & identity — COMPLETE FOR CANONICAL SCOPE

Implemented:

- OAuth authorization-code + PKCE flow;
- callback/disconnect wiring;
- external identity binding;
- persistent OAuth state/login repositories;
- session lifecycle;
- scoped API keys stored by hash;
- tenant-aware RBAC/grants;
- plans, quotas, usage, ledger and invoices;
- security/audit boundaries around privilege changes.

The canonical identity model is the existing zaffiliate implementation; donor auth semantics are used as parity references rather than imported as a second token/session system.

### Phase 4 — Security package — COMPLETE

Canonical security package includes:

- SSRF/URL validation;
- `ref:` secret-manager contract;
- secret classification and structured-log redaction;
- JWKS/OAuth verification helpers;
- ingress and Redis-backed rate limiting;
- transport-boundary protections;
- CI secret/security gates.

### Phase 5 — Storage — COMPLETE IN CODE / EXTERNAL PERMISSION BLOCKER REMAINS

Implemented:

- local storage driver;
- S3-compatible storage boundary;
- MIME/media validation;
- signed object URLs;
- fail-closed storage behavior.

Remaining issue is not a merge/code gap: current release-readiness evidence records provider-side object-storage write permission as an external operational blocker.

### Phase 6 — Adapter consolidation — COMPLETE FOR MERGE SCOPE

Canonical adapter surface now retains the deeper zaffiliate implementations while incorporating the required donor capabilities where appropriate:

- TikTok Shop SDK as canonical implementation;
- Shopee and Lazada signed clients;
- LINE messaging boundary;
- Facebook/Instagram and YouTube publishing boundaries;
- capability registry and provider policy;
- rate limiting, idempotency and transport boundary;
- approval-required/manual capability classification where live automation is unsupported.

Live-provider credential verification is operational release work, not a repository merge gap.

### Phase 7 — Domain runtime persistence — COMPLETE FOR AFFILIATE CORE; DURABILITY HARDENING CONTINUES BY SUBSYSTEM

`affiliate-core` is now wired through `createAffiliateCoreRepo` and runtime composition can select the persistent backend. Transactional persistence, restart/replay and RLS coverage exist for the core affiliate lifecycle.

Other runtimes retain deterministic in-memory seams where useful for tests; durable workflow/publication state and Redis delivery have dedicated persistence implementations. Future subsystem-specific persistence should be added only where production semantics require it, not by replacing all runtime interfaces wholesale.

### Phase 8 — API surface unification — COMPLETE

The API is no longer health/readiness-only. Current server/business layers include tenant-gated business routes such as:

- safe `/go/:slug` redirect and click attribution;
- signed webhook ingress, replay protection and conversion recording;
- campaign and commerce endpoints;
- analytics/automation/content/intelligence surfaces;
- OAuth authorization/callback/disconnect routes;
- readiness, health and metrics.

The web control plane is wired to the canonical API surfaces rather than being treated as a donor replacement target.

### Phase 9 — Observability unification — COMPLETE

Canonical observability now includes structured redacted logs, metrics registry, `/metrics`, correlation/span support, SLO/error-budget evaluation, alert definitions and dashboards. A second pino/otel stack from `zaff` is not required unless a future bounded slice demonstrates a measurable missing capability.

### Phase 10 — Release / control-plane / CI hardening — COMPLETE FOR MERGE SCOPE

Present in `zaffiliate`:

- release manifest/version/changelog tooling;
- CycloneDX SBOM generation;
- GPG attestation workflow/runbook;
- control-plane navigation and web SPA;
- Supabase integration boundary;
- CI with syntax/tests, Postgres integration, security scanning, CodeQL and dedicated persistence/runtime workflows;
- load/soak/fault/backup/restore tooling and runbooks.

## Original gap list — disposition

| Original missing capability in `zaffiliate` | Current disposition |
|---|---|
| Postgres persistence | COMPLETE |
| Redis Streams event bus | COMPLETE |
| OAuth/OIDC browser flow | COMPLETE |
| Account/session persistence | COMPLETE for canonical passwordless/OIDC/API-key model |
| Argon2id password hashing | NOT REQUIRED by canonical passwordless/OIDC design; do not add unused password auth solely for parity |
| Storage adapters | COMPLETE in code; external write permission remains operational blocker |
| `/go/:slug` + click attribution | COMPLETE |
| Signed webhook ingest/replay/dedup | COMPLETE |
| API business routes | COMPLETE |
| CI Postgres/security integration | COMPLETE |
| Affiliate durable persistence | COMPLETE |
| Durable event delivery | COMPLETE |

## Non-merge blockers

The remaining release blockers must not be misclassified as zaff→zaffiliate merge work:

1. **Live provider credentials/capability approval** — external maintainer/provider dependency.
2. **Object-storage write permission** — external provider/S3 credential or bucket-policy dependency.
3. **Final live-provider verification and explicit production release authorization** — operational evidence gate.
4. **Legacy retirement/cutover evidence** — execute only after production gates and rollback evidence are green.

## Execution rule going forward

`cvsz/zaffiliate` is the sole canonical implementation target. `cvsz/zaff` is a provenance/parity donor only. Before porting anything from `zaff`, first prove the capability is still absent in current `zaffiliate/main`; if an equivalent or stronger implementation already exists, do not duplicate it.

All future work follows `EXEC-PLANNING.md`: bounded vertical slices, production code + tests + security/telemetry/rollback evidence, no merge on red CI, and no retirement of legacy repositories until cutover evidence is complete.

## Final merge-plan status

**ZAFF → ZAFFILIATE CODE CONSOLIDATION: EXECUTED FOR THE ORIGINAL HIGH-VALUE MERGE SCOPE.**

The historical merge plan is no longer an open implementation checklist. Remaining work belongs to release readiness, live-provider enablement, storage permissions, production validation/cutover and legacy-retirement evidence.

## Production closure handoff

The executable post-merge path is now maintained in `docs/closure/final-closure-plan.md`. Main CI and CodeQL were green on the consolidation baseline `2bf67961a05f1439de24c7e7758f46d04dca0795`. Repository consolidation is closed; do not reopen donor-copy work unless a capability is proven absent. Production completion is gated by B2 provider enablement, B7 object-storage permissions, live verification, EP-11 evidence, explicit cutover/Gold-Master authorization, signed attestation, and the seven-day observation period before irreversible legacy retirement.
