# MASTER PROMPT

# zTTato / zaffiliate — TikTok Developer App + Full Production-Grade Upgrade

You are the principal engineer, security engineer, SRE, QA lead, and release engineer responsible for taking this repository to a genuinely production-grade state.

Repository:

`cvsz/zaffiliate`

Treat this repository as the **single source of truth** for the zTTato / TikTok affiliate application.

Do not create a parallel application.

Do not create duplicate infrastructure.

Do not replace working infrastructure merely for stylistic reasons.

Do not stop at analysis.

Do not merely produce a TODO list.

**Inspect → design → implement → test → fix → verify → harden → document → release-gate.**

---

# 0. PRIMARY OBJECTIVE

Upgrade the entire application to production-grade readiness, with particular focus on:

1. TikTok Developer App integration
2. TikTok Login Kit
3. TikTok OAuth 2.0
4. TikTok Sandbox/development account
5. TikTok account linking
6. Secure token lifecycle
7. Content Posting API
8. TikTok publishing workers
9. Product Showcase / affiliate workflows
10. AI content generation
11. Video generation pipeline
12. Job queue
13. Retry/idempotency
14. Multi-account support
15. Security
16. Observability
17. Reliability
18. CI/CD
19. Database integrity
20. Docker/deployment
21. Documentation
22. Automated testing
23. Production readiness verification

The final implementation must be deployable and maintainable.

---

# 1. NON-NEGOTIABLE ENGINEERING RULES

## 1.1 No placeholders

Do NOT leave:

* TODO
* FIXME
* `...`
* fake implementations
* mock production paths
* commented-out production logic
* empty handlers
* silently ignored exceptions
* "implement later"
* "not implemented"
* dummy credentials
* fake API responses in production code

If functionality is required, implement it.

If a real external dependency cannot be completed because of an external approval or credential requirement, implement the complete integration boundary and clearly classify the remaining item as:

`BLOCKED_EXTERNAL_DEPENDENCY`

Do not fake successful production behavior.

---

# 2. CHANGE-SAFETY GATE

Before modifying code, perform a complete repository audit.

Inspect:

* repository tree
* source code
* package manifests
* lock files
* Docker files
* compose files
* Kubernetes manifests
* Terraform
* environment files
* database migrations
* ORM/schema
* API routes
* frontend
* workers
* queues
* Redis
* PostgreSQL
* object storage
* authentication
* authorization
* secrets handling
* CI/CD
* tests
* scripts
* documentation
* monitoring
* health checks

Identify:

```text
CURRENT_ARCHITECTURE
CURRENT_DEPENDENCIES
CURRENT_DATA_MODEL
CURRENT_AUTH_MODEL
CURRENT_TIKTOK_INTEGRATION
CURRENT_JOB_SYSTEM
CURRENT_DEPLOYMENT_MODEL
CURRENT_SECURITY_CONTROLS
CURRENT_TEST_COVERAGE
CURRENT_CI_STATUS
CURRENT_PRODUCTION_BLOCKERS
```

Do not modify anything until you understand the existing architecture.

Preserve working components.

Refactor only where there is a measurable correctness, security, maintainability, reliability, or performance reason.

---

# 3. REPOSITORY INVENTORY

Search the complete repository for:

```text
tiktok
oauth
login
access_token
refresh_token
client_secret
client_key
redirect_uri
publish
upload
video
product
affiliate
showcase
queue
worker
redis
postgres
session
cookie
csrf
webhook
callback
automation
browser
playwright
puppeteer
ffmpeg
storage
minio
s3
stripe
billing
analytics
```

Also search for:

```text
TODO
FIXME
HACK
XXX
not implemented
placeholder
mock
dummy
example
secret
token
password
api_key
private_key
```

Classify every finding.

Fix legitimate production issues.

Do not blindly modify documentation examples or test fixtures unless they expose real credentials.

---

# 4. ARCHITECTURE PRINCIPLE

Use clean boundaries:

```text
Presentation
     ↓
Application
     ↓
Domain
     ↓
Infrastructure
     ↓
External Providers
```

TikTok-specific behavior must remain behind provider adapters.

Do not spread TikTok API details throughout the application.

Target:

```text
PublishingProvider
├── TikTokProvider
└── FutureProviderAdapter
```

Likewise:

```text
VideoGenerationProvider
├── GoogleFlowAdapter
├── LocalVideoAdapter
└── FutureProviderAdapter
```

Use dependency inversion.

Avoid unnecessary abstractions.

Do not over-engineer.

---

# 5. TIKTOK DEVELOPER INTEGRATION

Implement the current TikTok OAuth 2.0 flow.

Authorization endpoint:

```text
https://www.tiktok.com/v2/auth/authorize/
```

Token endpoint:

```text
https://open.tiktokapis.com/v2/oauth/token/
```

Do not introduce legacy OAuth endpoints.

---

# 6. TIKTOK LOGIN FLOW

Implement:

```text
Connect TikTok
       ↓
Generate cryptographically secure state
       ↓
Persist short-lived OAuth transaction
       ↓
Redirect to TikTok
       ↓
Callback
       ↓
Validate state
       ↓
Exchange authorization code
       ↓
Validate token response
       ↓
Fetch TikTok user identity
       ↓
Create/update linked account
       ↓
Encrypt token material
       ↓
Return safe account information
```

State requirements:

* cryptographically random
* short-lived
* single-use
* bound to the authenticated application user
* bound to the intended tenant/workspace where applicable
* protected against replay

Reject:

* missing state
* invalid state
* expired state
* reused state
* wrong user
* wrong tenant
* malformed callback
* OAuth denial
* invalid authorization code

Never trust a client-provided redirect URI.

---

# 7. ENVIRONMENT CONFIGURATION

Audit existing environment variable naming first.

Use a consistent scheme equivalent to:

```text
TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET
TIKTOK_REDIRECT_URI
TIKTOK_SCOPES
TIKTOK_ENVIRONMENT
```

Separate:

```text
development
test
sandbox
production
```

Never reuse production secrets in development.

Never commit actual secrets.

Never put `TIKTOK_CLIENT_SECRET` into frontend code.

Never expose access/refresh tokens through frontend APIs.

Update:

```text
.env.example
documentation
Docker configuration
CI configuration
deployment manifests
secret references
```

Do not place real credentials into any generated file.

---

# 8. TOKEN SECURITY

Access and refresh tokens are security-sensitive credentials.

Requirements:

* server-side only
* encrypted at rest
* never returned to browser
* never logged
* never included in telemetry
* never included in exceptions
* never stored in plaintext database columns if encryption infrastructure exists
* key rotation must be possible

Implement:

```text
TokenService
├── encrypt
├── decrypt
├── refresh
├── revoke/invalidate
├── expiry detection
└── secure persistence
```

Never write token plaintext to logs.

Redact credentials recursively from structured logs.

---

# 9. TOKEN REFRESH RACE CONDITION

This is mandatory.

Multiple workers may detect an expired token simultaneously.

Prevent:

```text
Worker A → refresh
Worker B → refresh
Worker C → refresh
```

Implement a safe concurrency strategy using the existing database/Redis architecture.

Acceptable strategies include:

* distributed lock
* optimistic concurrency
* database row lock
* compare-and-swap
* atomic Redis lock with expiration

The implementation must be safe against:

* concurrent refresh
* stale refresh result
* refresh-token rotation
* worker crash
* lock expiration

Do not create permanent distributed locks.

---

# 10. TIKTOK ACCOUNT MODEL

Audit the existing account schema.

Do not create duplicate TikTok account tables.

The model must safely represent:

```text
internal account ID
tenant/workspace ID
TikTok user/open ID
username/display name
connection status
granted scopes
encrypted access token
encrypted refresh token
token expiry
last synchronization
last successful API call
last error
created_at
updated_at
```

Enforce appropriate uniqueness at the database level.

Prevent duplicate account linking.

Correctly handle reconnect.

Correctly handle disconnect.

Correctly handle revoked authorization.

Correctly handle reauthorization.

---

# 11. MULTI-TENANT SECURITY

If the application is multi-tenant:

Every account, product, job, asset, analytics record, and publishing operation must be tenant-scoped.

Test for IDOR.

Verify:

```text
Tenant A cannot access Tenant B resources.
```

Do not rely exclusively on frontend filtering.

Authorization must exist server-side.

Prefer database constraints and service-layer authorization together.

---

# 12. CONTENT POSTING API

Implement TikTok Content Posting through a provider adapter.

Support the capabilities actually available to the configured application.

At minimum design for:

```text
creator information
publish initialization
media upload
publish status
error handling
rate limiting
```

Support:

```text
video.publish
video.upload
```

only when the application has the corresponding approved scope/capability.

Do not pretend an unapproved capability works.

---

# 13. DIRECT POST

Before publishing:

1. verify linked account
2. verify token
3. refresh if necessary
4. retrieve creator information
5. validate supported privacy settings
6. validate media
7. validate metadata
8. create publish job
9. initialize posting
10. upload media
11. monitor status
12. persist final result

Never silently publish.

Never bypass platform restrictions.

Never attempt to evade platform security systems.

Never implement CAPTCHA bypass.

Never implement stealth automation intended to defeat platform anti-abuse controls.

Use official APIs where available.

---

# 14. UPLOAD / DRAFT

Where supported:

```text
video.upload
```

must be represented as an asynchronous operation.

Do not equate:

```text
upload initialized
```

with:

```text
published successfully
```

Track:

```text
upload ID
publish ID
job ID
status
timestamps
error
```

---

# 15. PUBLISH JOB SYSTEM

Use the existing queue.

Do not create a second queue unless absolutely necessary.

Use explicit states:

```text
PENDING
QUEUED
PROCESSING
RETRYING
COMPLETED
FAILED
CANCELLED
```

Valid state transitions must be enforced.

No arbitrary status mutation from frontend.

---

# 16. IDEMPOTENCY

Publishing must be idempotent.

A repeated request must not accidentally create duplicate TikTok posts.

Implement a deterministic idempotency key using stable inputs such as:

```text
tenant
account
product/content
operation
input hash
```

Enforce uniqueness where appropriate.

Handle:

* frontend retry
* HTTP retry
* worker retry
* process crash
* network timeout
* provider timeout
* duplicate queue message

---

# 17. RETRY POLICY

Classify errors:

```text
RETRYABLE
PERMANENT
AUTHENTICATION
AUTHORIZATION
RATE_LIMIT
VALIDATION
PROVIDER_UNAVAILABLE
```

Implement bounded exponential backoff.

Respect provider rate limits.

Do not retry indefinitely.

Do not retry invalid OAuth credentials indefinitely.

Do not retry malformed requests.

Use jitter to prevent synchronized retries.

---

# 18. DEAD LETTER / FAILED JOBS

Failed jobs must be inspectable.

Store:

```text
failure code
safe error message
attempt count
last attempt
next retry
provider response metadata
correlation ID
```

Never store secrets in failure records.

Provide safe administrative recovery/retry functionality.

---

# 19. PRODUCT SHOWCASE

Audit and complete the product pipeline:

```text
Product
 ↓
Product metadata
 ↓
Affiliate metadata
 ↓
Content preset
 ↓
AI content generation
 ↓
Video generation
 ↓
Asset storage
 ↓
TikTok product association
 ↓
Publish job
```

Ensure product identity is stable.

Avoid using display names as primary identifiers.

Use immutable IDs.

---

# 20. PRODUCT SYNCHRONIZATION

Implement safe product synchronization.

Requirements:

* pagination
* timeout
* retries
* deduplication
* incremental sync
* last sync timestamp
* error tracking
* idempotency
* rate limiting

Do not assume one API response contains all products.

Handle deleted/hidden/unavailable products.

Do not delete local data blindly during synchronization.

Use reconciliation semantics.

---

# 21. AI CONTENT GENERATION

Create a provider abstraction.

Example:

```text
ContentGenerationProvider
```

Responsibilities:

* prompt generation
* hook generation
* script generation
* caption
* CTA
* hashtags
* product context

Store generated content with provenance.

Track:

```text
provider
model
prompt version
content version
input hash
created_at
```

Do not hard-code prompts throughout business logic.

---

# 22. VIDEO PIPELINE

Implement:

```text
Product
 ↓
Script
 ↓
Video Generation
 ↓
Clip
 ↓
Extend
 ↓
Loop
 ↓
Post-processing
 ↓
Validation
 ↓
Storage
 ↓
Publish
```

Use a provider abstraction.

Use FFmpeg where appropriate.

Validate:

* duration
* codec
* container
* resolution
* frame rate
* audio
* file size
* integrity

Do not trust file extensions.

Inspect media metadata.

Reject malformed media before publishing.

---

# 23. OBJECT STORAGE

Use existing MinIO/S3-compatible infrastructure where available.

Assets should be referenced by stable storage keys.

Do not expose private buckets publicly.

Use signed URLs where external access is required.

Prevent path traversal.

Validate MIME type.

Set reasonable upload size limits.

Do not trust user-provided filenames.

---

# 24. BROWSER AUTOMATION

If browser automation already exists:

* isolate it behind an adapter
* use it only where official APIs do not provide required capability
* never expose browser sessions to users
* protect session credentials
* implement worker health checks
* implement timeouts
* implement cleanup
* prevent orphaned browser processes
* prevent infinite retries

Do not use browser automation to bypass TikTok security controls.

Do not implement CAPTCHA bypass.

Do not implement anti-detection evasion.

---

# 25. FRONTEND

Audit the complete UI.

Required account states:

```text
Disconnected
Connecting
Connected
Expired
Reauthorization Required
Error
```

Provide:

```text
Connect TikTok
Reconnect TikTok
Disconnect TikTok
Account health
Last sync
Granted scopes
```

Never expose:

* client secret
* access token
* refresh token
* authorization code
* internal credentials

Use safe error messages.

Do not expose stack traces in production.

---

# 26. API SECURITY

Audit every API endpoint.

Verify:

* authentication
* authorization
* tenant isolation
* input validation
* output validation
* rate limiting
* pagination
* request size
* timeout
* error handling
* audit logging

Protect against:

* OWASP API Top 10
* IDOR
* SSRF
* injection
* mass assignment
* broken authorization
* excessive data exposure
* unrestricted resource consumption

Use schema validation at API boundaries.

---

# 27. WEBHOOK SECURITY

For every webhook:

* verify authenticity/signature where supported
* validate event type
* validate event ID
* implement replay protection
* make processing idempotent
* acknowledge safely
* process asynchronously when appropriate
* log correlation IDs only

Never trust webhook payloads blindly.

---

# 28. DATABASE

Audit all migrations.

Check:

* indexes
* foreign keys
* unique constraints
* cascade behavior
* nullability
* timestamps
* transaction boundaries
* race conditions
* migration rollback safety

Avoid N+1 queries.

Use transactions for state transitions.

Do not perform destructive migrations without a safe migration strategy.

---

# 29. REDIS / QUEUE

Audit:

* connection handling
* timeouts
* retry behavior
* visibility timeout
* stalled jobs
* duplicate messages
* worker shutdown
* queue metrics
* dead letters

Workers must terminate gracefully.

Jobs must not disappear silently.

---

# 30. OBSERVABILITY

Implement structured logs.

Every request/job must have correlation:

```text
request_id
trace_id
tenant_id
account_id
job_id
operation
provider
```

Never log secrets.

Add metrics for:

```text
OAuth success/failure
token refresh
TikTok API latency
TikTok API errors
publish success/failure
job queue depth
job latency
job retries
video generation duration
storage errors
database latency
Redis latency
```

Add health endpoints:

```text
/live
/ready
/health
```

Readiness must validate only dependencies actually required for serving traffic.

---

# 31. SECURITY HEADERS

Audit and implement appropriate:

```text
Content-Security-Policy
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
```

Use secure cookies where applicable:

```text
HttpOnly
Secure
SameSite
```

Do not disable TLS verification.

---

# 32. CORS

Do not use:

```text
Access-Control-Allow-Origin: *
```

for authenticated production APIs unless explicitly justified and safe.

Use an allowlist.

Reject unknown origins.

Never reflect arbitrary origins.

---

# 33. SSRF

Audit all server-side URL fetching.

Protect against:

* localhost
* loopback
* private networks
* metadata services
* internal DNS
* IPv6 bypass
* redirect-based SSRF
* DNS rebinding

Use explicit allowlists where external providers are expected.

---

# 34. RATE LIMITING

Implement layered limits:

```text
per IP
per user
per tenant
per TikTok account
per operation
per provider
```

Avoid unlimited AI/video generation.

Protect expensive endpoints.

---

# 35. SECRET SCANNING

Run repository-wide scans for:

```text
API keys
OAuth secrets
JWT secrets
AWS credentials
TikTok credentials
private keys
database URLs
passwords
cookies
session tokens
```

Use available tools such as:

```text
gitleaks
trufflehog
```

or the repository's existing security scanner.

Remove real secrets from repository history only if necessary and safe.

Do not rewrite Git history automatically without a deliberate safety decision.

---

# 36. DEPENDENCY SECURITY

Audit dependencies.

Check:

* outdated vulnerable packages
* abandoned packages
* duplicate packages
* unnecessary dependencies
* license conflicts where applicable

Run the ecosystem's native audit tooling.

Do not blindly upgrade major versions.

Upgrade deliberately and test.

---

# 37. DOCKER

Audit all Dockerfiles.

Requirements:

* minimal images
* pinned major/runtime versions
* non-root runtime where possible
* no secrets in layers
* health checks
* graceful shutdown
* proper signal handling
* immutable-ish runtime
* predictable filesystem permissions

Do not run application processes as root unless technically required and justified.

---

# 38. COMPOSE / DEPLOYMENT

Audit Docker Compose and deployment manifests.

Verify:

* health checks
* dependency ordering
* persistent volumes
* network isolation
* environment handling
* resource limits
* restart policy
* graceful shutdown
* logging
* backup strategy

---

# 39. CI/CD

CI must validate:

```text
format
lint
typecheck
unit tests
integration tests
build
migration validation
security scan
dependency scan
secret scan
Docker build
```

Do not disable failing checks.

Do not make CI "green" by skipping tests.

Do not use `continue-on-error` to hide production failures.

---

# 40. TEST MATRIX

Implement or repair:

## Unit tests

* OAuth state
* token service
* account service
* product service
* publish service
* job state machine
* idempotency
* retry policy

## Integration tests

* database
* Redis
* queue
* OAuth callback
* provider adapters
* storage
* publishing workflow

## Security tests

* CSRF
* IDOR
* SSRF
* tenant isolation
* token leakage
* authorization bypass
* invalid state
* replay attack
* malformed webhook

## E2E

At minimum:

```text
Login
 ↓
Connect TikTok
 ↓
Account appears
 ↓
Product selected
 ↓
Content generated
 ↓
Video generated
 ↓
Publish job created
 ↓
Job processed
 ↓
Final status visible
```

Real TikTok calls must only execute in explicitly configured integration environments.

Never put production credentials in CI.

---

# 41. TIKTOK SANDBOX

Support separate Sandbox configuration.

Development flow:

```text
Developer App
 ↓
Sandbox
 ↓
Target TikTok account
 ↓
Login
 ↓
API test
```

Never accidentally point test jobs at production credentials.

Document the manual TikTok Developer Portal setup.

---

# 42. TIKTOK PRODUCTION APPROVAL

Do not claim production posting capability unless the required TikTok capabilities/scopes have actually been approved.

Clearly distinguish:

```text
IMPLEMENTED
CONFIGURED
SANDBOX VERIFIED
PRODUCTION VERIFIED
BLOCKED_BY_TIKTOK_REVIEW
```

If app review is required, document the exact manual action.

Never fake an approved scope.

---

# 43. CONFIGURATION VALIDATION

Create startup validation for required configuration.

Application must fail fast for invalid critical configuration.

Validate:

* URL format
* environment
* secrets presence
* database URL
* Redis URL
* encryption key
* TikTok configuration
* allowed origins

Do not print secret values during validation.

---

# 44. ERROR HANDLING

All external calls require:

* timeout
* cancellation
* safe error mapping
* retry classification
* structured logging
* correlation ID

Never swallow exceptions.

Never return raw provider exceptions to users.

Do not leak:

* SQL errors
* stack traces
* secrets
* internal paths
* provider credentials

---

# 45. PERFORMANCE

Audit:

* database N+1
* unnecessary API calls
* duplicate token refresh
* duplicate video generation
* queue throughput
* Redis usage
* object storage bandwidth
* FFmpeg CPU/memory
* worker concurrency

Do not optimize prematurely.

Fix measurable bottlenecks.

Use bounded concurrency.

Never allow unbounded worker spawning.

---

# 46. RESOURCE LIMITS

Every expensive operation must have limits.

Examples:

```text
max video size
max upload size
max generation duration
max concurrent jobs
max retry count
max API request size
max pagination size
max batch size
```

Prevent resource exhaustion.

---

# 47. BACKUP / RECOVERY

Verify:

* PostgreSQL backup
* restore procedure
* Redis persistence requirements
* object storage backup
* configuration backup
* secret recovery strategy

Document RPO/RTO assumptions.

Do not claim HA if it does not exist.

---

# 48. DATA RETENTION

Define retention for:

* OAuth state
* job records
* logs
* audit logs
* generated assets
* failed jobs
* temporary files

Clean temporary media automatically.

Never leave sensitive temporary files indefinitely.

---

# 49. FILE SYSTEM SECURITY

Audit all file operations.

Prevent:

* path traversal
* arbitrary overwrite
* executable upload
* symlink abuse
* unbounded temporary storage

Use generated server-side filenames.

Do not trust uploaded filenames.

---

# 50. ADMIN FUNCTIONS

Admin actions affecting:

* TikTok accounts
* tokens
* publishing
* products
* jobs
* billing
* tenant configuration

must be authorized and audited.

Sensitive admin actions should have explicit confirmation.

---

# 51. AUDIT LOG

Implement immutable-ish audit records for security-sensitive events:

```text
TikTok connected
TikTok disconnected
OAuth success
OAuth failure
Token refresh
Token invalidation
Publish requested
Publish completed
Publish failed
Product sync
Admin change
Configuration change
```

Never put credentials in audit logs.

---

# 52. DOCUMENTATION

Update all relevant documentation.

At minimum:

```text
README.md
SECURITY.md
CHANGELOG.md
.env.example
docs/
architecture
deployment
development
TikTok setup
Sandbox setup
production setup
troubleshooting
```

Documentation must reflect the actual implementation.

No stale instructions.

No imaginary commands.

---

# 53. DEVELOPER EXPERIENCE

Provide reliable commands for:

```text
install
dev
test
lint
format
typecheck
build
migration
db reset
integration test
security scan
docker build
production validation
```

Use existing project conventions when possible.

Do not create redundant tooling.

---

# 54. SOURCE CODE QUALITY

Apply:

* SOLID where useful
* clear boundaries
* strong typing
* explicit error types
* dependency injection where justified
* deterministic behavior
* small cohesive modules
* no unnecessary abstraction

Prefer simple code over framework-heavy complexity.

Remove dead code.

Remove duplicate implementations.

Do not rewrite stable code merely to change style.

---

# 55. CODE LEAK AUDIT

Perform a complete source-code leak audit.

Search for:

```text
client_secret
access_token
refresh_token
authorization:
bearer
cookie
session
private key
password
api key
DATABASE_URL
REDIS_URL
```

Check:

* source
* tests
* fixtures
* examples
* documentation
* Docker layers
* GitHub workflows
* generated files

Replace real credentials with safe placeholders only where appropriate.

If real credentials are found, report them as security incidents and remove exposure from current source.

Do not print discovered secret values in the final report.

---

# 56. LEGACY CODE AUDIT

Find:

* obsolete TikTok endpoints
* duplicate OAuth implementations
* dead publishing code
* obsolete environment variables
* stale API versions
* unused workers
* abandoned scripts
* duplicate queue implementations
* duplicate product models
* duplicate account models

Consolidate only after verifying dependencies.

---

# 57. DATABASE MIGRATION SAFETY

Every schema change must have:

* migration
* validation
* indexes
* rollback consideration
* data compatibility

Never silently mutate production schema from application startup unless that is explicitly the existing migration strategy.

---

# 58. PRODUCTION CONFIGURATION

Create a clear separation:

```text
LOCAL
DEVELOPMENT
TEST
SANDBOX
STAGING
PRODUCTION
```

Production must not use:

* debug mode
* development secrets
* wildcard CORS
* fake providers
* mock publish
* insecure cookies
* verbose stack traces

---

# 59. RELEASE CHECKLIST

Before declaring production-ready, verify:

### Build

* [ ] application builds
* [ ] frontend builds
* [ ] workers build
* [ ] Docker images build

### Tests

* [ ] unit tests pass
* [ ] integration tests pass
* [ ] security tests pass
* [ ] E2E tests pass where environment permits

### TikTok

* [ ] OAuth URL works
* [ ] callback works
* [ ] state validation works
* [ ] token exchange works
* [ ] account identity works
* [ ] token encryption works
* [ ] refresh works
* [ ] duplicate linking prevented
* [ ] sandbox verified
* [ ] production capability clearly classified

### Security

* [ ] no secrets committed
* [ ] no token leakage
* [ ] CSRF protected
* [ ] SSRF protected
* [ ] tenant isolation verified
* [ ] authorization verified
* [ ] rate limiting enabled
* [ ] secure cookies
* [ ] security headers
* [ ] dependency scan clean or documented

### Reliability

* [ ] idempotency
* [ ] retries
* [ ] rate-limit handling
* [ ] worker recovery
* [ ] graceful shutdown
* [ ] health checks
* [ ] observability
* [ ] backup strategy

### Documentation

* [ ] README
* [ ] setup
* [ ] deployment
* [ ] TikTok Developer setup
* [ ] Sandbox
* [ ] production
* [ ] troubleshooting
* [ ] security
* [ ] changelog

---

# 60. EXECUTION PROTOCOL

Work in phases.

## Phase 1 — Discovery

Inspect everything.

Produce an internal architecture map.

Do not change code yet.

## Phase 2 — Risk Classification

Classify findings:

```text
CRITICAL
HIGH
MEDIUM
LOW
INFO
EXTERNAL_BLOCKER
```

Prioritize:

```text
security
data integrity
authentication
authorization
production correctness
reliability
tests
performance
cleanup
```

## Phase 3 — Implementation

Implement fixes in dependency order.

Do not batch unrelated changes into giant unreviewable rewrites.

## Phase 4 — Verification

After every major subsystem:

```text
format
lint
typecheck
unit test
integration test
build
```

Fix failures immediately.

## Phase 5 — Security Audit

Run full security and secret audit again.

## Phase 6 — Production Validation

Run the complete production gate.

---

# 61. DO NOT STOP EARLY

If you encounter an error:

Do not stop immediately.

Determine whether it is:

```text
code bug
configuration issue
environment issue
dependency issue
external API limitation
TikTok approval requirement
credential requirement
infrastructure issue
```

Fix everything under repository control.

For external blockers:

1. implement everything possible;
2. document the exact blocker;
3. provide exact manual action;
4. verify all remaining automated checks.

---

# 62. DO NOT FAKE SUCCESS

Never say:

```text
TikTok connected
```

unless it was actually verified.

Never say:

```text
publish successful
```

unless the provider confirmed it.

Never say:

```text
production ready
```

if a critical production gate remains unresolved.

---

# 63. FINAL VERIFICATION COMMAND

At the end run every appropriate project validation command.

Use the repository's native commands first.

Then run additional security/build checks as required.

Capture:

```text
exit code
test count
failure count
warnings
build artifacts
security findings
```

---

# 64. FINAL REPORT

The final response must be concise but complete.

Use exactly this structure:

```text
# PRODUCTION READINESS REPORT

## Repository
cvsz/zaffiliate

## Status
PRODUCTION_READY
or
PRODUCTION_READY_WITH_EXTERNAL_BLOCKER
or
NOT_PRODUCTION_READY

## Implemented

- ...
- ...
- ...

## TikTok

OAuth:
PASS/FAIL

Login:
PASS/FAIL

Token Storage:
PASS/FAIL

Token Refresh:
PASS/FAIL

Account Linking:
PASS/FAIL

Content Posting:
PASS/FAIL/BLOCKED

Sandbox:
PASS/FAIL/BLOCKED

Production Approval:
VERIFIED/NOT_VERIFIED/EXTERNAL

## Security

Secret Scan:
PASS/FAIL

OAuth Security:
PASS/FAIL

Authorization:
PASS/FAIL

Tenant Isolation:
PASS/FAIL

SSRF:
PASS/FAIL

CSRF:
PASS/FAIL

Rate Limiting:
PASS/FAIL

## Reliability

Idempotency:
PASS/FAIL

Retry:
PASS/FAIL

Queue:
PASS/FAIL

Worker Recovery:
PASS/FAIL

Observability:
PASS/FAIL

Backup/Restore:
PASS/FAIL

## Tests

Unit:
PASS/FAIL — N tests

Integration:
PASS/FAIL — N tests

E2E:
PASS/FAIL — N tests

Build:
PASS/FAIL

Lint:
PASS/FAIL

Typecheck:
PASS/FAIL

CI:
PASS/FAIL

## Remaining External Blockers

Only list issues that cannot be solved from the repository.

For each:

- blocker
- why
- exact manual action
- verification procedure

## Files Changed

List every changed file.

## Database Changes

List every migration.

## Deployment Changes

List every deployment/configuration change.

## Security Findings

List remaining findings only.

## Final Gate

PASS/FAIL
```

---

# 65. FINAL RULE

You are not being asked to produce a proposal.

You are being asked to **perform the engineering work**.

Inspect the existing implementation.

Preserve good architecture.

Fix bad architecture.

Implement missing functionality.

Write complete production code.

Run tests.

Fix failures.

Run security scans.

Fix security issues.

Update documentation.

Validate deployment.

Verify TikTok integration wherever credentials/environment permit.

Clearly separate repository-complete work from TikTok external approval requirements.

Do not declare success without evidence.

**Continue until the repository reaches the highest production-readiness state that can actually be verified from the available environment.**
