const EVENT_TYPES = Object.freeze(['impression', 'click', 'cart', 'order', 'conversion']);
const ATTRIBUTION_MODELS = Object.freeze(['last_touch', 'first_touch', 'linear']);
const ANOMALY_METRICS = Object.freeze(['commission_total', 'order_count', 'click_count']);
const ANOMALY_COMPARATORS = Object.freeze(['>', '<']);
const PERFORMANCE_DIMENSIONS = Object.freeze({ campaign: 'campaignId', creative: 'creativeId', product: 'productId' });
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const FUTURE_TOLERANCE_MS = 60000;
const FUNNEL_STAGES = Object.freeze(['impression', 'click', 'cart', 'order', 'conversion']);
const FUNNEL_CSV_COLUMNS = Object.freeze(['date', ...FUNNEL_STAGES]);
const PERFORMANCE_CSV_COLUMNS = Object.freeze(['dimension', 'dimensionValue', 'impressions', 'clicks', 'orders', 'revenueMinorUnits', 'commissionMinorUnits']);
const TYPE_REQUIRED_FIELDS = Object.freeze({
  impression: Object.freeze([]),
  click: Object.freeze(['linkId']),
  cart: Object.freeze(['clickId']),
  order: Object.freeze(['cartId', 'revenueMinorUnits', 'currency']),
  conversion: Object.freeze(['orderId', 'commissionMinorUnits'])
});
const TYPE_OPTIONAL_FIELDS = Object.freeze({
  impression: Object.freeze(['linkId', 'campaignId', 'creativeId', 'productId']),
  click: Object.freeze(['linkId', 'impressionId', 'campaignId', 'creativeId', 'productId']),
  cart: Object.freeze(['campaignId', 'creativeId', 'productId']),
  order: Object.freeze(['campaignId', 'creativeId', 'productId']),
  conversion: Object.freeze(['campaignId', 'creativeId', 'productId'])
});

function compareValues(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function text(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function optionalId(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} must be a non-empty identifier`);
  return normalized;
}

function timestampMs(value, name) {
  if (value == null) throw new Error(`${name} is required`);
  let ms;
  if (value instanceof Date) ms = value.getTime();
  else if (typeof value === 'number') ms = value;
  else if (typeof value === 'string') ms = new Date(value.trim()).getTime();
  else throw new Error(`${name} must be a valid timestamp`);
  if (!Number.isFinite(ms)) throw new Error(`${name} must be a valid timestamp`);
  return ms;
}

function minorUnits(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer amount in minor units`);
  }
  return value;
}

function currencyCode(value, name) {
  const normalized = String(value ?? '').trim();
  if (!CURRENCY_PATTERN.test(normalized)) throw new Error(`${name} must be a 3-letter uppercase ISO currency code`);
  return normalized;
}

function rangeBounds(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new TypeError('params must be an object');
  const from = timestampMs(params.from, 'from');
  const to = timestampMs(params.to, 'to');
  if (from > to) throw new Error('from must not be after to');
  return { from, to };
}

function utcDateKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function csvField(value) {
  const raw = String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function createAnalyticsRuntime({ clock = () => Date.now(), lateArrivalWindowMs = 86400000 } = {}) {
  if (typeof clock !== 'function') throw new Error('clock must be a function');
  if (!Number.isSafeInteger(lateArrivalWindowMs) || lateArrivalWindowMs < 0) {
    throw new Error('lateArrivalWindowMs must be a non-negative integer of milliseconds');
  }

  const partitions = new Map();
  const anomalyRules = new Map();

  function partition(tenantId) {
    const id = text(tenantId, 'tenantId');
    let scope = partitions.get(id);
    if (!scope) {
      scope = { events: new Map() };
      partitions.set(id, scope);
    }
    return scope;
  }

  function inWindow(event, from, to) {
    const ms = Date.parse(event.occurredAt);
    return ms >= from && ms <= to;
  }

  function lookupEvent(scope, tenantId, key) {
    const local = scope.events.get(key);
    if (local) return local;
    for (const other of partitions.values()) {
      if (other !== scope && other.events.has(key)) throw new Error('cross_tenant_access');
    }
    throw new Error(`event ${key} not found`);
  }

  function ingestEvent(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('event input must be an object');
    const tenantId = text(input.tenantId, 'tenantId');
    const type = text(input.type, 'type').toLowerCase();
    if (!EVENT_TYPES.includes(type)) throw new Error(`unsupported analytics event type: ${type}`);
    const eventId = text(input.eventId, 'eventId');
    const scope = partition(tenantId);
    if (scope.events.has(eventId)) return Object.freeze({ duplicate: true });
    const occurredMs = timestampMs(input.occurredAt, 'occurredAt');
    const now = clock();
    if (now - occurredMs > lateArrivalWindowMs) throw new Error('event_too_late');
    if (occurredMs - now > FUTURE_TOLERANCE_MS) throw new Error('event_in_future');
    for (const field of TYPE_REQUIRED_FIELDS[type]) {
      if (input[field] == null) throw new Error(`${field} is required for ${type} events`);
    }
    const record = {
      tenantId,
      eventId,
      type,
      occurredAt: new Date(occurredMs).toISOString(),
      receivedAt: new Date(now).toISOString()
    };
    for (const field of TYPE_OPTIONAL_FIELDS[type]) {
      if (input[field] == null) continue;
      record[field] = optionalId(input[field], field);
    }
    for (const field of TYPE_REQUIRED_FIELDS[type]) {
      if (field === 'revenueMinorUnits') record[field] = minorUnits(input[field], field);
      else if (field === 'commissionMinorUnits') record[field] = minorUnits(input[field], field);
      else if (field === 'currency') record[field] = currencyCode(input[field], field);
      else record[field] = optionalId(input[field], field);
    }
    const frozen = Object.freeze(record);
    scope.events.set(eventId, frozen);
    return frozen;
  }

  function resolveConversion(scope, tenantId, reference) {
    const ref = lookupEvent(scope, tenantId, text(reference, 'conversionEventIdOrOrderId'));
    if (ref.type === 'conversion') return ref;
    if (ref.type === 'order') {
      for (const event of scope.events.values()) {
        if (event.type === 'conversion' && event.orderId === ref.eventId) return event;
      }
      throw new Error(`conversion for order ${ref.eventId} not found`);
    }
    throw new Error('reference must be a conversion or order event');
  }

  function chainEvent(scope, key, label) {
    const event = scope.events.get(key);
    if (!event) throw new Error(`attribution_chain_broken:${label}`);
    return event;
  }

  function touchpointsForConversion(scope, conversion) {
    const order = chainEvent(scope, conversion.orderId, 'order');
    const cart = chainEvent(scope, order.cartId, 'cart');
    const click = chainEvent(scope, cart.clickId, 'click');
    const impression = click.impressionId ? chainEvent(scope, click.impressionId, 'impression') : null;
    const touches = [impression, click, cart].filter(Boolean);
    touches.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || compareValues(a.eventId, b.eventId));
    return touches;
  }

  function attribute(tenantId, conversionEventIdOrOrderId, options = {}) {
    const id = text(tenantId, 'tenantId');
    const opts = options == null ? {} : options;
    if (typeof opts !== 'object' || Array.isArray(opts)) throw new TypeError('options must be an object');
    const model = opts.model == null ? 'last_touch' : opts.model;
    if (!ATTRIBUTION_MODELS.includes(model)) throw new Error(`unsupported attribution model: ${model}`);
    const scope = partition(id);
    const conversion = resolveConversion(scope, id, conversionEventIdOrOrderId);
    const touches = touchpointsForConversion(scope, conversion);
    const total = conversion.commissionMinorUnits;
    const rowFor = (touch, share, credit) => Object.freeze({
      touchpointType: touch.type,
      eventId: touch.eventId,
      linkId: touch.linkId ?? null,
      share,
      creditMinorUnits: credit
    });
    let rows;
    if (model === 'last_touch') {
      const click = touches.find((touch) => touch.type === 'click');
      rows = [rowFor(click, 1, total)];
    } else if (model === 'first_touch') {
      rows = [rowFor(touches[0], 1, total)];
    } else {
      const count = touches.length;
      const base = Math.floor(total / count);
      const remainder = total % count;
      rows = touches.map((touch, index) => rowFor(touch, 1 / count, base + (index < remainder ? 1 : 0)));
    }
    return Object.freeze(rows);
  }

  function funnel(tenantId, params) {
    const id = text(tenantId, 'tenantId');
    const { from, to } = rangeBounds(params);
    const scope = partition(id);
    const counts = { impression: 0, click: 0, cart: 0, order: 0, conversion: 0 };
    for (const event of scope.events.values()) {
      if (inWindow(event, from, to)) counts[event.type] += 1;
    }
    const dropOff = (current, next) => (current === 0 ? 0 : 1 - next / current);
    return Object.freeze({
      impression: counts.impression,
      click: counts.click,
      cart: counts.cart,
      order: counts.order,
      conversion: counts.conversion,
      dropOffRates: Object.freeze({
        impressionToClick: dropOff(counts.impression, counts.click),
        clickToCart: dropOff(counts.click, counts.cart),
        cartToOrder: dropOff(counts.cart, counts.order),
        orderToConversion: dropOff(counts.order, counts.conversion)
      })
    });
  }

  function performanceByDimension(tenantId, dimension, params) {
    const id = text(tenantId, 'tenantId');
    if (!Object.hasOwn(PERFORMANCE_DIMENSIONS, dimension)) throw new Error(`unsupported performance dimension: ${dimension}`);
    const field = PERFORMANCE_DIMENSIONS[dimension];
    const { from, to } = rangeBounds(params);
    const scope = partition(id);
    const buckets = new Map();
    for (const event of scope.events.values()) {
      const value = event[field];
      if (value == null || !inWindow(event, from, to)) continue;
      let bucket = buckets.get(value);
      if (!bucket) {
        bucket = { impressions: 0, clicks: 0, orders: 0, revenueMinorUnits: 0, commissionMinorUnits: 0 };
        buckets.set(value, bucket);
      }
      if (event.type === 'impression') bucket.impressions += 1;
      else if (event.type === 'click') bucket.clicks += 1;
      else if (event.type === 'order') {
        bucket.orders += 1;
        bucket.revenueMinorUnits += event.revenueMinorUnits;
      } else if (event.type === 'conversion') {
        bucket.commissionMinorUnits += event.commissionMinorUnits;
      }
    }
    const output = {};
    for (const value of [...buckets.keys()].sort(compareValues)) {
      output[value] = Object.freeze(buckets.get(value));
    }
    return Object.freeze(output);
  }

  function cohortFunnel(tenantId, params) {
    const id = text(tenantId, 'tenantId');
    const { from, to } = rangeBounds(params);
    const scope = partition(id);
    const buckets = new Map();
    for (const event of scope.events.values()) {
      if (!inWindow(event, from, to)) continue;
      const key = utcDateKey(Date.parse(event.occurredAt));
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { date: key, impression: 0, click: 0, cart: 0, order: 0, conversion: 0 };
        buckets.set(key, bucket);
      }
      bucket[event.type] += 1;
    }
    const rows = [];
    for (const key of [...buckets.keys()].sort(compareValues)) {
      rows.push(Object.freeze(buckets.get(key)));
    }
    return Object.freeze(rows);
  }

  function registerAnomalyRule(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('rule input must be an object');
    const ruleId = text(input.ruleId, 'ruleId');
    if (anomalyRules.has(ruleId)) throw new Error(`anomaly rule ${ruleId} already exists`);
    if (!ANOMALY_METRICS.includes(input.metric)) throw new Error(`unsupported anomaly metric: ${input.metric}`);
    if (!ANOMALY_COMPARATORS.includes(input.comparator)) throw new Error(`unsupported anomaly comparator: ${input.comparator}`);
    const threshold = Number(input.threshold);
    if (!Number.isFinite(threshold)) throw new Error('threshold must be a finite number');
    const rule = Object.freeze({ ruleId, metric: input.metric, comparator: input.comparator, threshold });
    anomalyRules.set(ruleId, rule);
    return rule;
  }

  function evaluateAnomalies(tenantId, params) {
    const id = text(tenantId, 'tenantId');
    const { from, to } = rangeBounds(params);
    const scope = partition(id);
    const actuals = { commission_total: 0, order_count: 0, click_count: 0 };
    for (const event of scope.events.values()) {
      if (!inWindow(event, from, to)) continue;
      if (event.type === 'conversion') actuals.commission_total += event.commissionMinorUnits;
      else if (event.type === 'order') actuals.order_count += 1;
      else if (event.type === 'click') actuals.click_count += 1;
    }
    const triggered = [];
    for (const rule of anomalyRules.values()) {
      const actual = actuals[rule.metric];
      const hit = rule.comparator === '>' ? actual > rule.threshold : actual < rule.threshold;
      if (hit) triggered.push(Object.freeze({ ruleId: rule.ruleId, metric: rule.metric, actual, threshold: rule.threshold }));
    }
    triggered.sort((a, b) => compareValues(a.ruleId, b.ruleId));
    return Object.freeze(triggered);
  }

  function performanceRows(id, dimension, params) {
    const snapshot = performanceByDimension(id, dimension, params);
    const rows = [];
    for (const value of Object.keys(snapshot)) {
      const stats = snapshot[value];
      rows.push(Object.freeze({
        dimension,
        dimensionValue: value,
        impressions: stats.impressions,
        clicks: stats.clicks,
        orders: stats.orders,
        revenueMinorUnits: stats.revenueMinorUnits,
        commissionMinorUnits: stats.commissionMinorUnits
      }));
    }
    return rows;
  }

  function exportData(tenantId, options) {
    const id = text(tenantId, 'tenantId');
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('options must be an object');
    const format = options.format;
    if (format !== 'json' && format !== 'csv') throw new Error(`unsupported export format: ${format}`);
    const dataset = options.dataset;
    if (dataset !== 'funnel' && dataset !== 'performance') throw new Error(`unsupported export dataset: ${dataset}`);
    let dimension = null;
    if (options.dimension != null) {
      if (!Object.hasOwn(PERFORMANCE_DIMENSIONS, options.dimension)) throw new Error(`unsupported performance dimension: ${options.dimension}`);
      dimension = options.dimension;
    }
    if (dataset === 'performance' && dimension == null) throw new Error('dimension is required for performance exports');
    let rows;
    if (dataset === 'funnel') {
      rows = cohortFunnel(id, options.params);
    } else {
      rows = performanceRows(id, dimension, options.params);
    }
    if (format === 'json') return JSON.stringify(rows);
    const columns = dataset === 'funnel' ? FUNNEL_CSV_COLUMNS : PERFORMANCE_CSV_COLUMNS;
    const lines = [columns.join(',')];
    for (const row of rows) {
      lines.push(columns.map((column) => csvField(row[column])).join(','));
    }
    return lines.join('\n');
  }

  function reconcileCommissions(tenantId, params) {
    const id = text(tenantId, 'tenantId');
    const { from, to } = rangeBounds(params);
    const scope = partition(id);
    let recordedTotalMinorUnits = 0;
    let attributedTotalMinorUnits = 0;
    for (const event of scope.events.values()) {
      if (event.type !== 'conversion' || !inWindow(event, from, to)) continue;
      recordedTotalMinorUnits += event.commissionMinorUnits;
      try {
        const rows = attribute(id, event.eventId, { model: 'last_touch' });
        for (const row of rows) attributedTotalMinorUnits += row.creditMinorUnits;
      } catch (error) {
        if (!String(error.message).startsWith('attribution_chain_broken')) throw error;
      }
    }
    const deltaMinorUnits = attributedTotalMinorUnits - recordedTotalMinorUnits;
    return Object.freeze({
      balanced: deltaMinorUnits === 0,
      attributedTotalMinorUnits,
      recordedTotalMinorUnits,
      deltaMinorUnits
    });
  }

  function __testScope(tenantId) {
    return partition(tenantId);
  }

  return Object.freeze({
    ingestEvent,
    attribute,
    funnel,
    performanceByDimension,
    cohortFunnel,
    registerAnomalyRule,
    evaluateAnomalies,
    exportData,
    reconcileCommissions,
    __testScope
  });
}
