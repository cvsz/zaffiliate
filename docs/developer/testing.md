# Developer Handbook — Testing

Runner: `node --test` (built-in). No frameworks, no global mocks.

## Commands

```sh
npm test                                  # everything; DB-gated tests auto-skip
DATABASE_URL=<pooler> npm test            # live-PG integrations included
node --test test/oauth-flow.test.js       # single file
node --test --test-name-pattern "refresh" # single case
```

## Discipline

1. **RED → GREEN**: write the failing regression/contract first when fixing bugs (repo history follows this strictly).
2. Deterministic time: inject clocks (`clock`, `nowMs`, `now` options) — wall-clock assertions are how time bombs happen (see GM-001 post-mortem in CHANGELOG).
3. Deterministic randomness: inject `randomBytesFn` where IDs/state derive from entropy.
4. Network: never real providers. Transports are injectable fakes; live verification is gated on credentials and marked as such.
5. Isolation proofs belong at HTTP level (`test/multi-tenant-golden-e2e.test.js`) — unit-level tenancy checks are necessary but not sufficient.

## Suites map (selected)

| Suite | Covers |
|---|---|
| api-business-routes | /go redirect safety, webhook signatures/replay/dedupe |
| multi-tenant-golden-e2e | full-chain org A/B isolation over HTTP |
| publication-jobs-repo (+integration) | 9-state machine, skip-locked claim, restart survival |
| commerce / analytics-events / decision-gate | commercial truth, golden metrics, autonomy gate |
| db / migration-cutover | migrator drift fail-closed, forward application |
| security-* | SSRF, rate limiting, JWKS, CSRF, secrets |

## Gates that must stay green

`npm run check` (syntax list), `npm audit --omit=dev --audit-level=high`, `scripts/security-check.sh` (secret patterns, non-root container), CI workflow `.github/workflows/ci.yml`.
