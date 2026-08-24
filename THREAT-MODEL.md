# zaffiliate Threat Model

Updated: 2026-08-23 · Companion to `SECURITY.md`. Failure mode everywhere: **fail closed**.

## Assets

provider credentials/tokens, tenant data (contacts, orders, revenue), affiliate links, session/API keys, audit chain integrity, publishing reputation.

## Threat register

| Threat | Control | Evidence |
|---|---|---|
| Cross-tenant access | tenant equality checks in every runtime + Postgres RLS | `packages/contracts/src/tenancy.js`, `db/tests/rls.sql`, `test/tenancy.test.js` |
| Privilege escalation | role-rank gate, owner/admin-only grants, escalation attempts logged | `grants.js attemptEscalation`, `test/audit-grants.test.js` |
| Audit tampering | append-only SHA-256 hash-chained events | `packages/contracts/src/audit.js` |
| Webhook forgery | HMAC signature verification before acceptance | `tiktok-shop/src/webhook.js`, signing tests |
| Webhook replay/reorder | replay guard + event dedupe store | `tiktok-shop/src/event-dedupe.js` |
| SSRF via outbound calls / link targets | URL validation allowlist + transport boundary on all adapter egress | `security/src/url-validation.js`, `adapters/src/transport-boundary.js`, `test/ssrf-validation.test.js` |
| Secret leakage to browser | `ref:`-only secret manager; manifests reject non-server-only secret modes; provider registry enforces same | `security/src/secrets.js`, `capabilities.js`, `provider-registry.js` |
| Log-based leakage | redaction pipeline in logger + security pkg | `observability/src/index.js`, `security/src/redaction.js` |
| XSS in control plane | CSP-first static app: no inline script/style; traversal-safe file serving | `apps/web/*`, `test/web-surfaces.test.js` |
| Open redirect via `/go/:slug` | Endpoint live and tenant-gated: stored targets re-validated HTTPS-only at request time, expiry enforced (410), javascript:/data: impossible to serve, unknown/foreign slugs indistinguishable 404 | `apps/api/src/business.js`, `test/api-business-routes.test.js` |
| Malicious webhook (generic platforms) | HMAC-SHA256 over timestamp+body with timing-safe compare; capability-gated platform allowlist; 401 precedes all state changes; 1 MiB cap | `apps/api/src/business.js` |
| SQL injection | parameterized repo access pattern; migrations reviewed; RLS tests | `db/migrations/*.sql` |
| Unbounded automation | capability states: mutating ops default `approval_required`; `manual` never automatable; `temporarily_disabled` fails closed | `adapters/src/provider-registry.js`, 10 dedicated tests |
| AI tool abuse / runaway spend | pre-call budget metering + moderation boundary + agent tool grants | `ai-content/runtime.js`, `workflow` grant engine |
| Duplicate conversion/payout | idempotent conversions on orderRef; balanced double-entry ledger | `affiliate-core`, `identity-billing` ledger tests |
| Supply chain | zero runtime deps except pinned supabase-js; SBOM + attestation scripts | `package.json`, `scripts/generate-sbom.mjs` |
| Click-flood / redirect DoS (public `/go/:slug`) | per tenant+IP token-bucket throttle with 429 + Retry-After, fail-closed | `packages/security/src/rate-limit-api.js`, `test/api-security-ingress.test.js` |
| Webhook flooding on ingress | per tenant+platform throttle before signature work; throttling recorded as security events | same |
| Forged cross-site approval decisions (CSRF) | mutating web route requires custom CSRF header + JSON content-type + exact Origin/host match; failures are 403 with zero state mutation | `apps/web/server.js approveWorkflow`, `test/web-csf.test.js`.replace('csf','csrf') |
| Undetected attack probing | SecurityEvent recorder (typed, frozen, counted): RATE_LIMITED, WEBHOOK_SIGNATURE_FAILURE, WEBHOOK_REPLAY_DENIED, CROSS_TENANT_ACCESS_DENIED, SSRF_BLOCKED, AGENT_PERMISSION_DENIED, KILL_SWITCH_CHANGED… wired into API ingress for rate-limit and signature-failure signals | `packages/security/src/security-events.js` |

## Residual risks / accepted gaps

1. No password/OIDC login yet → account takeover surface limited to API keys/sessions; OAuth browser flow is MM-004.
2. Runtimes default in-memory → durability gap until MM-003; `packages/db` client+migrator now exist (drift fails closed, credentials never logged) but runtimes are not yet re-pointed.
3. No storage adapter → no upload path-traversal surface today, but media features stay blocked.
5. Live provider credentials absent → all live-integration threats currently unexercisable; sandbox mocks only.
6. JWT/OIDC token verification is now enforced through JWKS (RS256-only, kid-pinned, cached w/ once-per-generation forced refresh — self-DoS proof); alg=none/HS256 rejected structurally.
7. Cross-tenant attempts on `/go/:slug` are indistinguishable from unknown slugs by design (anti-enumeration), so they are not separately recorded as security events — residual observability gap accepted deliberately.
7. Rate limiting is in-process; multi-replica deployments will need a shared store (Redis) before horizontal scaling.
