# zaffiliate Compliance Architecture

Updated: 2026-08-23

## Principles

- Official APIs and authorized integrations only. Capabilities that lack an official API are marked `manual`, `approval_required` or `unsupported` by `packages/adapters/src/provider-registry.js`; browser automation or ToS circumvention is prohibited by design (registry cannot express it).
- No fabricated claims, reviews, discounts, scarcity, earnings or performance. AI content is grounded in product data via `packages/ai-content` provenance hashes + prompt versioning.
- Human control: mutating/publishing capabilities default to `approval_required`; the workflow engine's approval inbox with TTL fail-closed expiry is the single gate (`packages/workflow`, web approve endpoint).

## Controls by domain

| Domain | Control |
|---|---|
| Affiliate disclosure | `ContentItemSchema.disclosureRequired` enforced at contract layer; publisher approval gate blocks undisclosed creative from scheduling |
| AI-generated-content disclosure | disclosure flags ride on content items; moderation boundary in ai-content runtime |
| Copyright/trademark | no third-party media ingestion path exists; storage adapter (future) will carry license metadata before publish |
| Privacy | tenant isolation (RLS), consent/suppression registry in outreach, privacy-conscious click attribution (visitor hash only), log redaction, `ref:` secret manager keeps secrets out of payloads/logs |
| Data retention / DR | backup-restore drill + cutover + reconcile scripts under `scripts/`; migration contract forbids legacy deletion without evidence |
| Platform rules | per-platform capability manifests (`capabilities.js CanonicalAdapterManifests`) + rate-limit token bucket; policy registry versioning = TODO (MM-007) |
| Auditability | append-only hash-chained audit events for every authorization decision |

## Provider policy registry requirements (master meta §25)

Each provider entry must eventually expose: capabilities, restrictions, required_disclosures, rate_limits, content_constraints, last_verified_at. Current manifests cover capabilities + idempotency/webhook flags; restrictions/disclosure/rate fields are **MISSING** — tracked as MM-007.

## Verification

- 257/257 tests green including tenancy, audit-chain, SSRF, webhook dedupe/replay, approval-TTL suites.
- Security gates in CI: secret scan, SSRF guard, syntax check (`npm run check`), full test run.
