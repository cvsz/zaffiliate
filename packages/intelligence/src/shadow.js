import { randomUUID } from 'node:crypto';
export function createShadowComparator({ clock = () => new Date().toISOString() } = {}) {
  const partitions = new Map();

  function partition(tenantId) {
    const id = requireText(tenantId, 'tenantId');
    let scope = partitions.get(id);
    if (!scope) {
      scope = { pairs: [] };
      partitions.set(id, scope);
    }
    return scope;
  }

  function record({ tenantId, modelName, modelVersion, entityId, championScore, challengerScore }) {
    const champion = Number(championScore);
    const challenger = Number(challengerScore);
    if (!Number.isFinite(champion) || !Number.isFinite(challenger)) {
      throw new Error('champion and challenger scores must be finite numbers');
    }
    const pair = Object.freeze({
      pairId: mint('shd'),
      recordedAt: clock(),
      modelName: requireText(modelName, 'modelName'),
      modelVersion: modelVersion == null ? null : String(modelVersion),
      entityId: requireText(entityId, 'entityId'),
      championScore: champion,
      challengerScore: challenger
    });
    partition(tenantId).pairs.push(pair);
    return pair;
  }

  function compare(tenantId, modelName) {
    const pairs = partition(tenantId).pairs.filter((pair) => pair.modelName === modelName);
    if (pairs.length === 0) {
      return Object.freeze({ pairs: 0, agreementRate: null, meanAbsoluteDelta: null });
    }
    let agreements = 0;
    let deltaSum = 0;
    for (const pair of pairs) {
      const delta = Math.abs(pair.championScore - pair.challengerScore);
      deltaSum += delta;
      if (delta === 0) agreements += 1;
    }
    return Object.freeze({
      pairs: pairs.length,
      agreementRate: Math.round((agreements / pairs.length) * 10000) / 10000,
      meanAbsoluteDelta: Math.round((deltaSum / pairs.length) * 10000) / 10000
    });
  }

  return Object.freeze({ record, compare });
}

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function mint(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
