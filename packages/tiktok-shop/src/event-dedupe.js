const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function toPositiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function requireEventId(eventId) {
  const key = String(eventId ?? '').trim();
  if (!key) throw new Error('eventId is required');
  return key;
}

function normalizeTimestampMs(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
}

export function createEventDedupeStore({ ttlMs = DEFAULT_TTL_MS } = {}) {
  const ttl = toPositiveNumber(ttlMs, 'ttlMs');
  const entries = new Map();

  function seen(eventId) {
    const key = requireEventId(eventId);
    const entry = entries.get(key);
    if (!entry) return false;
    if (entry.expiresAtMs <= Date.now()) {
      entries.delete(key);
      return false;
    }
    return true;
  }

  function record(eventId, meta = {}) {
    const key = requireEventId(eventId);
    if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) throw new TypeError('meta must be an object');
    const receivedAtMs = meta.receivedAt == null ? Date.now() : normalizeTimestampMs(meta.receivedAt, 'receivedAt');
    const tenantId = meta.tenantId == null ? null : String(meta.tenantId);
    const firstTime = !seen(key);
    entries.set(key, Object.freeze({ tenantId, receivedAtMs, expiresAtMs: receivedAtMs + ttl }));
    return firstTime;
  }

  return Object.freeze({ seen, record });
}

export function createWebhookReplayGuard({ dedupeStore, windowSeconds = 300 } = {}) {
  if (!dedupeStore || typeof dedupeStore !== 'object' || typeof dedupeStore.seen !== 'function' || typeof dedupeStore.record !== 'function') {
    throw new TypeError('dedupeStore with seen and record is required');
  }
  const window = toPositiveNumber(windowSeconds, 'windowSeconds');

  function decide(input = {}) {
    const options = input && typeof input === 'object' ? input : {};
    const eventId = requireEventId(options.eventId);
    if (options.timestamp == null) throw new Error('timestamp is required');
    const timestampMs = normalizeTimestampMs(options.timestamp, 'timestamp');
    const nowMs = options.nowMs == null ? Date.now() : normalizeTimestampMs(options.nowMs, 'nowMs');
    const ageSeconds = Math.abs(nowMs - timestampMs) / 1000;
    const fresh = ageSeconds <= window;
    const duplicate = fresh ? dedupeStore.seen(eventId) : false;
    if (!fresh) return Object.freeze({ accepted: false, reason: 'timestamp_outside_window', fresh, duplicate, ageSeconds });
    if (duplicate) return Object.freeze({ accepted: false, reason: 'duplicate_event', fresh, duplicate, ageSeconds });
    dedupeStore.record(eventId, { tenantId: options.tenantId ?? null, receivedAt: nowMs });
    return Object.freeze({ accepted: true, reason: 'accepted', fresh, duplicate, ageSeconds });
  }

  return Object.freeze({ decide });
}
