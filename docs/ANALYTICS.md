# Analytics & Revenue Measurement

Canonical measurement layer. Source of truth for metric formulas — dashboards must consume these definitions, never re-derive their own.

## Event layer (`packages/analytics/src/events.js`)

- Canonical taxonomy: 17 event types from `product_viewed` to `payout_reported` (see `EVENT_TYPES`).
- Every envelope: `eventId`, `eventVersion='1'`, `eventType`, `occurredAt`, `receivedAt`, `lateArrivalMs`, `organizationId`, `provider`, `sourceType`, `dedupeKey`, `externalEventId`, `correlationId`, frozen `lineage{campaign_id, product_id, creative_id, content_id, publication_id, affiliate_link_id, click_id, provider_account_id}`, frozen `payload`.
- **Source classification is mandatory** (§3): FIRST_PARTY · PROVIDER_REPORTED · AFFILIATE_PROVIDER_REPORTED · IMPORTED · MODELED · ESTIMATED · PREDICTED. Unknown sources are rejected; MODELED/ESTIMATED/PREDICTED events may never be presented as provider-confirmed revenue.
- **Deterministic deduplication**: primary key `provider + external_event_id`; fallback fingerprint = sha256(`provider|account|type|sorted-payload-json|sourceTimestamp`) when no external id exists. Duplicate delivery returns `{accepted:false, duplicateOf}` and never mutates totals. Arrival order is irrelevant.

## Metric formulas (minor units; one definition each)

| Metric | Formula |
|---|---|
| Impressions / Clicks / Conversions | count of respective accepted, non-duplicate events |
| CTR | Clicks ÷ Impressions (0 when impressions absent — views are never silently substituted) |
| CVR | Conversions ÷ Affiliate Clicks |
| Gross Commission | Σ approved+ commission amounts |
| Pending Commission | Σ pending-status commission amounts (**excluded from net**) |
| Refunds + Reversals | Σ refund_reported + commission_reversed amounts |
| Net Commission | max(0, Gross − Refunds − Reversals) — floor at zero; refunds can never create negative revenue |
| EPC | round(Net Commission ÷ Affiliate Clicks) |

## Privacy

Click events require affiliate-link lineage only; no raw IP retention at this layer (visitor identity is a salted hash upstream in the redirect route). Raw provider payloads are preserved immutably for reconciliation; retention policies are defined per class in PRIVACY.md.

## Lineage guarantee

Any revenue number produced by `store.summarize()` traces to immutable stored envelopes via `rawEvents(orgId)`; every envelope carries its dedupe key so a figure can be explained event-by-event.
