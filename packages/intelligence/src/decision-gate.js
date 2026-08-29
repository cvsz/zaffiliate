import { evaluateAction } from '../../automation/src/index.js';

export function createDecisionGate({ commerceStore = null, auditSink = null } = {}) {
  function evaluate({ policy, action, counters, killSwitches = [], context = {}, now }) {
    const blockers = [];

    let commercialRevalidation = { decision: 'SKIPPED', reason: 'no commercial claims on this action' };
    if (action.commercialClaim && commerceStore) {
      try {
        commercialRevalidation = commerceStore.revalidateCommercialClaim(
          context.tenantId ?? policy.organizationId,
          {
            offerId: action.offerId,
            claim: action.commercialClaim,
            scheduledFor: action.scheduledFor ?? null,
            nowOverride: now
          }
        );
        if (commercialRevalidation.decision === 'BLOCK') {
          blockers.push(`commercial_revalidation:${commercialRevalidation.reason}`);
        }
      } catch (error) {
        blockers.push(`commercial_revalidation:error — ${error.message.slice(0, 120)}`);
        commercialRevalidation = { decision: 'ERROR', reason: error.message.slice(0, 120) };
      }
    }

    const policyDecision = evaluateAction({
      policy,
      action,
      counters,
      killSwitches,
      context,
      auditSink: auditSink
        ? (event) => auditSink({
            ...event,
            detail: Object.freeze({
              ...event.detail,
              gateDecision: undefined,
              blockers: Object.freeze([...blockers])
            })
          })
        : null,
      now
    });

    let decision;
    let reason;
    if (blockers.length > 0) {
      decision = 'DENY';
      reason = `blocked by commercial revalidation (${blockers.join('; ')})`;
    } else {
      decision = policyDecision.decision;
      reason = policyDecision.reason;
    }

    const payload = Object.freeze({
      decision,
      reason,
      commercialRevalidation: commercialRevalidation ?? Object.freeze({ decision: 'SKIPPED', reason: 'no commercial claims on this action' }),
      blockers: Object.freeze([...blockers]),
      policyDecision: Object.freeze({
        decision: policyDecision.decision,
        reason: policyDecision.reason,
        requiredApprover: policyDecision.requiredApprover,
        checks: policyDecision.checks
      }),
      policyVersion: policy.version,
      modelVersion: action.modelVersion ?? null,
      decidedAt: new Date(now ?? Date.now()).toISOString()
    });

    if (auditSink) {
      auditSink(Object.freeze({
        occurredAt: payload.decidedAt,
        tenantId: policy.organizationId,
        actor: String(context.actorId ?? 'system'),
        action: 'intelligence.gate_decision',
        resourceId: String(action.type ?? 'unknown'),
        detail: Object.freeze({
          gateDecision: decision,
          reason,
          policyVersion: policy.version,
          blockers: Object.freeze([...blockers])
        })
      }));
    }

    return payload;
  }

  return Object.freeze({ evaluate });
}
