# Operator Handbook — Campaign Operations

Current release scope: campaign primitives exist in contracts and affiliate-core (products → offers → links), while the full planner/budget/audience surfaces are deferred (see `RELEASE-READINESS.md` deferred list). Operators work with the building blocks below.

## Lifecycle you can operate today

1. **Product** — registered per tenant via affiliate-core runtime (`registerProduct`).
2. **Offer** — `publishOffer` with immutable minor-unit price snapshots; commercial truth enforced by `packages/affiliate-core/src/commerce.js`.
3. **Affiliate link** — `generateLink` with slug + optional expiry; served by `/go/:slug`.
4. **Attribution** — clicks/conversions flow through webhook ingress into the runtime; canonical envelopes persist to `analytics_events`.

## Guardrails that act on your behalf

- **Commercial revalidation** (`commerce.js`): stale price or expired promotion BLOCKs content claims — creative generated at an old price will not publish against new truth.
- **Automation policy**: every autonomous decision routes through `/api/v1/intelligence/gate`; modes MANUAL→AUTONOMOUS with kill switches (see `automation.md`).
- **Idempotent conversion ingestion**: duplicate webhooks (same event id) never double count.

## Verifying a campaign's numbers

```sh
curl -s https://zaffiliate.zeaz.dev/api/v1/analytics/overview -H 'x-tenant-id: <tenant>'
curl -s https://zaffiliate.zeaz.dev/api/v1/commerce/offers    -H 'x-tenant-id: <tenant>'
curl -s https://zaffiliate.zeaz.dev/api/v1/intelligence/recommendations -H 'x-tenant-id: <tenant>'
```

Overview fields: `clicks`, `conversions`, `grossCommissionMinorUnits`, `netCommissionMinorUnits`, `epcMinorUnits`. Revenue semantics: only `commission_reported` events with non-pending status count toward gross/net.

## Known limitations (transparent, not bugs)

- No calendar UI/API yet (AFF-230+ deferred).
- Meta/YouTube are publishing-boundary only until credentials land (B2).
- Webhook conversions live in the runtime outbox; the analytics envelope bridge for them is on the roadmap — use outbox-aware tooling when reconciling.
