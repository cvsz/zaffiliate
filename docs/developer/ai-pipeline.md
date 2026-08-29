# Developer Handbook — AI Pipeline

Home: `packages/ai-content` (runtime + factory), prompt registry in `factory.js`.

## Pipeline shape

Brief (evidence-gated) → hook (scored, claim-checked) → script/storyboard (duration-budgeted scenes, verbatim disclosure) → copy surfaces (caption/title/CTA/hashtags/SEO) → quality gate (hard compliance stops) → approval/policy routing.

## Non-negotiables

1. **Prompts are registry entries** (`PROMPT_REGISTRY`, versioned `name@vN`) — never hard-code prompts in business logic; unknown prompts refuse.
2. **Claims must be grounded**: unsubstantiated social proof is omitted with a recorded reason; fabricated discounts/scarcity/testimonials hard-fail to revision regardless of score.
3. Disclosure is structural: brief carries it; storyboard emits it verbatim as its own scene.
4. Budgets/spend metered before provider calls; provenance hashes recorded on every artifact.

## Provider reality

LLM/image/video interfaces exist with fallback chains, but external providers are credential-blocked (B2). Development uses the deterministic template-driven generators — they are the compliance floor, not a placeholder to bypass.

## Where tests live

`test/content-factory.test.js` (19 cases), `test/ai-content*.test.js`. When adding a generator surface: extend the factory + registry entry + cases for budget/format/disclosure behavior in one slice.
