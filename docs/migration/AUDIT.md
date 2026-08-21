# Affiliate Stack Deep Audit

Status: evidence-backed migration baseline. Legacy repositories are read-only migration sources until all cutover gates pass.

## Source snapshots

| Repository | Snapshot/ref audited | Primary role |
|---|---|---|
| `cvsz/zaffhub` | `f4d50e4fe6cbfc97e601e6d266c1e0bc1e9c0176` | planning/specification corpus (`AGENTS*`, `ROADMAP.md`, 22 phase prompts) |
| `cvsz/ztsaff` | `f4e0e25f255dff6dcfb6e2ccc475d29a1dedc97b` | mixed Gitea/ops artifacts plus TikTok review SaaS |
| `cvsz/tiktok-shop-bot` | `0e6128856c867172021e12d3fb570610443dcb7d` | Python affiliate outreach CLI |
| `cvsz/tiktok-shop-sdk` | `0c53da6cbba91728401f79cda7156cc56a2cc7dd` | TypeScript TikTok Shop SDK + docs |
| `cvsz/tiktokshop-php` | `dbbec213d9d118c443576d613571993090a843a5` (`master`) | PHP TikTok Shop SDK |
| `cvsz/zlttbots` | `139bde44dfa3bb3fd420a091988dafece8c70d0e` | enterprise social-commerce/affiliate platform |
| `cvsz/zttlbots` | `18b5f572d5fe5926ab3286ee98b12bd3f7669474` | LINE/LLM/billing platform slice |

## File-by-file classification rules

Every source path is assigned one of: **MIGRATE**, **PORT**, **REFERENCE**, **DROP-GENERATED**, **DROP-DUPLICATE**, **QUARANTINE-SECRET**, or **ARCHIVE-EVIDENCE**. Generated caches/build outputs never become canonical source. Runtime `.env` files are quarantined; only sanitized `.env.example` templates may migrate.

### Repository findings

#### zaffhub
- `AGENTS.md`, `AGENTS-ZAFFHUB.md`, `ROADMAP.md`: REFERENCE/merge into canonical governance and roadmap.
- `FULLPhase/PROMPT01.md` … `PROMPT22.md`: ARCHIVE-EVIDENCE; convert unfinished requirements into roadmap acceptance criteria rather than runtime code.
- `README.md`: DROP-DUPLICATE after useful context is merged.

#### ztsaff
- `tiktok-review-saas/backend/server.js`: PORT selected domain behavior only; do not lift monolithic Express server wholesale.
- `tiktok-review-saas/database/init.sql`: PORT into versioned migrations after schema normalization.
- `tiktok-review-saas/frontend/*`: REFERENCE for UX/features; rebuild against canonical API contracts.
- `tiktok-review-saas/.env`: QUARANTINE-SECRET. Runtime secret material is tracked in the public repository and must be rotated/revoked; do not copy.
- `exports/gitea-plathform-clean/**`: REFERENCE for deployment/backup/runner patterns only; exclude unrelated Gitea platform machinery from the affiliate domain.
- `ROOT_PROJECT_SOURCE_MERGED.md`, `Gitea-plathform.md`: ARCHIVE-EVIDENCE, not executable source.

#### tiktok-shop-bot
- `src/cli.py`: PORT CLI semantics behind canonical application service; current code imports missing `src.utils` and therefore is not self-contained.
- `src/outreach.py`: PORT consent-aware outreach orchestration, quiet-hour/budget semantics; replace direct SMTP calls with provider adapter + durable outbox.
- `src/rate_limit.py`, `src/dedupe.py`, `src/templating.py`: PORT small deterministic primitives with tests.
- `template/*.md`: MIGRATE as versioned outreach templates.
- `requirements.txt`: REFERENCE only; consolidate dependencies in canonical workspace.

#### tiktok-shop-sdk
- `packages/**`/SDK source and API contracts: MIGRATE/PORT as the canonical TypeScript TikTok adapter.
- `apps/docs/**`: REFERENCE/MIGRATE documentation after removing generated cache.
- `apps/docs/.vitepress/cache/**`: DROP-GENERATED; generated VitePress cache is incorrectly tracked and must not enter canonical source.
- `.github/workflows/ci.yml`, `publish.yml`: REFERENCE; rebuild under canonical supply-chain policy.
- Husky/Prettier/package metadata: REFERENCE and deduplicate into monorepo root tooling.

#### tiktokshop-php
- `src/Auth.php`, `Client.php`, `Resource.php`, `Webhook.php`: PORT into maintained PHP compatibility package only if PHP consumers are verified.
- `src/Resources/*`: REFERENCE endpoint coverage and behavioral parity matrix against TypeScript adapter.
- `tests/*`, `phpunit.xml`: MIGRATE parity tests where behavior remains supported.
- `.github/workflows/ci.yml`, Composer metadata: REFERENCE; recreate with canonical release controls.

#### zlttbots
- `apps/*`, `packages/*`, `services/*`: primary donor for multi-service architecture, auth, billing, workers, affiliate-marketing, shared contracts and platform services.
- `infra/*`, deployment/runtime scripts: PORT selectively; preserve resiliency/observability patterns, avoid unrelated services.
- `.github/workflows/*`, CodeQL configuration: MIGRATE/PORT hardened security and CI patterns after minimizing privileges.
- `agents/*`: REFERENCE/PORT bounded orchestration patterns; production mutations require explicit policy/approval/idempotency.
- docs/security, operations and architecture material: ARCHIVE-EVIDENCE + merge useful controls into canonical docs.

#### zttlbots
- `zlinebot-lean/app/src/llm/*`: PORT provider routing, caching, safety and tool-runner abstractions only where affiliate workflows need them.
- `zlinebot-lean/app/src/billing/*`: PORT ledger/meter/guard semantics into canonical billing boundary.
- `zlinebot-lean/app/src/core/security.ts`, config/logger/region routing: PORT hardened cross-cutting primitives.
- LINE-specific routes/integration: optional adapter; keep outside core affiliate domain.
- historical tracked runtime environment files must remain excluded; preserve the security remediation commit as evidence.

## Deduplication matrix

| Capability | ztsaff | bot | TS SDK | PHP SDK | zlttbots | zttlbots | Canonical owner |
|---|---|---|---|---|---|---|---|
| TikTok API client/auth | partial | no | strong | strong | partial | no | `packages/tiktok-adapter` |
| Affiliate campaign/creator/seller APIs | partial | outreach only | strong | strong | strong | no | `services/affiliate-core` + adapter |
| Outreach/templates | no | strong | no | no | partial | messaging | `services/outreach` |
| Webhooks | partial | no | strong | strong | strong | LINE webhook | `services/webhook-ingress` |
| Auth/RBAC | basic JWT | no | library auth only | library auth only | strong | partial | `services/identity` |
| Billing/wallet/metering | wallet/rental | no | no | no | strong | strong | `services/billing` |
| LLM/content automation | script generator | no | no | no | strong | strong | `services/content-ai` |
| Queue/workers | limited | no | no | no | strong | partial | `services/workflow` |
| Observability/resiliency | limited | no | client-level | client-level | strong | partial | shared platform runtime |
| CI/security scanning | mixed | minimal | strong baseline | basic | strongest | basic | canonical `.github/` |

## Missing-feature matrix

| Production capability | Current stack status | Required canonical state |
|---|---|---|
| Tenant isolation | fragmented/unclear | tenant_id enforced at API, DB, queue, audit layers |
| Durable workflow/idempotency | partial in zlttbots | deterministic idempotency keys + durable state machine |
| OAuth/token lifecycle | split across SDKs | encrypted token vault, refresh locking, expiry/revocation handling |
| Webhook authenticity/replay defense | inconsistent | signature verification + timestamp window + dedupe store |
| Secret governance | unsafe in ztsaff | no tracked secrets, scanning, rotation runbook, least privilege |
| Data migrations | ad hoc SQL | versioned migrations + backward-compatible expand/contract |
| Audit trail | fragmented | append-only actor/action/tenant/request/correlation evidence |
| Rate limits/backoff | local primitives | platform-aware distributed quotas, jitter, Retry-After support |
| Outbox/event delivery | missing/partial | transactional outbox + retry/DLQ + idempotent consumers |
| Consent/compliance | partial outreach note | consent state, suppression list, unsubscribe/evidence policy |
| SLO/observability | uneven | metrics/logs/traces, dashboards, alerts, runbooks, error budgets |
| DR/rollback | fragmented scripts | tested backup/restore, RPO/RTO, release rollback gates |
| Supply-chain security | uneven | lockfiles, SAST/SCA/secret scan, SBOM, provenance/signing policy |
| Contract testing | SDK-specific | cross-language parity + sandbox/integration contract suites |
| Multi-platform adapters | TikTok-heavy | adapter boundary for TikTok/Shopee/LINE without core coupling |

## Critical defects / risks discovered

1. `ztsaff/tiktok-review-saas/.env` is tracked and contains secret-like runtime values. Treat them as compromised and rotate/revoke before production use.
2. `tiktok-shop-bot/src/cli.py` and `src/outreach.py` import `.utils`, but `src/utils.py` is absent from the audited tree; current CLI is incomplete/broken unless supplied externally.
3. `tiktok-shop-sdk` tracks generated `.vitepress/cache` artifacts, increasing repository noise/supply-chain surface.
4. `ztsaff` mixes affiliate SaaS code with unrelated Gitea platform/export artifacts; direct monorepo import would preserve substantial accidental complexity.
5. PHP and TypeScript SDKs overlap heavily. TypeScript becomes primary; PHP is compatibility-only and must pass parity tests or be retired.
6. Legacy automation must not be copied with broad mutation privileges; all canonical mutation workers require explicit scoped grants, idempotency, audit evidence and bounded retries.

## Audit completeness rule

A repository is migration-complete only when every blob in its pinned source snapshot appears in the machine-readable migration ledger with source SHA, classification, canonical destination (or drop reason), validation evidence, and reviewer decision. Deletion is forbidden until that ledger reaches 100% and all rollback gates pass.
