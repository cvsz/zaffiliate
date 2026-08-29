import { createHash } from 'node:crypto';

export const SECURITY_EVENT_TYPES = new Set([
  'RATE_LIMITED',
  'WEBHOOK_SIGNATURE_FAILURE',
  'WEBHOOK_REPLAY_DENIED',
  'CROSS_TENANT_ACCESS_DENIED',
  'OAUTH_VALIDATION_FAILURE',
  'OAUTH_LINK_COMPLETED',
  'OAUTH_DISCONNECTED',
  'SSRF_BLOCKED',
  'AGENT_PERMISSION_DENIED',
  'KILL_SWITCH_CHANGED',
  'LOGIN_FAILURE_SPIKE'
]);

const SEVERITIES = new Set(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export function createSecurityEventRecorder({ sink = null, clock = () => new Date().toISOString() } = {}) {
  if (sink != null && typeof sink !== 'function') throw new TypeError('sink must be a function');
  const counts = new Map();

  function record({ type, severity = 'LOW', resource, reason, tenantId = null }) {
    const normalizedType = String(type ?? '').trim().toUpperCase();
    if (!SECURITY_EVENT_TYPES.has(normalizedType)) throw new Error(`unsupported security event type: ${type}`);
    const normalizedSeverity = String(severity ?? '').trim().toUpperCase();
    if (!SEVERITIES.has(normalizedSeverity)) throw new Error(`unsupported severity: ${severity}`);

    const event = Object.freeze({
      eventId: `sec_${createHash('sha256').update(`${normalizedType}|${resource ?? ''}|${clock()}|${counts.size}`).digest('hex').slice(0, 20)}`,
      type: normalizedType,
      severity: normalizedSeverity,
      resource: String(resource ?? '').slice(0, 256),
      reason: String(reason ?? '').slice(0, 512),
      tenantId: tenantId == null ? null : String(tenantId).slice(0, 128),
      occurredAt: clock()
    });
    counts.set(normalizedType, (counts.get(normalizedType) ?? 0) + 1);
    if (sink) sink(event);
    return event;
  }

  function count(type) {
    return counts.get(String(type ?? '').toUpperCase()) ?? 0;
  }

  return Object.freeze({ record, count });
}

