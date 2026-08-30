# zaff → zaffiliate parity refresh — 2026-08-30

This note re-checks `cvsz/zaff` against the current `cvsz/zaffiliate` `main` after PR #26. It supersedes stale implementation assumptions in the 2026-08-23 merge-plan report; that report remains useful as historical planning context, but several items it listed as absent have since been implemented.

## Verified capabilities already present in zaffiliate

The following should **not** be copied again from `zaff`:

- `/go/:slug` redirect resolution and click attribution (`apps/api/src/business.js`, wired by `apps/api/src/server.js`).
- signed webhook ingestion, replay protection and conversion recording (`apps/api/src/business.js`).
- OAuth browser authorization/callback/disconnect wiring (`apps/api/src/server.js`, `packages/security/src/oauth.js`).
- Postgres client/migrator and production SQL migrations (`packages/db`, `db/migrations`).
- local storage, S3 storage, media validation and signed object URLs (`packages/storage`).
- security boundary, SSRF validation, redaction, JWKS, API/Redis rate limiting (`packages/security`).
- richer business/domain surfaces that do not exist in `zaff`: AI content, analytics, automation, workflow, outreach, billing, intelligence/MLOps, TikTok Shop SDK, Lazada/LINE adapters and release operations.

## Confirmed parity gap: event-delivery reliability

`zaff/packages/events/src/redis-streams.ts` provides at-least-once Redis Streams semantics with consumer groups, retry/reclaim, dead-letter handling and idempotency support.

Before this branch, `zaffiliate/packages/events/src/redis-streams.js` only published with `XADD` and otherwise fell back to a process-local memory ring. `packages/events/src/index.js` also exposed a dead-letter count backed by an array that was never populated.

### Implemented in this branch

- bounded in-memory DLQ with inspectable dead-letter entries;
- stable caller-supplied `eventId` support in the in-memory bus;
- Redis consumer-group creation;
- `XREADGROUP` batch consumption;
- `XAUTOCLAIM` pending-message reclamation;
- ACK only after successful handling;
- retry-attempt tracking with expiry;
- capped Redis DLQ stream after retry exhaustion;
- Redis `SET ... NX PX` idempotency store for exactly-once-effective handlers;
- fail-closed publisher mode when Redis is required but unavailable;
- regression tests for ACK, retry, reclaim, DLQ, dedupe and bounded in-memory DLQ.

The Redis consumer accepts an injected ioredis-compatible client. The existing optional dynamic `ioredis` resolution is preserved for compatibility; production integrations should inject the deployment-owned Redis client until the runtime composition root owns a concrete Redis dependency.

## Remaining high-value gap after this branch

### Durable affiliate-domain persistence

`packages/affiliate-core/src/runtime.js` still keeps products, offers, links, clicks, conversions and its outbox in process-local `Map`/array partitions. The current DB package exports the DB client, migrator and publication-jobs repository, but it does not yet expose persistent repositories for the complete affiliate lifecycle equivalent to `zaff/packages/db/src/repos/*`.

Recommended next upgrade:

1. define a storage/repository port for affiliate-core instead of embedding SQL in the domain runtime;
2. port tenant-scoped product/offer/link/click/conversion repositories from `zaff` into zaffiliate's JavaScript DB package;
3. use DB transactions for conversion + commission + outbox writes;
4. dispatch the transactional outbox through the durable Redis consumer/publisher boundary;
5. add restart/replay and cross-tenant negative integration tests against Postgres + Redis.

## Compatibility decision

Do not mechanically convert zaffiliate to the zaff TypeScript workspace layout. `zaffiliate` is the richer canonical runtime and already has substantially more domain, security, operations and release functionality. Port missing infrastructure behind stable JavaScript interfaces, with tests, instead of replacing the canonical architecture wholesale.
