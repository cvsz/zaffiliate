# Developer Handbook — Queues & Jobs

Two layers exist; know which one you are touching.

## 1) Workflow engine (in-process, `packages/workflow`)

Tool grants/policy engine, atomic job claims, replay-proof idempotent enqueue, bounded retries → DLQ, two-phase cancellation, TTL-expiring approvals, stale-running reconciliation. State machine per `jobs` table in migration 002 (`queued/running/waiting_approval/succeeded/failed/cancelled/dead_letter`) with a dispatch index on `state`.

## 2) Publication jobs (Postgres-durable, `packages/db/src/publication-jobs-repo.js`)

9-state publishing machine (migration 005). Key semantics:

- Create is idempotent per `(tenant_id, idempotency_key)` — always pass a stable key derived from content+destination.
- Claim with `claimDue(tenant, nowIso, limit)` — single skip-locked UPDATE, exactly-once, attempt++ atomic, honors `scheduled_for` and `next_retry_at`.
- Transitions validated against the canonical map; reprocessing failed/partial enforces retry budget; terminals frozen.

## Event bus

Outbox pattern inside runtimes; Redis Streams publisher (`packages/events/src/index.js`) degrades to an in-memory ring when `REDIS_URL` is absent. Canonical analytics envelopes dedupe by `(provider, external_event_id)` with payload-fingerprint fallback.

## Rules of engagement

- Every external side effect carries an idempotency key minted before the attempt.
- Retries: bounded attempts + backoff via timestamps (never tight loops).
- Never report success from enqueue alone; success is a terminal state after provider reconciliation.
