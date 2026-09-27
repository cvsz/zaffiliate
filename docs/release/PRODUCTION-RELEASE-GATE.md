# Production Release Gate — Operator Checklist

This document is an evidence checklist, not deployment approval. CI success does not imply application production readiness or permission to publish on any provider.

## Controls implemented by the web hardening PR

- In production, the standalone Web API verifies the incoming bearer session through the existing backend /api/v1/auth/me, matching the tenant ID to the verified session; missing or failed authentication denies access.
- The self-host Web container uses APP_ENV=production and CONTROL_PLANE_AUTH_URL on the internal Compose application network.
- Fixture approvals, simulated revenue, synthetic worker health and mock audit or billing results must not appear in production Web API responses.
- The production container must contain compiled React assets, and CI verifies that the build includes an index and asset directory.
- The browser operator login/session handoff is not yet implemented: protected API calls deliberately remain unavailable until that workflow is completed and tested.

## Required verification before a customer-facing release

1. Implement and test browser login/session handoff, revoke/logout/expiry, role enforcement, CSRF and cross-tenant denial. Wire real tenant-scoped operational data providers and durable approvals.
2. Resolve code-scanning alert #2 from authenticated alert details and prove rotation of any reused secrets exposed in legacy ztsaff. Keep evidence private.
3. Run an isolated PostgreSQL dump and real restore with migration replay, data integrity, RPO/RTO and rollback. The current backup harness default dry run does not qualify.
4. Replace fail-open security scanner fallbacks with enforced scanners; publish SBOM and release provenance from the exact immutable image.
5. Verify provider API entitlements separately: TikTok, Shopee Video/Live, Facebook Reels and YouTube Shorts. No unapproved automatic publication.
6. Verify DNS, Cloudflare access policy, TLS, browser E2E, accessibility, responsive layout and alerts against the actual zaff.zeaz.dev deployment.
7. Require explicit operator sign-off for production cutover and retain a known-good rollback image and sealed backup.

## Staging commands

    npm ci
    npm run check
    npm test
    npm run build:web
    docker compose --env-file .env.selfhost -f compose.selfhost.yaml config --quiet
    docker compose --env-file .env.selfhost -f compose.selfhost.yaml build api web
    docker compose --env-file .env.selfhost -f compose.selfhost.yaml up -d
    curl -i http://127.0.0.1:3100/healthz

A protected request without authentication must return HTTP 401. A request with a valid session but no operational data provider must fail closed (503), not return synthetic financial metrics or success states.

## Rollback

Use the exact known-good immutable image after verified database compatibility checks. Rolling back application code cannot undo provider posts already accepted remotely; preserve remote status reconciliation and idempotency evidence.
