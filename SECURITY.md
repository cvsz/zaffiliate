# Security Policy and Migration Controls

## Security invariants

1. No runtime secrets in Git history, images, client bundles, logs or issue content.
2. Provider credentials stay server-side in a managed secret store.
3. Every request is authenticated where required and every mutation is explicitly authorized.
4. Tenant ownership is enforced in service and database access paths.
5. Webhooks are authenticated, replay-protected and idempotent.
6. Background workers receive least-privilege, short-lived credentials.
7. Sensitive mutations are auditable and fail closed.

## Immediate legacy incident action

`cvsz/ztsaff/tiktok-review-saas/.env` is tracked in a public repository and contains runtime secret-like values. Treat all values in that file and any reused equivalents as compromised.

Required before production cutover:

- rotate JWT signing secrets and admin/bootstrap credentials;
- rotate any database credentials if the committed URI matches a real environment;
- search all branches/tags/history for secret reuse;
- enable secret scanning/push protection where available;
- decide whether history rewrite is required, preserving a sealed forensic bundle before rewrite;
- document rotation timestamps and affected environments without recording secret values.

## Authentication and authorization

Use short-lived user sessions and scoped service identities. Prefer centralized policy checks with tenant, actor, resource, action and request context. Administrative bootstrap mechanisms are disabled after initial provisioning and never selected by a client-provided shared key in normal production flows.

## Secrets

Canonical configuration contains `.env.example` with placeholders only. Production uses environment/secret-manager injection. Logs must redact authorization headers, API keys, refresh tokens, webhook secrets, passwords and sensitive PII.

## TikTok/platform credentials

Encrypt refresh/access tokens at rest using envelope encryption. Serialize refresh per account to avoid token races. Store expiry, scope, account/tenant binding and rotation provenance. Revoke on disconnect and invalidate caches immediately.

## Webhooks

Validate platform signature using raw body where required; check timestamp freshness; bind signature to expected app/account/tenant; dedupe by immutable event ID; persist verified event before dispatch; reject oversized bodies and unsupported content types; rate-limit by source/app; maintain DLQ/replay tooling.

## Outreach safety/compliance

Maintain explicit consent/suppression state, unsubscribe evidence and channel policy. Enforce distributed send budgets and quiet hours. Never silently convert manual-DM flows into automated platform messaging where platform policy disallows it.

## Application security

- parameterized SQL/ORM only;
- schema validation for all external input;
- CSRF defenses where cookie auth is used;
- restrictive CORS allowlist in production;
- CSP/security headers for web UI;
- SSRF egress allowlists for URL-fetching features;
- upload content/size/type validation and isolated object storage;
- secure error handling without stack/secret leakage.

## Supply chain

CI must run: format/lint, unit tests, integration/contract tests, SAST, dependency/SCA scan, secret scan, IaC scan, container scan and SBOM generation. Release artifacts require immutable versioning and provenance. Local release policy requires GPG-signed commits/tags where the maintainer's signing key is available.

## GPG limitation of connector-based changes

GitHub connector file mutations use GitHub API commits and do not expose a commit-signature or signed-push primitive. Therefore connector-created migration documentation commits are not evidence of the requested local GPG commit/push gate. Before production cutover, a maintainer must perform the release/cutover commit from a trusted local environment with the configured GPG signing key and verify `git log --show-signature` plus remote commit verification.

## Security release gate

Cutover is blocked unless secret incident actions are closed, threat model is reviewed, high/critical findings are zero or explicitly risk-accepted, authorization/tenant isolation tests pass, webhook replay tests pass, SBOM/provenance artifacts exist and rollback credentials/backups are verified.
