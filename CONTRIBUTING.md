# Contributing

## Ground rules

1. Zero runtime dependencies by default (Node builtins only). New dependencies require an explicit justification in the slice record and must be pinned.
2. Bounded slices only, tracked in `exec-planning.md` (canonical). A slice = production code + tests + security review + docs + changelog entry.
3. Tests first where practical (`node --test`). Never weaken a test to make it pass; fix the product or the fixture deliberately and say which.
4. Time-dependent tests MUST pin `now`/clock explicitly — wall-clock assertions are time bombs.
5. Security failures fail closed. Mutating provider operations require approval context; unsupported capabilities are never automated; no browser automation to bypass official-API limits.
6. Every tenant-owned record carries explicit ownership fields; validate with `packages/contracts/src/schema.js`.

## Gates before merge

```bash
npm run check   # syntax gate across all modules
npm test        # full suite
```

CI additionally runs secret scanning and SSRF guards (`.github/workflows/ci.yml`). Do not suppress a failing security check.

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). One logical change per commit; unrelated discoveries become follow-up items in `exec-planning.md`.
