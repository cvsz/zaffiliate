# Operator Handbook — Incident Response

## Severity quick scale

| Sev | Meaning | Response |
|---|---|---|
| S1 | Tenant isolation breach, financial inconsistency, secret exposure | stop-the-line immediately |
| S2 | Publishing correctness uncertain, provider-wide outage, DB unreachable | mitigate within minutes |
| S3 | Single campaign/job failures, elevated 5xx without data risk | same-day |

## Stop-the-line actions (fastest first)

```sh
# 1) Freeze ALL autonomous behavior (no redeploy needed)
curl -X POST -H 'x-tenant-id: <tenant>' -H 'content-type: application/json' \
  https://zaffiliate.zeaz.dev/api/v1/automation/kill-switch \
  -d '{"scope":"global","id":null,"active":true,"reason":"<incident>"}'

# 2) Or scope it
#    scope ∈ global|provider|organization|campaign|publishing  (+ id where applicable)

# 3) If the release itself is the incident: roll back
sudo systemctl edit zaffiliate   # pin previous immutable commit/artifact, then restart
```

Already-started jobs reconcile safely after kill switches activate; no new prohibited side effects begin (contract-tested).

## Triage flow

1. Identify blast radius: one tenant vs all (run `/api/v1/analytics/overview` for two tenants; compare).
2. Check recent deploys/migrations: `git log --oneline -5`, `schema_migrations` table.
3. Capture evidence BEFORE mutating: metrics snapshot, structured log excerpt (request_id/trace_id present on every line).
4. Mitigate → verify with golden checks (healthz, overview isolation, gate decisions).
5. Post-mortem: root cause, mechanism, fix, how it slipped through (repo has a post-mortem discipline).

## Specific incidents

- **Suspected tenant leak**: run `test/multi-tenant-golden-e2e.test.js` locally against a restored copy; if red, treat as S1, kill switch global, page maintainer.
- **Credential leak**: rotate at provider, overwrite `ref:` paths, restart API, record rotation evidence (`docs/migration/credential-rotation-evidence.md`), scan history (`scripts/security-check.sh`).
- **DB down**: `/readyz` reports reason; unsafe writes fail closed; recovery = restore connectivity, migrator re-verifies checksums on next run.
