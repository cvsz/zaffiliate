# Developer Handbook — Debugging

## Correlation first

Every HTTP response carries `x-request-id` and `x-trace-id`; every structured log line includes both. Start from a request id:

```sh
journalctl -u zaffiliate | grep <request_id>
```

## Local reproduction ladder

1. Unit-level: find the nearest suite for the module and run it with `--test-name-pattern`.
2. HTTP-level: boot `buildServer()` in-process (see any e2e harness) and curl the exact route with the same headers — tenant header included.
3. Data-level: point `DATABASE_URL` at a **copy**, never production; the migrator + repos are read-safe but discipline matters.

## Common failure signatures

| Symptom | Likely cause |
|---|---|
| `TENANT_HEADER_REQUIRED` / unexpected 404s | missing or wrong `x-tenant-id` (cross-tenant reads are intentionally indistinguishable 404s) |
| 400 `missing_webhook_parameters` on webhooks | wrong header names — must be `x-zaff-signature`, `x-zaff-timestamp`, `x-zaff-event-id` |
| `MigrationDriftError` | applied checksum ≠ file; restore file or investigate tampering — never force |
| `PUBLICATION_TRANSITION_ILLEGAL` | state machine misuse; consult map in `publication-jobs-repo.js` |
| Duplicate-looking analytics rows | they aren't: check `dimensions->externalEventId`; dedupe collapses on insert |
| OAuth 400 INVALID_OAUTH_STATE | state consumed (single-use), expired, or different server process |

## Deep dives

- Metrics: `/metrics` counters are conventional (`*_total` includes errors).
- Restore a realistic dataset locally via the rehearsal tooling rather than hand-crafting fixtures.
