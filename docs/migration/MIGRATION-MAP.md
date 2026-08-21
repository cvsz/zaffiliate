# Migration Map

## Canonical target

`cvsz/zaffiliate` becomes the sole active affiliate-commerce source of truth. Legacy repos stay intact until cutover gates pass.

## Target repository layout

```text
apps/
  api/
  web/
  worker/
packages/
  contracts/
  db/
  observability/
  security/
  tiktok-adapter/
  php-tiktok-compat/        # optional; parity-gated
services/
  affiliate-core/
  identity/
  outreach/
  webhook-ingress/
  workflow/
  billing/
  content-ai/
  audit/
docs/
  architecture/
  operations/
  security/
  migration/
infra/
  compose/
  terraform/
.github/workflows/
```

## Source-to-target mapping

| Source | Canonical destination | Strategy |
|---|---|---|
| `zaffhub/ROADMAP.md`, AGENTS docs, phase prompts | `docs/migration/evidence/zaffhub/`, ROADMAP acceptance criteria | preserve evidence, normalize requirements |
| `ztsaff/tiktok-review-saas/backend/server.js` | identity/billing/content-ai/application endpoints | behavioral port, not copy-paste |
| `ztsaff/tiktok-review-saas/database/init.sql` | `packages/db/migrations/` | normalize + version |
| `ztsaff/tiktok-review-saas/frontend` | `apps/web` | UX reference + rewrite against contracts |
| `tiktok-shop-bot/src/*` | `services/outreach` + CLI adapter | port deterministic behavior; replace missing utils/direct SMTP |
| `tiktok-shop-bot/template/*` | `services/outreach/templates` | migrate with version metadata |
| `tiktok-shop-sdk` SDK source | `packages/tiktok-adapter` | primary TikTok implementation |
| `tiktok-shop-sdk/apps/docs` | `docs/integrations/tiktok` | preserve useful docs; drop generated cache |
| `tiktokshop-php/src/*` | `packages/php-tiktok-compat` | compatibility-only; parity-gated |
| `zlttbots/apps/packages/services` affiliate/runtime slices | services/packages above | selective port; primary enterprise donor |
| `zlttbots/infra`, ops, security | `infra`, `.github`, docs | selective hardening port |
| `zttlbots` LLM/billing/security primitives | content-ai/billing/security | port reusable abstractions; LINE remains optional adapter |

## History preservation

Before destructive action, create and verify all of the following for every legacy repo:

1. `git clone --mirror` backup.
2. `git bundle create <repo>.bundle --all` and `git bundle verify`.
3. export issues/PRs/releases/actions metadata if needed for audit retention.
4. record default-branch HEAD SHA, tags, branch refs and bundle SHA-256 in `docs/migration/evidence/legacy-manifest.json`.
5. optionally add legacy histories into `zaffiliate` as namespaced refs (`refs/legacy/<repo>/*`) or preserve signed bundles in immutable storage; do not squash away provenance.

## Migration ledger schema

Each source blob must be represented by a row/object with:

`source_repo`, `source_ref`, `source_path`, `blob_sha`, `classification`, `target_path`, `target_commit`, `validation`, `notes`, `reviewed_by`, `reviewed_at`.

Allowed classification: `MIGRATE`, `PORT`, `REFERENCE`, `DROP-GENERATED`, `DROP-DUPLICATE`, `QUARANTINE-SECRET`, `ARCHIVE-EVIDENCE`.

## Cutover sequence

1. Freeze feature development in legacy repos; emergency fixes only.
2. Mirror/bundle backups and validate hashes.
3. Import canonical contracts, DB model and security primitives.
4. Migrate TikTok adapter and contract tests.
5. Migrate affiliate core, outreach, webhook and workflow services.
6. Migrate billing, identity, content AI and web UI.
7. Run dual-read/shadow execution where safe; no double mutation.
8. Migrate data with reconciliation reports.
9. Switch production traffic behind reversible feature flags/routes.
10. Observe at least one full operational/business cycle with SLOs green.
11. Archive legacy repos first. Deletion requires a separate final gate and verified restore exercise.

## Rollback triggers

Rollback immediately on authorization/tenant-boundary breach, data reconciliation mismatch, webhook loss/duplication above budget, payment/ledger inconsistency, sustained SLO violation, token-refresh regression, or inability to restore a verified backup.

## Deletion prohibition

Legacy repositories must not be deleted merely because code exists in `zaffiliate`. Deletion requires 100% ledger classification, verified backups, successful restore drill, security rotation completion, production parity evidence, owner approval, and an independently reversible archive period.
