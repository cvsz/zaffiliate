# Agent System Rules

## Language & Communication Guidelines
- **Primary Response Language:** Always communicate, explain, and write documentation/comments in **Thai** (ภาษาไทย).
- **Code & Configuration:** All source code, terminal commands, configuration files (JSON, YAML, ENV, etc.), variable names, and code syntax MUST remain in **English**.
- **Technical Terms:** Keep standard software architecture and programming jargon in English (e.g., *refactor*, *middleware*, *dependency injection*) to maintain accuracy.

## Response Behavior
1. **Explanations:** Provide all explanations, step-by-step guidance, and trade-off analyses in **Thai**.
2. **Code Blocks:** Write clean, executable code entirely in **English**. Do not translate programming keywords, variables, or API routes into Thai.
3. **Inline Comments:** Write comments within code blocks in **Thai** if they explain logic to the developer, but keep the code itself standard English.

## Repository Operating Rules
- Read this root `AGENTS.md`, `README.md`, contribution guidance, and repository-native configuration before making changes.
- If a nested `AGENTS.md` exists, treat the nearest file as the more specific instruction set for that subtree while preserving these root rules unless explicitly overridden.
- Preserve the existing architecture, public interfaces, naming conventions, formatting, and repository style unless the task explicitly requires a change.
- Prefer the smallest safe diff that fully solves the requested problem. Do not rewrite unrelated code or generated/vendor files.
- Never commit credentials, tokens, private keys, production secrets, personal data, or sensitive runtime output. Use documented secret/env mechanisms instead.
- Do not disable tests, security checks, type checks, lint rules, branch protections, or validation gates merely to make CI pass.
- Use repository-native build, test, lint, type-check, security, migration, and packaging commands whenever available.
- Before claiming a task complete, verify the relevant tests/checks and report what actually passed, what was not run, and any remaining blocker.

## Production Readiness
- Do not claim `production-ready`, `enterprise-ready`, `secure`, or `complete` without concrete evidence from the repository and validation results.
- For production-impacting changes, consider security, backward compatibility, observability, rollback, migrations, backup/restore, failure handling, and operational documentation.
- Treat authentication, authorization, payments, secrets, infrastructure, data migration, destructive operations, and externally visible API contracts as high-risk changes requiring extra validation.

## Git & Change Safety
- Do not force-push, rewrite shared history, delete unrelated branches/tags, or perform destructive Git operations unless the user explicitly authorizes that exact action.
- Keep commits focused and descriptive. Avoid mixing unrelated refactors with functional fixes.
- Do not merge failing changes or bypass required checks. If checks are unavailable, say so rather than assuming success.
- Preserve existing user work and project-specific instructions. When requirements conflict, follow the more specific repository rule or explicit user instruction and document the trade-off.

---

# AGENTS.md — zaffiliate

Agent operating instructions for the `cvsz/zaffiliate` repository. This file is the canonical
repo-level contract for AI coding agents (Claude Code, Codex CLI, Kilo, and other ECC-compatible
harnesses). Tool-specific overlays exist at `.codex/AGENTS.md` (Codex) and
`.claude/` (Claude); this root file is the shared baseline they all supplement.

## Project

`zaffiliate` is a canonical affiliate-commerce platform consolidating the legacy
`zaffhub`, `ztsaff`, `tiktok-shop-bot`, `tiktok-shop-sdk`, `tiktokshop-php`, `zlttbots`, and
`zttlbots` repositories. It is a single-package ESM monorepo (no workspace tooling) with a
zero-runtime-dependency-by-default philosophy.

- **Language**: JavaScript (Node.js 22+, `"type": "module"`).
- **Stack**: Node builtins + pinned deps (`pg` 8.23.0, `redis` 6.2.1, `@supabase/supabase-js`,
  React 19 + react-router-dom 7 + Vite 8 for the control-plane web app).
- **Docs**: `README.md` (golden path), `ARCHITECTURE.md` (authoritative), `CONTRIBUTING.md`
  (ground rules), `docs/developer/` (handbook), `docs/operator/` (runbooks).

## Architecture Boundary

Affiliate and TikTok are strictly separated bounded contexts.
Affiliate is the business core; TikTok is a distribution integration.
See `docs/ARCHITECTURE-BOUNDARY.md` for the full boundary contract.

## Repository layout

```
apps/         api (HTTP surface), web (CSP-first Control Plane)
packages/     contracts, affiliate-core, tiktok-shop, adapters, workflow,
              identity-billing, ai-content, automation, analytics, intelligence,
              db, security, observability, storage, events, supabase, release,
              control-plane, outreach, config
db/migrations SQL migrations 001..006 + ROLLBACK.md
scripts/      bootstrap, migrate, healthcheck, verify, security-check, production-preflight
test/         shared test helpers
docs/         developer, operator, operations, closure, migration, release docs
```

## Commands

```bash
npm install              # install deps (npm ci in CI)
npm run check            # syntax gate across all modules (node --check)
npm test                 # full suite (node --test)
npm run verify           # check + test (pre-PR gate)
npm run security         # audit + secret scan + container-user check
npm run migrate          # apply pending migrations (safe to rerun; drift fails closed)
./scripts/bootstrap.sh    # checks tools, creates env, starts postgres+redis, migrates
docker compose up -d      # full stack (API + dependencies)
./scripts/healthcheck.sh  # liveness/readiness/version evidence
```

The API serves `/healthz`, `/readyz`, `/metrics`, `/api/v1/version` on `$PORT` (default 8080).
`/readyz` fails closed with HTTP 503 when mandatory runtime dependencies are absent.

## Conventional commits

Use `feat:`, `fix:`, `docs:`, `test:`, `chore:` prefixes, imperative mood, one logical change
per commit. Examples: `feat(adapters): add native Meta and YouTube providers`,
`docs: record zaff parity audit`, `test(adapters): cover social provider boundaries`.

## Code style

- **Files**: kebab-case. **Functions**: camelCase. **Classes**: PascalCase.
  **Constants**: SCREAMING_SNAKE_CASE.
- **Imports/exports**: mixed import style, named exports preferred.
- **Zero runtime dependencies by default** — new deps require explicit justification and
  must be pinned.
- Time-dependent tests MUST pin `now`/clock explicitly; wall-clock assertions are time bombs.

## Ground rules (from CONTRIBUTING.md)

1. Bounded slices only, tracked in `EXEC-PLANNING.md` (canonical). A slice = production code +
   tests + security review + docs + changelog entry.
2. Tests first where practical (`node --test`). Never weaken a test to make it pass.
3. Security failures fail closed. Mutating provider operations require approval context;
   unsupported capabilities are never automated; no browser automation to bypass official-API
   limits.
4. Every tenant-owned record carries explicit ownership fields; validate with
   `packages/contracts/src/schema.js`.
5. CI additionally runs secret scanning and SSRF guards (`.github/workflows/ci.yml`). Do not
   suppress a failing security check.

## Invariants worth defending

1. **Tenant scoping**: explicit `tenant_id` predicates AND RLS FORCE as defense-in-depth
   (`app_current_tenant_id()` GUC set per transaction).
2. **Money**: minor units, immutable snapshots, append-only corrections.
3. **Providers** behind capability manifests; unavailable ≠ improvised.
4. **Autonomy** only through the decision gate; kill switches predate features.
5. **Fail closed** everywhere; errors use the canonical envelope `{error:{code,message,request_id}}`.

Golden data flow: Provider/webhook → ingress (signature→replay→dedupe) → affiliate-core runtime
(outbox) → canonical envelopes → analytics/intelligence stores → recommendations → decision gate
→ publication_jobs → (provider publish) → attribution loop.

## Security boundary

Runtime credentials are never committed. Use `.env.example` only as the variable contract.
`.env`, private keys, and `secrets/` are ignored, and CI rejects common tracked secret material.

The legacy `ztsaff` repository contains tracked secret-like values and remains under explicit
rotation/history-scan quarantine. Those values must never be copied into this repository.

## Multi-agent support

- **Explorer**: read-only evidence gathering.
- **Reviewer**: correctness, security, and regression review.
- **Docs researcher**: API and release-note verification.

Repo-local Codex agents live at `.codex/agents/{explorer,reviewer,docs-researcher}.toml`.
Repo-generated skills: `.agents/skills/zaffiliate/SKILL.md` (Codex) and
`.claude/skills/zaffiliate/SKILL.md` (Claude). Keep user-specific credentials and private MCPs
in `~/.codex/config.toml`, not in this repo.

## Migration status

Migration is evidence-gated. Legacy repositories remain intact until 100% source classification,
mirror/bundle backup + restore evidence, secret remediation, parity/security/CI/load evidence,
reversible production cutover, and final retirement approval are all verified.

See `ROADMAP.md`, `EXEC-PLANNING.md`, `SECURITY.md`, `OPERATIONS.md`, and `docs/migration/` for
the canonical migration contract and current blockers.