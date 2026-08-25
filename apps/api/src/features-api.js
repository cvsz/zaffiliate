export function createFeatureApi(deps) {
  const {
    commerceStore,
    analyticsEvents,
    recommendationService,
    recommendationStore
  } = deps;

  function listOffers(tenantId) {
    const scope = commerceStore.partitions.get(tenantId);
    if (!scope) return [];
    return [...scope.offers.values()].map((offer) => ({
      offerId: offer.offerId,
      provider: offer.provider,
      productId: offer.productId,
      currency: offer.currency,
      listPriceMinorUnits: offer.listPriceMinorUnits,
      salePriceMinorUnits: offer.salePriceMinorUnits,
      effectivePriceMinorUnits: offer.effectivePriceMinorUnits,
      inventoryStatus: offer.inventoryStatus,
      purchasable: offer.purchasable,
      commissionRate: offer.commissionRate,
      verifiedAt: offer.verifiedAt
    }));
  }

  function candidatesFromOffers(tenantId, offers) {
    const perProduct = analyticsEvents.summarizeByProduct(tenantId);
    return offers.map((offer) => ({
      productId: offer.productId,
      offer: {
        priceMinorUnits: offer.salePriceMinorUnits ?? offer.effectivePriceMinorUnits,
        listPriceMinorUnits: offer.listPriceMinorUnits,
        commissionRate: offer.commissionRate ?? 0,
        inventoryStatus: offer.inventoryStatus
      },
      metrics: (() => {
        const m = perProduct.get(offer.productId);
        return m ? { clicks: m.clicks, conversions: m.conversions, netCommissionMinorUnits: m.netCommissionMinorUnits, refundsMinorUnits: 0 } : { clicks: 0, conversions: 0, netCommissionMinorUnits: 0, refundsMinorUnits: 0 };
      })()
    }));
  }

  async function handle(pathname, method, tenantId, { body = null } = {}) {
    if (!pathname.startsWith('/api/v1/')) return null;

    if (method === 'GET' && pathname === '/api/v1/commerce/offers') {
      return { status: 200, body: { offers: listOffers(tenantId) } };
    }

    if (method === 'GET' && pathname === '/api/v1/intelligence/opportunities/rank') {
      const offers = listOffers(tenantId);
      const outcome = await recommendationService.rankAndRecord({
        tenantId, now: Date.now(), candidates: candidatesFromOffers(tenantId, offers)
      });
      return {
        status: 200,
        body: {
          modelVersion: outcome.modelVersion,
          generatedAt: outcome.generatedAt,
          ranked: outcome.ranked.map((entry) => ({
            productId: entry.productId,
            score: entry.score,
            confidence: entry.confidence,
            reasons: entry.explanation.reasons,
            expiresAt: entry.expiresAt
          })),
          recommendations: outcome.recommendations
        }
      };
    }

    if (method === 'GET' && pathname === '/api/v1/intelligence/recommendations') {
      const rows = recommendationStore.list(tenantId).map((record) => ({
        recommendationId: record.recommendationId,
        type: record.type,
        subjectId: record.subjectId,
        score: record.score,
        confidence: record.confidence,
        status: record.status,
        expiresAt: record.expiresAt,
        modelVersion: record.modelVersion,
        reasons: record.explanation?.reasons ?? []
      }));
      return { status: 200, body: { recommendations: rows } };
    }

    const feedbackMatch = method === 'POST' ? pathname.match(/^\/api\/v1\/intelligence\/recommendations\/([^/]+)\/feedback$/) : null;
    if (feedbackMatch) {
      if (!body || typeof body !== 'object') return { status: 400, error: { code: 'INVALID_BODY', message: 'json body required' } };
      try {
        const updated = recommendationStore.feedback(tenantId, feedbackMatch[1], {
          decision: String(body.decision ?? '').toUpperCase(),
          actorId: String(body.actorId ?? 'operator'),
          reason: String(body.reason ?? '')
        });
        return { status: 200, body: { recommendationId: updated.recommendationId, status: updated.status, feedback: updated.feedback } };
      } catch (error) {
        return { status: error.message.includes('not found') ? 404 : 400, error: { code: 'FEEDBACK_FAILED', message: error.message } };
      }
    }

    if (method === 'GET' && pathname === '/api/v1/analytics/overview') {
      return { status: 200, body: analyticsEvents.summarize(tenantId) };
    }

    return null;
  }

  return Object.freeze({ handle, listOffers });
}
