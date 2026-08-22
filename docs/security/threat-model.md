# Threat Model

Formal threat model for zaffiliate. Covers STRIDE categories, trust boundaries, data flow, and attack trees for highest-risk paths.

## Trust Boundaries

```
[Client: Web / Mobile / CLI]
        |
        |  HTTPS + mTLS (optional)
        v
[Web Server: apps/web/server.js]
        |
        |  Internal network / service mesh
        v
[API Server: apps/api/src/server.js]
        |
        +--> [Identity + RBAC/ABAC]
        +--> [Affiliate Core]
        |       +--> Campaigns
        |       +--> Creators/Partners
        |       +--> Products/Links
        |       +--> Attribution/Analytics
        +--> [Outreach] --> Provider adapters (email / platform APIs)
        +--> [Content AI] --> LLM / media provider adapters
        +--> [Billing] --> Ledger / Metering
        +--> [Workflow] --> Durable queue / workers
        +--> [Webhook Ingress] --> verification / dedupe / outbox
        |
        v
[Data Stores: PostgreSQL + Redis / Queue + Object Storage]
        |
        v
[Observability: Audit + Logs + Metrics + Traces]
        |
        |  Outbound API calls
        v
[External Providers: TikTok, Shopee, Lazada, LINE, AI providers]
```

### Boundary Descriptions

| Boundary | Description | Enforcement |
|---|---|---|
| Client to Web Server | Public ingress for browser and CLI clients | HTTPS, CSP, CORS, rate limiting, WAF rules |
| Web Server to API Server | Internal BFF / gateway hop | Service mesh or private network; no direct client access to API server |
| API Server to Runtime Packages | In-process module boundaries | Package-enforced imports; tenant context propagated via closure, not global mutable state |
| Runtime Packages to Data Stores | Database, cache, object storage access | Network policies, IAM roles, least-privilege connection strings, encrypted channels |
| Runtime Packages to External Providers | Third-party API integrations | Provider-scoped API keys / OAuth tokens stored in secret manager; no hard-coded credentials |
| Observability Boundary | Logs, metrics, traces export | TLS egress, redaction of PII and secrets, retention policies |

## Data Flow Diagram

1. **Client Request**: A client submits an authenticated request (browser form, mobile API call, or CLI command) to the web server.
2. **Web Server Processing**: The web server performs session validation, static asset serving, and proxies mutating requests to the API server.
3. **API Server Routing**: The API server extracts tenant context, enforces RBAC/ABAC policies, and routes the request to the appropriate runtime package.
4. **Domain Processing**: The runtime package executes business logic, performs tenant-scoped data access, and emits domain events.
5. **Side Effects**: Workflow and outreach packages publish durable jobs to the queue. Provider adapters translate domain operations into external API calls.
6. **Persistence**: All state mutations are written to PostgreSQL. Idempotency keys and correlation IDs are stored with every transaction.
7. **Observability**: Structured logs, metrics, and traces are emitted. Audit events are appended to an immutable evidence store.
8. **External Callback**: External providers deliver webhooks to the ingress endpoint, which verifies signatures, deduplicates events, and enqueues durable processing jobs.

## STRIDE Analysis

### Spoofing

**Threat Description**: An attacker impersonates a legitimate user, tenant admin, or external provider to gain unauthorized access to affiliate data or trigger unauthorized side effects.

**Affected Components**: Web server session handling, API server authentication middleware, webhook signature verification, provider OAuth flows.

**Mitigations in Place**:
- JWT or session-based authentication with short-lived access tokens and refresh token rotation.
- mTLS or provider-signed webhook payload verification (HMAC or certificate pinning).
- OAuth 2.0 / PKCE for provider integrations where supported.
- Tenant isolation enforced at the data access layer.

**Residual Risk**: Session hijacking via token theft if TLS is terminated incorrectly or secrets are leaked. Social phishing of admin accounts.

**Verification Method**: Automated integration tests for auth bypass, token expiry, and invalid signature rejection. Periodic pen-testing of login flows.

---

### Tampering

**Threat Description**: An attacker modifies data in transit or at rest, including affiliate links, commission rates, payout records, or webhook payloads, to redirect revenue or corrupt analytics.

**Affected Components**: API server write paths, database persistence layer, webhook ingress, object storage, client-side rendering.

**Mitigations in Place**:
- All writes are tenant-scoped and carry actor provenance (user ID, timestamp, idempotency key).
- Database transactions enforce atomicity; optimistic locking via version numbers.
- Webhook payloads are verified against provider secrets before processing.
- Audit trail is append-only with cryptographic chaining where feasible.

**Residual Risk**: Insider threat with database access; compromised provider account sending malicious webhooks; race conditions in concurrent job processing.

**Verification Method**: Integration tests for idempotency replay, concurrent write handling, and tampered webhook rejection. Database audit log review.

---

### Repudiation

**Threat Description**: A legitimate user or administrator denies performing a sensitive action (e.g., payout approval, credential rotation, bulk data export) because the system lacks non-repudiable evidence.

**Affected Components**: API server mutation endpoints, admin actions, billing ledger entries, webhook processing logs.

**Mitigations in Place**:
- Immutable audit records with actor identity, tenant ID, timestamp, and action hash.
- Signed audit entries where hardware security modules or key-managed signatures are available.
- Retention policies aligned with regulatory requirements.

**Residual Risk**: Audit log tampering if storage permissions are overly permissive; missing context if correlation IDs are not propagated across all packages.

**Verification Method**: Periodic audit log integrity checks (hash chain validation), sample review of high-value actions against business records.

---

### Information Disclosure

**Threat Description**: Sensitive data (PII, financial records, provider API keys, tenant isolation boundaries) is exposed to unauthorized clients, logged in plaintext, or leaked through error messages.

**Affected Components**: API server response serialization, error handling middleware, observability pipeline, client-side code, external provider adapters.

**Mitigations in Place**:
- Field-level redaction of secrets and PII before log emission.
- Response schemas validated against contracts; no raw provider responses forwarded to clients.
- Encryption at rest for database and object storage; TLS 1.3 for all network transit.
- Secrets stored in external secret manager; never committed to source control.

**Residual Risk**: Misconfigured CORS or error handlers exposing stack traces; log aggregation system breach; timing side channels in comparison operations.

**Verification Method**: Automated scans for secrets in logs, SAST rules for error message sanitization, periodic review of log retention and access controls.

---

### Denial of Service

**Threat Description**: An attacker exhausts system resources (compute, database connections, queue depth, provider API quota) to degrade or disable service for legitimate tenants.

**Affected Components**: API server request handling, database connection pool, job queue, provider adapters, webhook ingress.

**Mitigations in Place**:
- Rate limiting per tenant and per client IP.
- Circuit breakers and timeout policies on all outbound network calls.
- Exponential backoff with full jitter for retries; bounded queue depths and DLQ overflow alerts.
- Autoscaling or resource caps for CPU/memory per tenant context.

**Residual Risk**: Distributed denial of service bypassing IP-based rate limits; slowloris-style attacks on long-polling or webhook endpoints; provider-side throttling causing cascade failures.

**Verification Method**: Load and soak tests simulating tenant-level traffic spikes. Chaos engineering exercises for downstream provider failure.

---

### Elevation of Privilege

**Threat Description**: A low-privilege user or external payload escalates privileges to perform admin operations, access other tenants' data, or bypass approval workflows.

**Affected Components**: API server authorization middleware, workflow approval gates, tenant context injection, webhook handler privilege assumptions.

**Mitigations in Place**:
- RBAC/ABAC policies evaluated on every mutating request.
- Tenant ID derived from authenticated session, never from client-supplied payload fields.
- Approval workflows require explicit policy decisions; no auto-escalation.
- Server-side validation of all administrative actions; client-side UI hints are not enforcement points.

**Residual Risk**: Insecure direct object references (IDOR) in newly ported legacy endpoints; privilege confusion between service accounts and user accounts; webhook handlers that trust provider headers over internal auth.

**Verification Method**: Automated policy tests for cross-tenant data access, negative tests for missing tenant context, and manual review of admin endpoints.

## Attack Trees

### 1. Webhook Replay

```
[Goal: Replay a valid webhook to trigger duplicate or fraudulent side effects]
    |
    +--> [Capture a valid webhook payload and signature]
    |       |
    |       +--> [Intercept traffic: compromised network / log leak / provider breach]
    |       +--> [Obtain from client storage: browser storage / mobile app data]
    |
    +--> [Replay payload to ingress endpoint]
    |       |
    |       +--> [Bypass timestamp validation: no timestamp check / wide tolerance window]
    |       +--> [Bypass nonce / idempotency check: missing or predictable nonce]
    |       +--> [Bypass signature verification: weak secret / algorithm downgrade]
    |
    +--> [Success]
            |
            +--> [Duplicate commission attribution]
            +--> [ Fraudulent payout approval]
            +--> [State corruption in downstream workflow]
```

**Mitigations**: Strict timestamp validation with narrow tolerance; idempotency keys enforced at database level; constant-time signature comparison; webhook source IP allowlisting where provider supports it.

---

### 2. Cross-Tenant Access

```
[Goal: Read or modify data belonging to another tenant]
    |
    +--> [Obtain valid credentials for Tenant A]
    |
    +--> [Manipulate tenant context in request]
    |       |
    |       +--> [Supply tenant_id in JSON body instead of session]
    |       +--> [Path parameter injection: /api/tenant-B/...]
    |       +--> [GraphQL query alias or batching to mix tenant contexts]
    |
    +--> [Bypass authorization check]
    |       |
    |       +--> [Missing ABAC policy on newlyported endpoint]
    |       +--> [Overly permissive role inheritance]
    |       +--> [Cache leak of prior tenant's paginated results]
    |
    +--> [Success]
            |
            +--> [Data exfiltration of affiliate partners / commission data]
            +--> [Unauthorized mutation of payout settings]
            +--> [Reputation damage / regulatory breach]
```

**Mitigations**: Tenant ID injected server-side from authenticated session only; ABAC policies applied uniformly across all packages; query parameter and path tenant values treated as untrusted input; response caching keyed by tenant ID.

---

### 3. Secret Leakage

```
[Goal: Obtain provider API keys, database credentials, or JWT signing secrets]
    |
    +--> [Source: Application code or configuration]
    |       |
    |       +--> [Hard-coded secret in source file]
    |       +--> [Legacy .env file committed to repository]
    |       +--> [Secret embedded in Docker image layer]
    |
    +--> [Source: Runtime environment]
    |       |
    |       +--> [Environment variable exposed via debug endpoint]
    |       +--> [Process arguments visible in /proc or container metadata]
    |       +--> [Secret logged in plaintext by third-party library]
    |
    +--> [Source: Transport]
    |       |
    |       +--> [TLS misconfiguration allowing downgrade]
    |       +--> [Secret sent over unencrypted internal channel]
    |
    +--> [Exfiltration]
            |
            +--> [Public repository push]
            +--> [Log aggregation system breach]
            +--> [Error monitoring service (Sentry, etc.)]
            +--> [Client-side dev tools / network inspector]
```

**Mitigations**: Secrets managed exclusively by external secret manager; runtime injection via mounted files or env vars; redaction filters in all logging and error-reporting paths; pre-commit and CI secret scanning; image scanning for embedded credentials.

---

### 4. Approval Bypass

```
[Goal: Execute a high-risk operation without required human approval]
    |
    +--> [Identify approval-gated workflow]
    |
    +--> [Find alternative execution path]
    |       |
    |       +--> [Direct database mutation: bypass workflow service]
    |       +--> [Admin API endpoint: no approval check / disabled in non-prod]
    |       +--> [Replay old approval token: non-expiring or reused signature]
    |       +--> [Batch operation: split large action into small chunks below threshold]
    |
    +--> [Exploit timing or state race]
    |       |
    |       +--> [Submit approval and execution in concurrent requests]
    |       +--> [Cancel approval after execution starts but before audit finalizes]
    |
    +--> [Success]
            |
            +--> [Unauthorized payout release]
            +--> [Mass data deletion or tenant suspension]
            +--> [Credential rotation without oversight]
```

**Mitigations**: Approval state machine enforced server-side with atomic transitions; approval tokens bound to specific operation ID and nonce; database mutations restricted to service accounts with no direct client path; timeout and single-use enforcement on approval tokens.
