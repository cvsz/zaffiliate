# Production Release Gate v2

A customer-facing production release is authorized only when **all** evidence below is PASS on the exact deployed commit/image. Source implementation and green unit tests are necessary but do not substitute for deployment evidence.

## Automated repository gates

- Browser BFF exchanges local-auth bearer sessions for `__Host-` HttpOnly + Secure + SameSite=Strict cookies. The browser never receives the bearer token in a response body.
- Tenant scope is bound to the verified session; a conflicting `x-tenant-id` is denied.
- Owner/admin role plus single-use CSRF is required for durable workflow approvals.
- Dashboard, revenue, billing, audit, approvals, analytics funnel, worker queue depth and provider state are read from tenant-scoped PostgreSQL data. Unknown subscription/provider facts remain unknown; they are not synthesized.
- CodeQL alert #2 is recorded on PRs and must be closed on `main` before a production release.
- Production-equivalent CI builds candidate and known-good images, snapshots PostgreSQL 17, restores into a clean PostgreSQL 17 instance, replays migrations/RLS/golden flows, then boots candidate and known-good images and records rollback RTO.
- The manual `Production Release Gate` workflow verifies DNS, TLS, HSTS/security headers, compiled SPA routes, anonymous API denial and real Chromium browser smoke.

## Operator evidence required

### Legacy credential incident

Do not place credentials in GitHub variables, artifacts or issue comments. Rotate/revoke every real credential that may have been copied or reused from the public legacy `cvsz/ztsaff` history, then store a private incident artifact and configure only these non-secret attestations:

- `LEGACY_CREDENTIAL_ROTATION_AT`: UTC rotation completion timestamp.
- `LEGACY_CREDENTIAL_ROTATION_EVIDENCE_SHA256`: SHA-256 of the private incident evidence document.
- `LEGACY_CREDENTIAL_INCIDENT_REF`: non-secret ticket/evidence identifier.

The release workflow fails closed if these attestations are absent or malformed.

### Provider entitlement evidence

Store sanitized entitlement evidence in the protected GitHub secret `PROVIDER_ENTITLEMENT_EVIDENCE_JSON`. Never include provider tokens, client secrets, cookies, passwords or authorization headers.

Required fresh capability evidence:

- TikTok: `content.publish`
- Shopee: `affiliate.read`, `video.publish`, `live.publish`
- Meta: `reels.publish`
- YouTube: `videos.insert`

Each provider record must contain `verifiedAt`, `accountRef`, `environment`, `source`, and a boolean `capabilities` object. The release workflow defaults to a maximum age of 30 days. Missing permissions block automatic publishing rather than triggering browser automation or undocumented endpoints.

### Approved production snapshot

CI DR evidence is an ephemeral production-equivalent rehearsal. Before cutover, repeat the restore/rollback runbook against an approved sanitized production snapshot, record measured RPO/RTO and confirm the known-good artifact can operate against the resulting schema. Do not point destructive rehearsal scripts at the live database.

## Release workflow

Run **Actions → Production Release Gate → Run workflow** against the exact HTTPS deployment URL only after the candidate image is deployed to the approved staging/production slot. A PASS bundle contains:

- code-scanning alert state;
- credential-rotation attestation state;
- provider-entitlement decision;
- DNS/TLS and security-header evidence;
- Chromium browser smoke output;
- exact commit/run identity from GitHub Actions.

No PR merge, CI badge or documentation statement alone authorizes live provider publishing or customer traffic.
