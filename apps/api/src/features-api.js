import { createAutomationPolicy, evaluateAction, setKillSwitch } from '../../../packages/automation/src/index.js';
import { createDecisionGate } from '../../../packages/intelligence/src/decision-gate.js';
import {
  PERSONAS,
  getPersona,
  createCreativeBrief,
  generateHooks,
  scoreContentQuality,
  getPrompt
} from '../../../packages/ai-content/src/factory.js';

const AUTOMATION_MODES = ['manual', 'assisted', 'draft_only', 'approval_required', 'auto_safe', 'autonomous'];

export function createFeatureApi(deps) {
  const {
    commerceStore,
    analyticsEvents,
    recommendationService,
    recommendationStore,
    automationDefaults = {}
  } = deps;

  const policies = new Map();
  const killSwitchesByTenant = new Map();
  const briefsByTenant = new Map();
  const decisionGate = commerceStore ? createDecisionGate({ commerceStore }) : null;

  function getPolicy(tenantId) {
    if (!policies.has(tenantId)) {
      policies.set(tenantId, createAutomationPolicy({ organizationId: tenantId, ...automationDefaults }));
    }
    return policies.get(tenantId);
  }

  function getSwitches(tenantId) {
    if (!killSwitchesByTenant.has(tenantId)) killSwitchesByTenant.set(tenantId, []);
    return killSwitchesByTenant.get(tenantId);
  }

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

  async function handle(pathname, method, tenantId, { body = null, actorId = null } = {}) {
    if (!pathname.startsWith('/api/v1/')) return null;
    const trustedActorId = actorId == null ? 'operator' : String(actorId);

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
          actorId: trustedActorId,
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

    if (pathname === '/api/v1/automation/status' && method === 'GET') {
      const policy = getPolicy(tenantId);
      return { status: 200, body: { mode: policy.mode, policyVersion: policy.version, allowAutoPublish: policy.allowAutoPublish, activeKillSwitches: getSwitches(tenantId).filter((k) => k.active) } };
    }

    if (pathname === '/api/v1/automation/kill-switch' && method === 'POST') {
      try {
        const record = setKillSwitch({
          scope: String(body?.scope ?? ''), id: body?.id ?? null,
          active: body?.active !== false,
          reason: String(body?.reason ?? ''), actorId: trustedActorId
        });
        getSwitches(tenantId).push(record);
        return { status: 200, body: { ok: true, switch: record } };
      } catch (error) {
        return { status: 400, error: { code: 'INVALID_KILL_SWITCH', message: error.message } };
      }
    }

    if (pathname === '/api/v1/automation/policy' && method === 'PUT') {
      try {
        if (!body || typeof body !== 'object') throw new Error('policy body is required');
        const mode = String(body.mode ?? 'manual').toLowerCase();
        if (!AUTOMATION_MODES.includes(mode)) throw new Error(`unsupported automation mode: ${mode}`);
        const next = createAutomationPolicy({ ...body, organizationId: tenantId, mode });
        policies.set(tenantId, next);
        return { status: 200, body: { mode: next.mode, policyVersion: next.version, allowAutoPublish: next.allowAutoPublish } };
      } catch (error) {
        return { status: 400, error: { code: 'INVALID_POLICY', message: error.message } };
      }
    }

    if (pathname === '/api/v1/intelligence/gate' && method === 'POST' && decisionGate) {
      const outcome = decisionGate.evaluate({
        policy: getPolicy(tenantId),
        action: body?.action ?? {},
        counters: { postsToday: () => 0, aiCostTodayMinorUnits: () => 0, campaignAiCostMinorUnits: () => 0 },
        killSwitches: getSwitches(tenantId),
        context: { tenantId, actorId: trustedActorId }
      });
      return { status: 200, body: outcome };
    }

    if (pathname === '/api/v1/content/personas' && method === 'GET') {
      return { status: 200, body: { personas: PERSONAS.map((p) => ({ id: p.id, name: p.name })) } };
    }

    if (pathname === '/api/v1/content/briefs' && method === 'POST') {
      try {
        const brief = createCreativeBrief({ ...(body ?? {}), tenantId });
        const scope = briefsByTenant.get(tenantId) ?? new Map();
        scope.set(brief.briefId, brief);
        briefsByTenant.set(tenantId, scope);
        return { status: 200, body: { brief } };
      } catch (error) {
        return { status: 422, error: { code: 'INVALID_BRIEF', message: error.message } };
      }
    }

    if (pathname === '/api/v1/content/hooks' && method === 'POST') {
      const brief = briefsByTenant.get(tenantId)?.get(String(body?.briefId ?? ''));
      if (!brief) return { status: 404, error: { code: 'BRIEF_NOT_FOUND', message: 'unknown briefId for this tenant' } };
      const result = generateHooks({ brief, count: Math.min(Number(body?.count ?? 20), 40) });
      return { status: 200, body: { hooks: result.hooks, rejected: result.rejected, prompt: result.prompt.name } };
    }

    if (pathname === '/api/v1/content/score' && method === 'POST') {
      return { status: 200, body: { score: scoreContentQuality(body ?? {}) } };
    }

    void getPersona;
    void getPrompt;
    void evaluateAction;
    return null;
  }

  return Object.freeze({ handle, listOffers });
}
