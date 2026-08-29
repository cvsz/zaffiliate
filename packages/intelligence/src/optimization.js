import { randomUUID } from 'node:crypto';

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

const MIN_SAMPLES_FLOOR = 30;
const DEFAULT_EXPLORE_RATIO = 0.2;

function mint(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function recommendExperiments({ organizationId, ranked, now = Date.now(), minSamplesPerVariant = MIN_SAMPLES_FLOOR }) {
  requireText(organizationId, 'organizationId');
  if (!ranked || !Array.isArray(ranked.ranked)) throw new TypeError('ranked result with ranked[] is required');
  const floor = Math.max(MIN_SAMPLES_FLOOR, Number(minSamplesPerVariant) || 0);

  const experiments = [];
  for (const entry of ranked.ranked) {
    if (entry.confidence !== 'LOW') continue;
    experiments.push(Object.freeze({
      recommendationId: mint('rcm'),
      organizationId,
      type: 'CREATE_EXPERIMENT',
      subjectId: entry.productId,
      hypothesis: `Determine real performance of ${entry.productId}: current evidence is exploratory (LOW confidence)`,
      variants: Object.freeze([
        Object.freeze({ key: 'control', description: `current default treatment for ${entry.productId}` }),
        Object.freeze({ key: 'challenger', description: `alternative hook/CTA for ${entry.productId}` })
      ]),
      minSamplesPerVariant: floor,
      score: entry.score,
      expiresAt: entry.expiresAt ?? new Date(now + 24 * 3600000).toISOString(),
      createdAt: new Date(now).toISOString()
    }));
  }

  return Object.freeze({
    organizationId,
    generatedAt: new Date(now).toISOString(),
    experiments: Object.freeze(experiments)
  });
}

export function createExplorationPolicy({ exploreRatio = DEFAULT_EXPLORE_RATIO } = {}) {
  const ratio = Number(exploreRatio);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error(`exploreRatio must be between 0 and 1, got ${exploreRatio}`);
  }

  function allocate({ totalSlots, entries = [], organizationId }) {
    const slots = Math.max(0, Number(totalSlots) || 0);
    const exploreSlots = Math.min(slots, Math.floor(slots * ratio));
    const exploitSlots = slots - exploreSlots;

    const sorted = [...entries].sort((a, b) => b.score - a.score || String(a.productId).localeCompare(String(b.productId)));
    const explorers = sorted.filter((entry) => entry.confidence === 'LOW').slice(0, exploreSlots);
    const explorerIds = new Set(explorers.map((entry) => entry.productId));
    const exploiters = sorted.filter((entry) => !explorerIds.has(entry.productId)).slice(0, exploitSlots);

    return Object.freeze({
      organizationId: organizationId == null ? null : String(organizationId),
      totalSlots: slots,
      exploreRatio: ratio,
      exploreSlots,
      exploitSlots,
      exploreProductIds: Object.freeze(explorers.map((entry) => entry.productId)),
      exploitProductIds: Object.freeze(exploiters.map((entry) => entry.productId))
    });
  }

  return Object.freeze({ allocate });
}
