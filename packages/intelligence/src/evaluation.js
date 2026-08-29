function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i] - meanX;
    const b = ys[i] - meanY;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return Math.round((num / Math.sqrt(dx * dy)) * 10000) / 10000;
}

export function evaluateRanking({ ranked, groundTruth, now = new Date().toISOString(), k = null }) {
  if (!ranked || !Array.isArray(ranked.ranked)) throw new TypeError('ranked result with ranked[] is required');
  if (!groundTruth || typeof groundTruth !== 'object') throw new TypeError('groundTruth is required');
  const knownGood = new Set(groundTruth.knownGood ?? []);
  const outcomes = groundTruth.outcomeByProduct ?? {};

  const desiredK = Number(k) || knownGood.size || ranked.ranked.length;
  const topK = Math.max(1, Math.min(desiredK, ranked.ranked.length));
  const topEntries = ranked.ranked.slice(0, topK);
  const hasOutcome = (entry) => Number.isFinite(Number(outcomes[entry.productId]));
  const anyVerifiable = topEntries.some(hasOutcome);
  const verifiedGood = topEntries.filter((entry) => knownGood.has(entry.productId) && hasOutcome(entry)).length;
  const verifiedBadInWindow = topEntries.some((entry) => !knownGood.has(entry.productId) && hasOutcome(entry));
  const hits = anyVerifiable
    ? (verifiedBadInWindow && verifiedGood < topK ? 0 : verifiedGood)
    : 0;
  const denominator = Math.max(1, topK);

  const pairedScores = [];
  const pairedOutcomes = [];
  for (const entry of ranked.ranked) {
    const outcome = outcomes[entry.productId];
    if (outcome == null || !Number.isFinite(Number(outcome))) continue;
    pairedScores.push(entry.score);
    pairedOutcomes.push(Number(outcome));
  }

  return Object.freeze({
    modelVersion: ranked.modelVersion,
    evaluatedAt: new Date(now).toISOString(),
    k: topK,
    topKHitRate: hits / denominator,
    scoreOutcomeCorrelation: pearson(pairedScores, pairedOutcomes),
    sampleSize: pairedScores.length
  });
}

export function explainRecommendation(record, { featureFreshness = {}, now = new Date().toISOString() } = {}) {
  if (!record || typeof record !== 'object' || record.recommendationId == null) {
    throw new TypeError('recommendation record is required');
  }
  const expired = record.expiresAt != null && new Date(record.expiresAt).getTime() <= new Date(now).getTime();
  const statusLabel = expired ? `${record.status} (EXPIRED — must not be executed)` : record.status;
  const summaryText = `${record.type} ${record.subjectId} — ${statusLabel}`;

  return Object.freeze({
    recommendationId: record.recommendationId,
    executable: !expired && record.status === 'ACTIVE',
    confidence: String(record.confidence ?? 'LOW').toUpperCase(),
    modelVersion: String(record.modelVersion ?? 'unknown'),
    reasons: Object.freeze([...(record.explanation?.reasons ?? [])]),
    dataFreshness: Object.freeze({ ...featureFreshness }),
    expiresAt: record.expiresAt ?? null,
    summary: Object.freeze({
      type: record.type,
      subjectId: record.subjectId,
      text: `${summaryText}: ${(record.explanation?.reasons ?? []).join('; ')}`
    })
  });
}
