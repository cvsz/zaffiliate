export const PORTFOLIO_CLASSIFICATIONS = Object.freeze([
  'SCALE', 'MAINTAIN', 'TEST', 'WATCH', 'PAUSE', 'ARCHIVE'
]);

const TOP_TIER_RATIO = 0.25;

function frozenEntry(entry) {
  return Object.freeze({
    ...entry,
    reason: String(entry.reason)
  });
}

export function classifyPortfolio({ ranked, driftByProduct = {}, now = new Date().toISOString() } = {}) {
  if (!ranked || !Array.isArray(ranked.ranked)) throw new TypeError('ranked result with ranked[] is required');
  void now;

  const total = ranked.ranked.length;
  const topTierCutoff = Math.max(1, Math.ceil(total * TOP_TIER_RATIO));
  let highestScore = 0;
  for (const entry of ranked.ranked) {
    if (entry.score > highestScore) highestScore = entry.score;
  }

  const entries = ranked.ranked.map((entry, index) => {
    let classification = 'MAINTAIN';
    let reason = 'mid-tier expected value — maintain current treatment';

    if (entry.score === 0) {
      classification = 'PAUSE';
      reason = `not promotable — score is zero (${entry.explanation.reasons.join('; ') || 'no eligible capability'})`;
    } else if ((driftByProduct[entry.productId]?.severity ?? 'NONE') === 'ALERT') {
      classification = 'WATCH';
      reason = `feature drift ALERT on this product's inputs — automation eligibility capped until data stabilizes`;
    } else if (entry.confidence === 'LOW') {
      classification = 'TEST';
      reason = 'exploratory: small sample — run a controlled test before scaling';
    } else if (entry.confidence === 'HIGH' && entry.score >= highestScore * 0.5) {
      classification = 'SCALE';
      reason = `top-tier expected value with HIGH confidence (score ${entry.score} vs best ${highestScore}, rank ${index + 1} of ${total})`;
    }

    return frozenEntry({ productId: entry.productId, rank: index + 1, score: entry.score, confidence: entry.confidence, classification, reason });
  });

  function topTierCutOff(cutoff, index) {
    return cutoff;
  }

  return Object.freeze({
    generatedAt: ranked.generatedAt ?? null,
    modelVersion: ranked.modelVersion ?? 'unknown',
    entries: Object.freeze(entries)
  });
}
