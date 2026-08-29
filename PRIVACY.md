# Privacy

Updated: 2026-08-23

## Data categories processed

- Tenant business data: products, offers, campaigns, links, conversions, revenue.
- Contact data for outreach: stored per tenant, gated by consent/suppression registry (`packages/outreach`).
- Click attribution: visitor identity is a salted hash only (`AffiliateClickSchema.visitorHash`); no IPs, fingerprints or cross-site identifiers are persisted.
- Credentials: never stored raw — secret manager accepts `ref:` pointers only; API keys stored as SHA-256 hashes.

## Protections

- Tenant isolation enforced in-application (equality checks) and at the database (Postgres RLS, tested in `db/tests/rls.sql`).
- Logs pass through a redaction pipeline before emission; secrets are classified and masked (`packages/security`).
- Append-only hash-chained audit log records authorization decisions without payloads.
- Browser surfaces receive credential references, never credentials (CSP-first control plane).

## Retention & subject rights

Retention windows and deletion workflows follow the migration/DR contract (`scripts/backup-restore-drill.mjs`, `scripts/cutover.mjs`). Outreach consent withdrawal propagates via suppression list before any further send. No third-party trackers exist in the web surface.
