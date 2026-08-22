function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function createAnalyticsEvent({ tenantId, eventId, type, occurredAt, receivedAt = new Date().toISOString(), dimensions = {}, measures = {} }) {
  const supported = ['impression','click','cart','order','conversion','commission'];
  const normalizedType = required(type, 'type').toLowerCase();
  if (!supported.includes(normalizedType)) throw new Error('unsupported analytics event type');
  const occurred = new Date(required(occurredAt, 'occurredAt'));
  const received = new Date(receivedAt);
  if (Number.isNaN(occurred.getTime()) || Number.isNaN(received.getTime())) throw new Error('invalid event timestamp');
  const normalizedMeasures = {};
  for (const [key, value] of Object.entries(measures)) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`invalid measure: ${key}`);
    normalizedMeasures[key] = n;
  }
  return Object.freeze({
    tenantId: required(tenantId, 'tenantId'),
    eventId: required(eventId, 'eventId'),
    type: normalizedType,
    occurredAt: occurred.toISOString(),
    receivedAt: received.toISOString(),
    lateArrivalMs: Math.max(0, received.getTime() - occurred.getTime()),
    dimensions: Object.freeze({ ...dimensions }),
    measures: Object.freeze(normalizedMeasures)
  });
}

export function dedupeAnalyticsEvents(events) {
  const seen = new Set();
  const output = [];
  for (const event of events) {
    const key = `${event.tenantId}:${event.eventId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(event);
  }
  return Object.freeze(output);
}

export function attributeConversion({ touchpoints, conversionOccurredAt, model = 'last_touch' }) {
  const cutoff = new Date(conversionOccurredAt).getTime();
  const eligible = [...touchpoints]
    .filter((touch) => new Date(touch.occurredAt).getTime() <= cutoff)
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  if (!eligible.length) return Object.freeze([]);
  if (model === 'last_touch') return Object.freeze([{ touchpointId: eligible.at(-1).touchpointId, weight: 1 }]);
  if (model === 'first_touch') return Object.freeze([{ touchpointId: eligible[0].touchpointId, weight: 1 }]);
  if (model === 'linear') {
    const weight = 1 / eligible.length;
    return Object.freeze(eligible.map((touch) => Object.freeze({ touchpointId: touch.touchpointId, weight })));
  }
  throw new Error('unsupported attribution model');
}

export function reconcileCommission({ expectedCommission, reportedCommission, tolerance = 0.01 }) {
  const expected = Number(expectedCommission);
  const reported = Number(reportedCommission);
  if (!Number.isFinite(expected) || !Number.isFinite(reported)) throw new Error('commission values must be numeric');
  const delta = reported - expected;
  return Object.freeze({ expected, reported, delta, reconciled: Math.abs(delta) <= tolerance });
}

export function summarizeFunnel(events) {
  const counts = { impression: 0, click: 0, cart: 0, order: 0, conversion: 0 };
  for (const event of events) if (Object.hasOwn(counts, event.type)) counts[event.type] += 1;
  return Object.freeze({
    ...counts,
    clickThroughRate: counts.impression ? counts.click / counts.impression : 0,
    conversionRate: counts.click ? counts.conversion / counts.click : 0
  });
}
