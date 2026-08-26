# Operator Handbook — Publishing

## State machine

Publication jobs move through the 9-state machine (`draft → waiting_approval → approved → scheduled → processing → published|partial|failed`, plus `cancelled` terminal). Transitions are fail-closed in `packages/db/src/publication-jobs-repo.js`; illegal moves throw, terminals freeze.

## Durability guarantees (verified)

- **Idempotent create**: same `(tenant_id, idempotency_key)` returns the existing job — no duplicates.
- **Exactly-once dispatch**: `claimDue` is a single skip-locked UPDATE; concurrent workers cannot double claim; attempt increments atomically.
- **Retry budget**: failed/partial jobs may re-enter processing only while `attempt < max_attempts`; backoff via `next_retry_at`.
- **Restart survival**: jobs live in Postgres (migration 005); proven across fresh-process restarts (`test/publication-jobs-repo.test.js` integration).

## Operating actions

| Action | How |
|---|---|
| Inspect queue depth | SQL via app role: `SELECT status, count(*) FROM publication_jobs WHERE tenant_id=$1 GROUP BY 1` |
| Requeue a failed job | transition to `scheduled` with `nextRetryAt` set (repo API); budget still enforced |
| Force-stop publishing | automation kill switch scope `publishing` (see `automation.md`) |
| Reconcile provider truth | `scripts/reconcile.mjs` for commission datasets |

## Failure playbook

1. Provider timeout after accept → job stays `processing`; reconcile external id before retrying (duplicate-post protection depends on idempotency keys reaching providers).
2. `partial` result → only failed destinations are retry candidates (master-spec §16).
3. Retry budget exhausted (`retry_budget_exhausted`) → manual decision: raise `max_attempts` via policy or archive job. Never edit rows directly.
