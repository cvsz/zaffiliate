# E2E Runbook

## Prerequisites

- Node.js >= 22
- No external services required (DATABASE_URL, REDIS_URL not needed)

## Command

```bash
node --test test/e2e.test.js
```

## Expected Duration

Under 30 seconds. The test starts two in-process HTTP servers on ephemeral ports and runs seven sequential checks.

## Evidence Collection

- Server logs are emitted to stdout during the run via the observability logger.
- Request/response snapshots are captured implicitly by the assertions.
- On failure, `node:test` reports the failing subtest and assertion message.

## Stop-the-Line Conditions

- API `/healthz` does not return `200` with `{ ok: true, service: 'zaffiliate-api' }`.
- API `/readyz` returns a status other than `200` or `503`.
- API `/metrics` does not return `200` or the body does not contain `zaffiliate_http_requests_total`.
- Web root `/` does not return `200` or the body does not contain `<title>` or `<nav`.
- Web `/api/navigation` does not return `200` JSON with a `sections` array.
- Web `/api/audit` does not return `200` JSON with a `rows` array.
- Cross-origin request from web origin to API does not return a response without `access-control-allow-origin`.
