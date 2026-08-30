const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_DEAD_LETTER_CAPACITY = 1000;

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

export function createDomainEventBus({
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  deadLetterCapacity = DEFAULT_DEAD_LETTER_CAPACITY,
  clock = () => new Date().toISOString()
} = {}) {
  const attemptsLimit = Number(maxAttempts);
  const capacity = Number(deadLetterCapacity);
  if (!Number.isInteger(attemptsLimit) || attemptsLimit < 1) throw new Error('maxAttempts must be a positive integer');
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('deadLetterCapacity must be a positive integer');

  const subscribers = new Map();
  const deadLetters = [];

  function subscribe(tenantId, type, handler, { deadLetterHandler = null } = {}) {
    const normalizedTenant = requireText(tenantId, 'tenantId');
    const normalizedType = requireText(type, 'type');
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    if (deadLetterHandler !== null && typeof deadLetterHandler !== 'function') {
      throw new TypeError('deadLetterHandler must be a function');
    }
    const key = `${normalizedTenant}\u0000${normalizedType}`;
    const list = subscribers.get(key) ?? [];
    const entry = { handler, deadLetterHandler };
    list.push(entry);
    subscribers.set(key, list);
    return () => {
      const current = subscribers.get(key) ?? [];
      const index = current.indexOf(entry);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) subscribers.delete(key);
    };
  }

  function recordDeadLetter(envelope, error, attempts) {
    const entry = Object.freeze({
      envelope,
      attempts,
      failedAt: clock(),
      error: error instanceof Error ? error.message : String(error)
    });
    if (deadLetters.length >= capacity) deadLetters.shift();
    deadLetters.push(entry);
    return entry;
  }

  function publish(tenantId, event) {
    const id = requireText(tenantId, 'tenantId');
    const type = requireText(event?.type, 'event.type');
    const envelope = Object.freeze({
      eventId: requireText(event?.eventId ?? `evt_${randomEventId()}`, 'event.eventId'),
      tenantId: id,
      type,
      payload: Object.freeze(clone(event.payload)),
      occurredAt: String(event?.occurredAt ?? clock())
    });

    for (const entry of subscribers.get(`${id}\u0000${type}`) ?? []) {
      let delivered = false;
      let lastError = null;
      let attempts = 0;
      for (let attempt = 1; attempt <= attemptsLimit && !delivered; attempt += 1) {
        attempts = attempt;
        try {
          entry.handler(envelope);
          delivered = true;
        } catch (error) {
          lastError = error;
        }
      }
      if (!delivered) {
        const deadLetter = recordDeadLetter(envelope, lastError ?? new Error('handler exhausted retries'), attempts);
        if (entry.deadLetterHandler) {
          try {
            entry.deadLetterHandler(envelope, lastError ?? new Error('handler exhausted retries'), deadLetter);
          } catch {
            // Dead-letter observers must not make publication fail after the message is quarantined.
          }
        }
      }
    }
    return Object.freeze({ eventId: envelope.eventId, type });
  }

  function deadLetterCount() {
    return deadLetters.length;
  }

  function getDeadLetters() {
    return Object.freeze([...deadLetters]);
  }

  return Object.freeze({ subscribe, publish, deadLetterCount, getDeadLetters, _deadLetters: deadLetters });
}

function randomEventId() {
  return Math.random().toString(16).slice(2, 14);
}
