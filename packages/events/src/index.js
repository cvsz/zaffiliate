const DEFAULT_MAX_ATTEMPTS = 3;

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

export function createDomainEventBus({ maxAttempts = DEFAULT_MAX_ATTEMPTS, clock = () => new Date().toISOString() } = {}) {
  const attemptsLimit = Number(maxAttempts);
  if (!Number.isInteger(attemptsLimit) || attemptsLimit < 1) throw new Error('maxAttempts must be a positive integer');
  const subscribers = new Map();
  const deadLetters = [];

  function subscribe(tenantId, type, handler, { deadLetterHandler = null } = {}) {
    const normalizedTenant = requireText(tenantId, 'tenantId');
    const normalizedType = requireText(type, 'type');
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    const key = `${normalizedTenant}\u0000${normalizedType}`;
    const list = subscribers.get(key) ?? [];
    list.push({ handler, deadLetterHandler });
    subscribers.set(key, list);
    return () => {
      const current = subscribers.get(key) ?? [];
      const index = current.findIndex((entry) => entry.handler === handler);
      if (index >= 0) current.splice(index, 1);
    };
  }

  function publish(tenantId, event) {
    const id = requireText(tenantId, 'tenantId');
    const type = requireText(event?.type, 'event.type');
    const envelope = Object.freeze({
      eventId: `evt_${randomEventId()}`,
      tenantId: id,
      type,
      payload: Object.freeze(JSON.parse(JSON.stringify(event.payload ?? {}))),
      occurredAt: clock()
    });
    for (const entry of subscribers.get(`${id}\u0000${type}`) ?? []) {
      let delivered = false;
      let lastError = null;
      for (let attempt = 1; attempt <= attemptsLimit && !delivered; attempt += 1) {
        try {
          entry.handler(envelope);
          delivered = true;
        } catch (error) {
          lastError = error;
        }
      }
      if (!delivered && entry.deadLetterHandler) {
        try {
          entry.deadLetterHandler(envelope, lastError ?? new Error('handler exhausted retries'));
        } catch {
          void 0;
        }
      }
    }
    return Object.freeze({ eventId: envelope.eventId, type });
  }

  function deadLetterCount() {
    return deadLetters.length;
  }

  return Object.freeze({ subscribe, publish, deadLetterCount, _deadLetters: deadLetters });
}

function randomEventId() {
  return Math.random().toString(16).slice(2, 14);
}
