import { defineBaselineRanker } from './index.js';

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

const FEATURE_DEFS = Object.freeze([
  { name: 'offer_discount_ratio', entityType: 'Offer', valueType: 'number', freshnessWindowMs: 30 * 60 * 1000 },
  { name: 'offer_inventory', entityType: 'Offer', valueType: 'string', freshnessWindowMs: 10 * 60 * 1000 },
  { name: 'offer_price_minor', entityType: 'Offer', valueType: 'number', freshnessWindowMs: 30 * 60 * 1000 },
  { name: 'product_clicks_7d', entityType: 'Product', valueType: 'number', freshnessWindowMs: 24 * 60 * 60 * 1000 },
  { name: 'product_cvr_7d', entityType: 'Product', valueType: 'number', freshnessWindowMs: 24 * 60 * 60 * 1000 },
  { name: 'product_net_commission_7d_minor', entityType: 'Product', valueType: 'number', freshnessWindowMs: 24 * 60 * 60 * 1000 }
]);

function ensureDefinitions(featureStore) {
  for (const def of FEATURE_DEFS) {
    try {
      featureStore.defineFeature({ ...def, source: 'intelligence-pipeline', owner: 'intelligence' });
    } catch (error) {
      if (!/already defined/.test(error.message)) throw error;
    }
  }
}

export function computeOfferFeatures({ commerceStore, analyticsEvents, featureStore, tenantId, offerIds }) {
  if (!commerceStore || typeof commerceStore.getOffer !== 'function') throw new TypeError('commerceStore is required');
  if (!analyticsEvents || typeof analyticsEvents.summarizeByProduct !== 'function') throw new TypeError('analyticsEvents with summarizeByProduct is required');
  requireText(tenantId, 'tenantId');
  ensureDefinitions(featureStore);

  const perProduct = analyticsEvents.summarizeByProduct(tenantId);
  const computed = [];
  for (const offerId of offerIds ?? []) {
    const offer = commerceStore.getOffer(tenantId, offerId);
    if (!offer) continue;

    if (offer.listPriceMinorUnits > 0 && offer.salePriceMinorUnits != null) {
      const ratio = Math.round((1 - offer.salePriceMinorUnits / offer.listPriceMinorUnits) * 100) / 100;
      featureStore.setValue(tenantId, 'offer_discount_ratio', { entityId: offerId, value: ratio, computedAt: offer.verifiedAt });
    }
    featureStore.setValue(tenantId, 'offer_inventory', { entityId: offerId, value: offer.inventoryStatus, computedAt: offer.verifiedAt });
    featureStore.setValue(tenantId, 'offer_price_minor', { entityId: offerId, value: offer.effectivePriceMinorUnits, computedAt: offer.verifiedAt });

    const metrics = perProduct.get(offer.productId);
    if (metrics) {
      featureStore.setValue(tenantId, 'product_clicks_7d', { entityId: offer.productId, value: metrics.clicks });
      const cvr = metrics.clicks > 0 ? Math.round((metrics.conversions / metrics.clicks) * 10000) / 10000 : 0;
      featureStore.setValue(tenantId, 'product_cvr_7d', { entityId: offer.productId, value: cvr });
      featureStore.setValue(tenantId, 'product_net_commission_7d_minor', { entityId: offer.productId, value: metrics.netCommissionMinorUnits });
    } else {
      featureStore.setValue(tenantId, 'product_clicks_7d', { entityId: offer.productId, value: 0 });
      featureStore.setValue(tenantId, 'product_cvr_7d', { entityId: offer.productId, value: 0 });
      featureStore.setValue(tenantId, 'product_net_commission_7d_minor', { entityId: offer.productId, value: 0 });
    }
    computed.push({ offerId, productId: offer.productId });
  }
  return Object.freeze({ computed: Object.freeze(computed.map((entry) => Object.freeze(entry))) });
}

export function createRecommendationService({ featureStore = null, recommendationStore, predictionStore, ranker = null }) {
  if (!recommendationStore || typeof recommendationStore.save !== 'function') throw new TypeError('recommendationStore is required');
  if (!predictionStore || typeof predictionStore.save !== 'function') throw new TypeError('predictionStore is required');
  const rankerInstance = ranker ?? defineBaselineRanker({ featureStore });

  function rankAndRecord({ tenantId, now = Date.now(), candidates }) {
    const ranked = rankerInstance.rank({ tenantId, now, candidates });
    const recommendationIds = [];
    let topPrediction = null;
    for (const entry of ranked.ranked) {
      const saved = recommendationStore.save({
        tenantId,
        type: entry.score > 0 ? 'PROMOTE_PRODUCT' : 'WATCH_PRODUCT',
        subjectId: entry.productId,
        productId: entry.productId,
        score: entry.score,
        confidence: entry.confidence,
        explanation: entry.explanation,
        expiresAt: entry.expiresAt,
        modelVersion: ranked.modelVersion
      });
      recommendationIds.push(saved.recommendationId);
    }
    const top = ranked.ranked[0];
    if (top) {
      topPrediction = predictionStore.save({
        tenantId,
        model: 'opportunity-ranker',
        modelVersion: ranked.modelVersion,
        entity: { type: 'Product', id: top.productId },
        featuresVersion: {},
        prediction: { productId: top.productId, score: top.score, reasons: top.explanation.reasons },
        confidence: top.confidence,
        validUntil: top.expiresAt
      });
    }
    return Object.freeze({
      tenantId,
      generatedAt: ranked.generatedAt,
      modelVersion: ranked.modelVersion,
      ranked: ranked.ranked,
      recommendations: Object.freeze(recommendationIds),
      topPrediction
    });
  }

  return Object.freeze({ rankAndRecord });
}
