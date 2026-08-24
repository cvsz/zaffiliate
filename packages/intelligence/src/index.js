const ENTITY_TYPES = new Set(['Product', 'Offer', 'Campaign', 'Creative', 'Publication', 'Platform', 'Audience', 'Organization']);
const VALUE_TYPES = new Set(['number', 'string', 'boolean']);
const FRESHNESS_STATES = Object.freeze({ FRESH: 'FRESH', AGING: 'AGING', STALE: 'STALE', UNKNOWN: 'UNKNOWN' });

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

export function createFeatureStore({ clock = () => Date.now(), owner = 'intelligence' } = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const definitions = new Map();
  const partitions = new Map();

  function defineFeature({ name, entityType, valueType, version = 1, source = 'derived', freshnessWindowMs, description = '' }) {
    const featureName = requireText(name, 'name');
    if (!ENTITY_TYPES.has(entityType)) throw new Error(`unsupported entity type: ${entityType}`);
    if (!VALUE_TYPES.has(valueType)) throw new Error(`unsupported value type: ${valueType}`);
    const numericVersion = Number(version);
    if (!Number.isInteger(numericVersion) || numericVersion < 1) throw new Error('version must be a positive integer');
    const key = `${featureName}@${numericVersion}`;
    if (definitions.has(key)) throw new Error(`feature ${key} already defined`);
    const window = Number(freshnessWindowMs);
    if (!Number.isFinite(window) || window <= 0) throw new Error('freshnessWindowMs must be a positive number');
    const definition = Object.freeze({
      name: featureName,
      entityType,
      valueType,
      version: numericVersion,
      source: requireText(source, 'source'),
      freshnessWindowMs: window,
      owner: requireText(owner, 'owner'),
      description: String(description ?? '').slice(0, 512)
    });
    definitions.set(key, definition);
    return definition;
  }

  function latestVersion(featureName) {
    let latest = null;
    for (const [key, def] of definitions) {
      if (!key.startsWith(`${featureName}@`)) continue;
      if (latest == null || def.version > latest.version) latest = def;
    }
    return latest;
  }

  function getDefinition(featureName, version = null) {
    if (version == null) return latestVersion(requireText(featureName, 'name'));
    return definitions.get(`${requireText(featureName, 'name')}@${Number(version)}`) ?? null;
  }

  function partition(tenantId) {
    const id = requireText(tenantId, 'tenantId');
    let scope = partitions.get(id);
    if (!scope) {
      scope = new Map();
      partitions.set(id, scope);
    }
    return scope;
  }

  function setValue(tenantId, featureName, { entityId, value, version = null, computedAt = null }) {
    const definition = getDefinition(featureName, version);
    if (!definition) throw new Error(`undefined feature: ${featureName}@${version ?? 'latest'}`);
    const entityKey = requireText(entityId, 'entityId');
    if (definition.valueType === 'number') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) throw new Error(`feature ${definition.name} expects number, got ${typeof value}`);
      value = numeric;
    } else if (definition.valueType === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`feature ${definition.name} expects boolean`);
    } else if (typeof value !== 'string') {
      throw new Error(`feature ${definition.name} expects string`);
    }
    const computedIso = new Date(computedAt ?? clock()).toISOString();
    partition(tenantId).set(`${definition.name}@${definition.version}:${entityKey}`, Object.freeze({
      definitionVersion: definition.version,
      entityType: definition.entityType,
      entityId: entityKey,
      value: Object.freeze(value),
      computedAt: computedIso
    }));
  }

  function getValue(tenantId, featureName, entityId, { at = null } = {}) {
    const scope = partition(tenantId);
    let best = null;
    for (const [key, entry] of scope) {
      if (!key.startsWith(`${requireText(featureName, 'featureName')}@`)) continue;
      if (!key.endsWith(`:${requireText(entityId, 'entityId')}`)) continue;
      if (best == null || entry.definitionVersion > best.definitionVersion) best = entry;
    }
    if (!best) return Object.freeze({ value: null, freshnessStatus: FRESHNESS_STATES.UNKNOWN, computedAt: null });
    const nowMs = at == null ? clock() : new Date(at).getTime();
    const age = nowMs - new Date(best.computedAt).getTime();
    const window = getDefinition(featureName, best.definitionVersion)?.freshnessWindowMs ?? Infinity;
    const status = age < 0 || !Number.isFinite(age)
      ? FRESHNESS_STATES.UNKNOWN
      : age <= window * 0.5
        ? FRESHNESS_STATES.FRESH
        : age <= window
          ? FRESHNESS_STATES.AGING
          : FRESHNESS_STATES.STALE;
    return Object.freeze({
      value: status === FRESHNESS_STATES.STALE ? null : best.value,
      freshnessStatus: status,
      computedAt: best.computedAt,
      staleValueRetained: status === FRESHNESS_STATES.STALE ? best.value : undefined
    });
  }

  function size(tenantId) {
    return partitions.get(tenantId)?.size ?? 0;
  }

  return Object.freeze({ defineFeature, getDefinition, setValue, getValue, size });
}

export function defineBaselineRanker({ featureStore } = {}) {
  if (featureStore != null && typeof featureStore.getDefinition !== 'function') {
    throw new TypeError('featureStore must expose getDefinition');
  }
  const CONF_WEIGHTS = { HIGH: 1, MEDIUM: 0.8, LOW: 0.5 };

  function confidenceFor(clicks) {
    if (clicks >= 100) return 'HIGH';
    if (clicks >= 20) return 'MEDIUM';
    return 'LOW';
  }

  function evaluate(candidate, now) {
    const reasons = [];
    const offer = candidate.offer ?? {};
    const metrics = candidate.metrics ?? {};
    const clicks = Math.max(0, Number(metrics.clicks ?? 0));
    const conversions = Math.max(0, Number(metrics.conversions ?? 0));
    const netCommission = Math.max(0, Number(metrics.netCommissionMinorUnits ?? 0));
    const refunds = Math.max(0, Number(metrics.refundsMinorUnits ?? 0));

    const inventory = String(offer.inventoryStatus ?? 'UNKNOWN').toUpperCase();
    if (inventory === 'OUT_OF_STOCK' || inventory === 'UNKNOWN') {
      return {
        score: 0,
        confidence: 'LOW',
        reasons: [`inventory ${inventory} — not promotable until provider confirms availability`],
        factors: { cvr: 0, discountRatio: 0, refundRisk: 1, expectedNetMinorUnits: 0 }
      };
    }

    const cvr = clicks > 0 ? conversions / clicks : 0;
    reasons.push(`observed cvr ${(cvr * 100).toFixed(1)}% over ${clicks} clicks`);

    let discountRatio = 0;
    if (offer.listPriceMinorUnits > 0 && offer.priceMinorUnits != null) {
      discountRatio = Math.max(0, Math.min(1, 1 - offer.priceMinorUnits / offer.listPriceMinorUnits));
      if (discountRatio > 0) reasons.push(`verified discount ${(discountRatio * 100).toFixed(0)}% vs list price`);
    }

    const refundRisk = netCommission > 0 ? Math.min(0.9, refunds / netCommission) : 0.5;
    if (refundRisk > 0.2) reasons.push(`elevated refund risk ${(refundRisk * 100).toFixed(0)}%`);

    const commissionRate = Math.max(0, Math.min(1, Number(offer.commissionRate ?? 0)));
    const expectedNetMinorUnits = Math.round(commissionRate * (offer.priceMinorUnits ?? 0) * (1 - refundRisk));
    reasons.push(`expected net commission ${expectedNetMinorUnits} minor units per conversion at rate ${(commissionRate * 100).toFixed(0)}%`);

    let promotionFactor = 1;
    if (offer.promotionEndsAt != null) {
      const endsAt = new Date(offer.promotionEndsAt).getTime();
      if (endsAt <= now) {
        promotionFactor = 0.7;
        reasons.push('promotion expired — urgency claims must be removed before any publication');
      } else {
        reasons.push(`promotion active for ${Math.ceil((endsAt - now) / 3600000)}h more`);
      }
    }

    const confidence = confidenceFor(clicks);
    if (confidence === 'LOW') reasons.push('small sample — treat ranking as exploratory');

    const score = Math.round(
      expectedNetMinorUnits *
      cvr *
      (1 + discountRatio) *
      CONF_WEIGHTS[confidence] *
      promotionFactor
    );
    return { score, confidence, reasons, factors: { cvr, discountRatio, refundRisk, expectedNetMinorUnits } };
  }

  function rank({ tenantId, candidates, now = Date.now() }) {
    requireText(tenantId, 'tenantId');
    if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
    const generatedAt = new Date(now).toISOString();
    const defaultExpiry = now + 24 * 3600000;

    const entries = candidates.map((candidate) => {
      const outcome = evaluate(candidate, now);
      return Object.freeze({
        productId: requireText(candidate.productId, 'productId'),
        score: outcome.score,
        confidence: outcome.confidence,
        explanation: Object.freeze({ reasons: Object.freeze([...outcome.reasons]) }),
        expiresAt: new Date(Math.min(
          defaultExpiry,
          Math.max(now + 3600000, candidate.offer?.promotionEndsAt != null ? new Date(candidate.offer.promotionEndsAt).getTime() : 0)
        )).toISOString()
      });
    });

    entries.sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId));

    return Object.freeze({
      tenantId,
      generatedAt,
      modelVersion: 'baseline-rules-v1',
      ranked: Object.freeze(entries)
    });
  }

  return Object.freeze({ rank });
}
