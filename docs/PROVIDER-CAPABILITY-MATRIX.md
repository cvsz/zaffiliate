# Provider Capability Matrix

Derived from `packages/adapters/src/capabilities.js` (canonical manifests) + `packages/adapters/src/provider-registry.js` state resolution. Defaults: read-only → `available`; mutating/publishing/messaging → `approval_required` until an approval id is presented; explicit overrides may pin `manual`, `unsupported` or `temporarily_disabled`.

Legend: A=available · AR=approval_required · M=manual · U=unsupported · TD=temporarily_disabled

| Capability | tiktok | shopee | lazada | facebook | instagram | youtube | line |
|---|---|---|---|---|---|---|---|
| catalog.read | A | A | A | U | U | U | U |
| orders.read | A | A | A | U | U | U | U |
| affiliate.links.write | AR | AR | AR | U | U | U | U |
| campaigns.write | AR | U | U | U | U | U | U |
| content.publish | AR | U | U | AR | AR | AR | U |
| messages.send | U | U | U | U | U | U | AR |
| analytics.read | A | A | A | A | A | A | A |
| webhooks.receive | A | A | A | A | A | A | A |

Notes:
- TikTok is first-class: full SDK in `packages/tiktok-shop` (signing, auth, resilience, pagination, resources).
- Meta/YouTube rows reflect the publishing boundary only; catalog/order reads are `unsupported`, not faked.
- All live calls additionally BLOCKED on credentials (see IMPLEMENTATION-CHECKLIST.md #28); sandbox contract tests only.
- Extend per platform via `createProviderAdapter({ manifest, capabilities: { '<cap>': { state, reason } } })`. Unknown capabilities resolve to `unsupported` and never automate.
