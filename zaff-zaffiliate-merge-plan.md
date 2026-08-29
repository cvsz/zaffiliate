# zaff ↔ zaffiliate — Feature Comparison & Full Merge Plan

**Date:** 2026-08-23
**Mode:** Report only (no merge code written in this session)
**Scope requested:** Full merge (all missing features consolidated)
**Repos:**
- `/home/cvsz/zaff` — TypeScript monorepo, npm workspaces, 14,024 LOC TS, 44 test files. Strong *infrastructure*.
- `/home/cvsz/zaffiliate` — JavaScript monorepo, single package, 6,636 LOC JS, 33 test files, runnable. Strong *domain/business logic*.

---

## 1. Stack & Packaging Differences (root cause of merge friction)

| Dimension | zaff | zaffiliate |
|---|---|---|
| Language | TypeScript (strict, `tsc -b` project refs) | JavaScript (ESM, `node --test`) |
| Packaging | npm workspaces (`apps/*`,`services/*`,`packages/*`) | single `package.json`, `packages/*` as plain dirs |
| Runtime state | Postgres + Redis (real persistence) | in-memory runtimes (no DB) |
| Node engine | >=20.19 | >=22 |
| API surface | business routes (auth, oauth, links, campaigns, webhooks) | health/readiness/metrics only |
| Web/UI | stub | real SPA (views.js + app.js) with mock data |
| Tests | vitest (unit/integration/security/parity) | node:test (runtime/e2e/harnesses) |
| CI | lint + typecheck + build + test + Postgres service | `node --check` + `node --test` + secret/security guards |
| Self-description | "Affiliate Automation OS" scaffold | "canonical" consolidation of legacy repos |

**Implication:** A full merge is a *port*, not a `git merge`. The two trees do not share files, build tooling, or a type system. The plan below treats it as a consolidation with explicit source→target mapping and dedup steps.

---

## 2. Feature Comparison Matrix

Legend: ✅ implemented · 🟡 partial/stub · ❌ absent

### 2.1 Cross-cutting infrastructure
| Capability | zaff | zaffiliate | Notes |
|---|---|---|---|
| Postgres persistence (repos + migrator + drift) | ✅ | ❌ | zaff has 12 repos + migrator + drift detection |
| Redis event bus / streams (consumer groups, DLQ) | ✅ | ❌ | zaff `redis-streams.ts`; zaffiliate is in-memory outbox only |
| In-memory event bus (retry + DLQ) | ✅ | 🟡 | zaff full bus; zaffiliate outbox pattern in runtimes |
| Structured logging (pino + redaction) | ✅ | 🟡 | zaff pino; zaffiliate custom JSON logger w/ redaction |
| OpenTelemetry tracing | ✅ | 🟡 | zaff otel wrapper; zaffiliate spans via observability pkg |
| Metrics (Prometheus exposition) | 🟡 | ✅ | zaff none; zaffiliate `/metrics` + MetricsRegistry |
| SLO / error-budget evaluation | ❌ | ✅ | zaffiliate `defineSlo/evaluateSlo` |
| Storage adapters (local/S3, MIME, signed URLs) | ✅ | ❌ | zaff `storage/*`; zaffiliate none |
| Security package (SSRF, secrets, classification, redaction) | ❌ (empty) | ✅ | zaffiliate `security/*`; zaff has none |
| SSRF URL validation | ❌ | ✅ | zaffiliate `url-validation.js` |
| Secret manager (`ref:`-only) | ❌ | ✅ | zaffiliate `secrets.js` |
| CI security gates (secret/SSRF scanning) | 🟡 | ✅ | zaffiliate explicit guards |

### 2.2 Auth / identity / tenancy
| Capability | zaff | zaffiliate | Notes |
|---|---|---|---|
| OAuth/OIDC browser flow (PKCE, JWKS, RS256/HS256) | ✅ | ❌ | zaff full; zaffiliate only API-key + external identity link |
| Account recovery (email verify + password reset) | ✅ | ❌ | zaff `account-recovery` |
| Argon2id password hashing | ✅ | ❌ | zaff; zaffiliate `createUser` rejects password claims |
| RBAC / permission model | ✅ | ✅ | zaff `rbac.ts`; zaffiliate `grants.js` (different shapes) |
| Org / tenant isolation | ✅ | ✅ | zaff org-scope; zaffiliate tenantId equality |
| Session management | ✅ | ✅ | zaff 32B tokens; zaffiliate `startSession` `zs_*` |
| Scoped API keys w/ hash storage | ❌ | ✅ | zaffiliate `issueApiKey` |
| Append-only audit log (hash chain) | 🟡 | ✅ | zaff audit repo + events; zaffiliate full SHA-256 chain |
| Membership / plans / entitlements | ❌ | ✅ | zaffiliate `identity-billing` |

### 2.3 Affiliate domain
| Capability | zaff | zaffiliate | Notes |
|---|---|---|---|
| Affiliate core domain (product/offer/link/conversion) | 🟡 | ✅ | zaff contracts+db repos; zaffiliate full runtime |
| Commission math (basis-point / BigInt) | ✅ | ✅ | zaff webhook %/fixed; zaffiliate BigInt basis-points |
| Affiliate link redirect `/go/:slug` + click attribution | ✅ | ❌ | zaff `link-routes.ts` |
| Webhook ingest (HMAC, replay, commission, dedup) | ✅ | ❌ | zaff `campaign-routes.ts` |
| Campaign lifecycle (state machine) | ✅ | 🟡 | zaff campaign status; zaffiliate via workflow |
| Affiliate link generation (slug uniqueness) | ✅ | ✅ | both |

### 2.4 Platform adapters / integrations
| Capability | zaff | zaffiliate | Notes |
|---|---|---|---|
| TikTok Shop adapter/SDK | ✅ | ✅ | zaff signed requests; zaffiliate full SDK (signing/auth/webhook/client/resilience/pagination/resources) |
| Shopee adapter | ✅ | ✅ | both signed clients |
| Meta adapter | ✅ | 🟡 | zaff Meta Graph; zaffiliate publishing supports FB/IG |
| YouTube adapter | ✅ | 🟡 | zaff upload; zaffiliate publishing supports YT |
| Lazada adapter | ❌ | ✅ | zaffiliate only |
| Line adapter | ❌ | ✅ | zaffiliate only |
| Policy registry (capabilities/rate/disclosure) | ✅ | ✅ | both, different shapes |
| Rate limiting (token bucket) | 🟡 | ✅ | zaff API limiter; zaffiliate `rate-limit.js` |
| Transport boundary (SSRF + sensitive body) | ❌ | ✅ | zaffiliate `transport-boundary.js` |
| Publishing adapter (approval + idempotency) | 🟡 | ✅ | zaff throws NotImplemented; zaffiliate real |

### 2.5 Content / AI
| Capability | zaff | zaffiliate | Notes |
|---|---|---|---|
| AI content runtime (templates, providers, budget) | ❌ (empty) | ✅ | zaffiliate `ai-content` |
| AI agents + experiments | ❌ | ✅ | zaffiliate `runAgent`, `createExperiment` |
| AI provider package | ❌ (empty) | 🟡 | zaffiliate provider selection inside ai-content |
| Copy/image/video generation pipelines | ❌ | ❌ | neither (vision only) |

### 2.6 Analytics / attribution
| Capability | zaff | zaffiliate | Notes |
|---|---|---|---|
| Analytics domain/runtime | ❌ (stub) | ✅ | zaffiliate `analytics` |
| Attribution models (last/first/linear) | 🟡 | ✅ | zaffiliate full chain |
| Funnel / drop-off / cohort | ❌ | ✅ | zaffiliate |
| Anomaly detection | ❌ | ✅ | zaffiliate |
| Commission reconciliation | 🟡 | ✅ | zaffiliate 1% tolerance |

### 2.7 Workflow / automation / outreach
| Capability | zaff | zaffiliate | Notes |
|---|---|---|---|
| Workflow engine (state machine, DLQ, approval) | ❌ | ✅ | zaffiliate `workflow` |
| Outreach (consent, quiet-hours, budget, DLQ) | ❌ | ✅ | zaffiliate `outreach` |
| Human approval inbox / web approve | 🟡 | ✅ | zaff campaign status; zaffiliate web approve |
| Worker / scheduler apps | ❌ | ❌ | both stubs/absent |

### 2.8 Billing
| Capability | zaff | zaffiliate | Notes |
|---|---|---|---|
| Plans / quotas / entitlements | ❌ | ✅ | zaffiliate |
| Usage metering | ❌ | ✅ | zaffiliate |
| Ledger (balanced entries) | ❌ | ✅ | zaffiliate |
| Invoice lifecycle | ❌ | ✅ | zaffiliate |

### 2.9 Release / tooling / control-plane
| Capability | zaff | zaffiliate | Notes |
|---|---|---|---|
| Release manifest / version / changelog | ❌ | ✅ | zaffiliate `release` |
| Control-plane navigation manifest | ❌ | ✅ | zaffiliate `control-plane` |
| Supabase client | ❌ | ✅ | zaffiliate |
| Web SPA (real UI) | ❌ | ✅ | zaffiliate `apps/web` |

---

## 3. Missing Features (the "find missing" answer)

### 3.1 Features MISSING in `zaff` (present in zaffiliate)
- Affiliate core *runtime* (in-memory lifecycle w/ BigInt commission math, event outbox)
- AI content runtime (templates, provider selection, budget metering, agents, experiments)
- Analytics runtime (attribution models, funnel, cohort, anomaly, reconciliation, export)
- Workflow engine (durable job SM, tool grants, idempotency, approval, DLQ, reconcile)
- Outreach engine (consent suppression, quiet-hours, daily budget, follow-ups, DLQ)
- Identity & billing (membership, scoped API keys, plans, quotas, ledger, invoices)
- Security package: SSRF validation, secret classification/redaction, `ref:` secret manager, transport boundary
- TikTok Shop **SDK** (current zaff TikTok adapter is shallower than zaffiliate's SDK)
- Lazada + Line adapters
- Rate-limit token bucket, publishing adapter, transport boundary
- Observability SLO/metrics/span richness
- Release tooling (manifest/version/changelog), control-plane nav, Supabase client
- Real web SPA

### 3.2 Features MISSING in `zaffiliate` (present in zaff)
- Postgres persistence layer (12 repos, migrator, schema-drift detection)
- Redis Streams event bus (durable, consumer groups, DLQ)
- OAuth/OIDC browser flow (PKCE, JWKS, RS256/HS256) + account recovery
- Argon2id password hashing
- Storage adapters (local/S3, MIME sniffing, signed URLs)
- Affiliate link redirect `/go/:slug` + click attribution endpoint
- Webhook ingest (HMAC, replay protection, commission computation, dedup)
- API business routes (auth register/login/logout/me, campaigns CRUD, conversions)
- CI: lint + typecheck + build + Postgres integration tests
- (zaff has no billing/analytics/workflow — those come FROM zaffiliate)

### 3.3 Overlapping capabilities needing DEDUP (not simply "missing")
Both implement, with divergent shapes — must be reconciled, not duplicated:
- **Affiliate domain**: zaff (contracts + db repos + webhook math) vs zaffiliate (`affiliate-core` runtime). → one canonical affiliate-core that is *persistent*.
- **Observability/logging**: zaff (pino + otel) vs zaffiliate (custom metrics/spans/redaction). → merge into one.
- **RBAC / tenancy / audit**: zaff (`rbac.ts`, audit repo) vs zaffiliate (`grants.js`, `tenancy.js`, `audit.js` hash chain). → one canonical authz + append-only audit.
- **Platform adapters / TikTok**: zaff (`platform-adapters/*`) vs zaffiliate (`tiktok-shop` SDK + `adapters/*`). → one adapter layer.
- **Policy registry**: zaff (`policy-registry.ts`) vs zaffiliate (`capabilities.js` manifests). → one.
- **Contracts**: zaff (Zod) vs zaffiliate (plain JS). → recommend Zod as single source of truth.

---

## 4. Recommended Consolidation Target

**Recommendation: make `zaffiliate` the canonical target and port `zaff`'s infrastructure into it as JavaScript packages, while replacing zaffiliate's in-memory runtimes with zaff's Postgres persistence.**

Rationale:
- `zaffiliate` is explicitly the "canonical affiliate-commerce platform" and is already runnable (API + web SPA) with the richer business logic (affiliate-core, ai-content, analytics, workflow, outreach, identity-billing).
- `zaff` provides exactly the backbone zaffiliate lacks: durable persistence, real auth, storage, durable events.
- Porting zaff's infra *into* zaffiliate (JS) avoids rewriting 6.6k LOC of validated business logic into TS, and keeps the runnable artifact intact.

Alternative (not recommended here): port everything to zaff's TS — higher cost, loses the running zaffiliate app.

> This is a recommendation only; the report does not perform the port.

---

## 5. Full Merge Plan (phased)

Each phase: source → target mapping, what to build, tests to port/extend, risks.

### Phase 0 — Unify contracts & tooling
- **Source:** zaff `packages/contracts` (Zod), zaffiliate `packages/contracts` (JS).
- **Action:** Adopt Zod as single contract layer in zaffiliate `packages/contracts`. Port zaffiliate's `tenancy.js`, `audit.js`, `grants.js` into Zod schemas. Keep `audit.js` SHA-256 hash chain as canonical.
- **Tests:** port `contracts.test.js`, `tenancy.test.js`, `audit-grants.test.js`; add Zod parity tests vs zaff `contracts/*.test.ts`.
- **Risk:** schema drift between two contract sets; freeze both before porting.

### Phase 1 — Persistence layer (zaff → zaffiliate)
- **Source:** zaff `packages/db` (client, migrator, scope, 12 repos), `packages/db/migrations/*`.
- **Action:** add `packages/db` to zaffiliate (JS port of client/migrator/repos). Port 7 SQL migrations. Add Postgres service to `compose.yaml` + CI.
- **Tests:** port zaff `db.integration.test.ts`, `affiliate.integration.test.ts`, `migrator.drift.integration.test.ts` as `node --test`.
- **Risk:** in-memory runtimes must be re-pointed to repos; transactional semantics differ.

### Phase 2 — Durable events (zaff → zaffiliate)
- **Source:** zaff `packages/events` (memory bus, redis-streams, typed-bus, domain events).
- **Action:** add `packages/events` to zaffiliate; replace runtime outboxes with the bus where durable delivery is required (affiliate-core, workflow, outreach). Keep in-memory bus for tests.
- **Tests:** port `bus.*`, `redis-streams.test.ts`, `domain.test.ts`.
- **Risk:** Redis dependency; must degrade gracefully when Redis absent (zaffiliate `/readyz` already fails closed).

### Phase 3 — Auth & identity unification
- **Source:** zaff `services/auth` (OAuth/OIDC, account-recovery, rbac, passwords), zaffiliate `identity-billing`.
- **Action:** merge into one `packages/identity` (or keep `identity-billing` + add `auth`). Port OAuth/OIDC browser flow + account recovery as JS. Reconcile RBAC (`rbac.ts` vs `grants.js`) → one model. Keep `identity-billing` for plans/ledger/invoices.
- **Tests:** port zaff `oauth.*`, `account-recovery.*`, `rbac.test.ts`; keep zaffiliate `identity-billing-*.test.js`.
- **Risk:** two session/token schemes (`zs_*` vs 32B); pick one canonical token format.

### Phase 4 — Security package (zaffiliate already has it)
- **Source:** zaffiliate `packages/security` (SSRF, secrets, classification, redaction), `adapters/transport-boundary.js`.
- **Action:** wire zaffiliate's `security` + `transport-boundary` into zaff's API server and all outbound adapter calls (zaff's adapters currently lack SSRF/transport guards).
- **Tests:** already covered by `ssrf-validation.test.js`, `security-observability.test.js`; add parity for zaff adapters.

### Phase 5 — Storage (zaff → zaffiliate)
- **Source:** zaff `packages/storage` (local, s3, mime, signing, keys).
- **Action:** add `packages/storage` to zaffiliate (JS port). Wire into media/asset paths used by ai-content and publishing.
- **Tests:** port `keys.test.ts`, `mime.test.ts`, `local.test.ts`, `signing.test.ts`, `s3.test.ts`.

### Phase 6 — Adapter consolidation
- **Source:** zaff `platform-adapters/*` (tiktok, shopee, meta, youtube, policy-registry, core), zaffiliate `tiktok-shop` SDK + `adapters/*` (shopee, lazada, line, capabilities, publishing, rate-limit).
- **Action:** produce one `packages/adapters` with: TikTok (prefer zaffiliate SDK depth), Shopee (merge both), Lazada + Line (from zaffiliate), Meta + YouTube (from zaff), unified policy registry, rate-limit, transport-boundary, publishing adapter. Mark unsupported ops `manual`/`approval-required` per AGENTS.md.
- **Tests:** port both `adapters.test.js`, `adapters-marketplace.test.js`, `tiktok-*.test.js`, and zaff `meta/tiktok/shopee/youtube/policy-registry` tests.

### Phase 7 — Domain runtime persistence (zaffiliate → wired to Phase 1)
- **Action:** re-point `affiliate-core`, `analytics`, `workflow`, `outreach`, `ai-content` runtimes from in-memory to `packages/db` repos. Keep in-memory mode for unit tests.
- **Tests:** keep existing `*-runtime.test.js`; add persistence integration tests.

### Phase 8 — API surface unification (zaff → zaffiliate)
- **Source:** zaff `apps/api` routes (links `/go/:slug`, campaigns, conversions, webhooks, auth, oauth).
- **Action:** expand zaffiliate `apps/api` beyond health/readiness/metrics to include business routes, backed by unified auth + db + runtimes. Keep zaffiliate web SPA; point it at real endpoints (replace mock data).
- **Tests:** port zaff `*.integration.test.ts` (links, campaign, oauth, auth, bootstrap, prod-wiring).
- **Risk:** zaff API is TS; re-implement in JS inside zaffiliate.

### Phase 9 — Observability unification
- **Action:** merge zaff (pino/otel) and zaffiliate (metrics/spans/SLO/redaction) into one `packages/observability`. Keep `/metrics` + SLO evaluation + otel bridge + redaction.
- **Tests:** merge `observability.test.js`, `logger.test.ts`, `request-log.test.ts`.

### Phase 10 — Release / control-plane / CI hardening
- **Action:** keep zaffiliate `release` + `control-plane` + Supabase client. Extend CI to lint + typecheck (if TS introduced) + build + Postgres integration + secret/SSRF scanning (zaffiliate already has guards). Add `node --test` for all new packages.

---

## 6. Decisions Needed Before Execution
1. **Target stack:** confirm zaffiliate (JS) as target, or switch to zaff (TS). (Report recommends zaffiliate.)
2. **Canonical token/session format:** `zs_*` (zaffiliate) vs 32B base64url (zaff).
3. **Contract system:** confirm Zod single source.
4. **RBAC model:** merge `rbac.ts` (viewer/member/admin/owner) with `grants.js` (owner/admin/operator/affiliate/viewer/service).
5. **Persistence default:** in-memory (dev) vs Postgres (prod) toggle for runtimes.
6. **Duplicate adapters:** which TikTok/Shopee implementation is canonical.
7. **Repo hygiene:** both are git repos; plan a single consolidated repo (or subtree merge) and retire the other per zaffiliate migration contract (evidence-gated).

---

## 7. Summary of "Missing → Source → Target"
| Missing in | Feature | Source repo | Port to |
|---|---|---|---|
| zaffiliate | Postgres persistence | zaff | zaffiliate `packages/db` |
| zaffiliate | Redis event bus | zaff | zaffiliate `packages/events` |
| zaffiliate | OAuth/OIDC + recovery | zaff | zaffiliate `packages/identity` |
| zaffiliate | Storage adapters | zaff | zaffiliate `packages/storage` |
| zaffiliate | API business routes | zaff | zaffiliate `apps/api` |
| zaffiliate | Observability depth | zaff | zaffiliate `packages/observability` |
| zaff | Affiliate/analytics/ai/workflow/outreach/billing runtimes | zaffiliate | zaff (if TS target) or keep in zaffiliate |
| zaff | Security (SSRF/secrets/transport) | zaffiliate | zaff `packages/security` |
| zaff | Lazada/Line adapters, TikTok SDK depth | zaffiliate | zaff `platform-adapters` |
| zaff | Release/control-plane/Supabase/web SPA | zaffiliate | zaff |

This report is the comparison matrix + full merge plan requested. No files were modified.
