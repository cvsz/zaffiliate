# Intelligence & Feature Platform (INTEL-0)

Rules-first intelligence layer (`packages/intelligence/src/index.js`). No ML yet by design — baselines before complexity (§124 INTEL-0).

## Feature platform

- **FeatureDefinition** — `name`, `entityType` (Product/Offer/Campaign/Creative/Publication/Platform/Audience/Organization), `valueType` (number/string/boolean), integer `version`, `source`, positive `freshnessWindowMs`, `owner`. Registry identity is `name@version`; re-registration fails, definitions are frozen, latest-version lookup supported.
- **FeatureValue** — tenant-partitioned writes validate the declared value type; every value carries `computedAt`.
- **Freshness** — resolved against the definition window at read time: `FRESH` (≤50%), `AGING` (≤100%), `STALE` (>100%, value withheld and retained separately), `UNKNOWN` (never written). Stale or missing features can never silently contribute to decisions.

## Baseline opportunity ranker (model: baseline-rules-v1)

Pure rules over verified commerce/analytics inputs — no predictions claimed:

```
score = expectedNetMinorUnits × cvr × (1 + discountRatio) × confidenceWeight × promotionFactor
expectedNetMinorUnits = commissionRate × price × (1 − refundRisk)
confidence = HIGH ≥100 clicks · MEDIUM ≥20 · LOW otherwise (weight 1 / 0.8 / 0.5)
```

Hard safety rules: OUT_OF_STOCK / UNKNOWN inventory → score 0 with explicit reason; expired promotions apply a 0.7 factor plus an explanation demanding urgency-claim removal. Every recommendation carries human-readable reasons citing its actual numbers (cvr %, discount %, sample size, expected net), a confidence label, and an `expiresAt` bounded by the promotion window — never in the past.

## Isolation

All values are tenant-partitioned; cross-tenant reads return UNKNOWN. Rankings are deterministic for identical inputs.

## Stores (ML-005/022, 2026-08-24)

- **TrainingDatasetStore** — immutable frozen dataset records: `datasetId`, `created_at`, tenant/scope, label definition, validated time range (to > from), non-negative row count, feature-set version map. Reproducibility metadata is captured at creation and can never be mutated.
- **PredictionStore** — predictions persisted with model@version, entity, features-version map, confidence tier, future-dated `validUntil` (past validity rejected at write). `latest()` serves only unexpired predictions; full history remains queryable for audit and calibration analysis.
- **RecommendationStore** — ranker output persisted as ACTIVE with expiry; operator feedback (ACCEPTED / REJECTED / MODIFIED / IGNORED + actor + reason) recorded once. Fail-closed rule: ACCEPTED on an expired recommendation is coerced to EXPIRED — stale recommendations can never be executed; terminal states are immutable.

## Evaluation & explanation (ML-021/024, 2026-08-24)

- **`evaluateRanking`** — offline evaluation of any ranked result against observed outcomes: strict-window top-K hit rate (K defaults to |knownGood|, clamped; a verifiably-bad product inside the window zeroes credit; windows with no observable outcomes score 0 — never fabricated hits), Pearson score↔outcome correlation (`null` below 2 paired samples), sample size. Frozen report with modelVersion + evaluatedAt.
- **`explainRecommendation`** — renders a stored recommendation into an operator-facing artifact: summary line, evidence reasons verbatim from the ranker, confidence tier, model version, per-feature data-freshness map, and `executable:false` with an EXPIRED label once past `expiresAt`.

## Model registry & shadow mode (MLOPS-001/004, 2026-08-24)

- **ModelRegistry** — `name@version` identity with frozen reproducibility metadata (task, training dataset id, feature-set versions, metrics, artifact ref). Lifecycle: CANDIDATE → VALIDATING → SHADOW → PRODUCTION, with REJECTED terminal and RETIRED records preserved for historical interpretation and instant rollback (`promote(..., {isRollback:true})` from RETIRED — no retraining required). Illegal transitions fail closed; PRODUCTION promotion requires SHADOW status plus a recorded `approvedBy`; exactly one PRODUCTION version per model name (challenger promotion demotes the champion to RETIRED).
- **ShadowComparator** — champion/challenger score pairs recorded per tenant+model without any production side effect; `compare()` reports pair count, exact-agreement rate and mean absolute delta. Empty windows report `null` agreement rather than fake certainty.

## Monitoring & drift (MLOPS-005/006, 2026-08-24)

- **DriftDetector** — numeric feature drift vs a registered baseline distribution: relative mean shift scored 0..1 with configurable WARN/ALERT ratios (defaults 0.1/0.25) and a minimum-sample floor. Below the floor the detector returns `INSUFFICIENT_DATA` rather than guessing; unregistered features fail closed. Reports are frozen and carry baseline/current means plus sample sizes.
- **ModelMonitor** — counters on the shared MetricsRegistry: `model_predictions_total` (all attempts), `model_prediction_errors`, `feature_stale_total`, `feature_missing_total`, plus `model_inference_latency_ms` gauge per model. Wired for dashboards/alerts without any new infrastructure.

## Portfolio classification & rollback (MLOPS-007/OPT-001, 2026-08-24)

- **`registry.rollbackModel`** — instant RETIRED→PRODUCTION re-promotion with a mandatory actor + reason, appended as an audited `model.rollback` event; refuses unknown targets and no-op rollbacks of the already-active version.
- **`classifyPortfolio`** — deterministic product classification over ranked recommendations: `PAUSE` for zero-score candidates (inventory/dead), `WATCH` cap under feature-drift ALERT, `TEST` for LOW-confidence exploratory candidates, `SCALE` for HIGH-confidence entries at ≥50% of best score, `MAINTAIN` otherwise. Frozen, deterministic, every entry carries its reason.

## Experiment recommendations & exploration policy (OPT-002/003, 2026-08-24)

- **`recommendExperiments`** — LOW-confidence candidates become structured `CREATE_EXPERIMENT` proposals (control + challenger variants, hypothesis, expiry); proven HIGH-confidence winners are never experiment targets. Statistical floor of 30 samples per variant is enforced regardless of requested values (§50: no winners from noise).
- **`createExplorationPolicy`** — configurable exploration/exploitation split (`exploreRatio`, validated 0..1, not hard-coded): explore slots are filled by TEST-class candidates first; remaining slots go to proven performers. Frozen allocations carry organization provenance.

## Autonomous decision gate (OPT-004, 2026-08-24)

`createDecisionGate` closes the §64 loop: every model/ranker output must pass, in order —

1. **commercial revalidation** (when the action carries price/promotion claims) against live commerce evidence — BLOCK or revalidation ERROR both fail closed to DENY;
2. **automation policy plane** — tenant match, kill switches, risk routing, platform allowlist, quality/compliance floors, frequency caps, budgets, mode semantics (from `packages/automation`);
3. combined verdict `ALLOW | APPROVAL_REQUIRED | DENY` with blockers, policy checks and per-decision audit events (`intelligence.gate_decision`).

Model predictions never override live commercial truth: a stale ฿800 claim against a verified ฿850 offer denies publication no matter how high the ranker scored it.
