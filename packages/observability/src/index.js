import { randomUUID } from 'node:crypto';
import { createRedactor } from '../../security/src/redaction.js';

const LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);
const MAX_BUFFERED_LINES = 1000;
const SPAN_DURATION_METRIC = 'span.duration_ms';
const INCOMING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const SLO_WINDOW_PATTERN = /^\d+[hdwm]$/;

function newTraceId() {
  return randomUUID().replace(/-/g, '');
}

function newSpanId() {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

function roundTo6(value) {
  return Math.round(value * 1e6) / 1e6;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

export function readHeader(headers, name) {
  if (headers == null) return null;
  if (typeof headers !== 'object') return null;
  if (typeof headers.get === 'function') {
    const value = headers.get(name.toLowerCase());
    return typeof value === 'string' ? value : null;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase() && typeof value === 'string') return value;
  }
  return null;
}

function sanitizeIncomingId(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return INCOMING_ID_PATTERN.test(trimmed) ? trimmed : null;
}

export function createCorrelation({ headers = null } = {}) {
  if (headers != null && typeof headers !== 'object') throw new TypeError('headers must be an object or Headers-like');
  const incomingTraceId = sanitizeIncomingId(readHeader(headers, 'x-trace-id'));
  const incomingRequestId = sanitizeIncomingId(readHeader(headers, 'x-request-id'));
  return Object.freeze({
    traceId: incomingTraceId || newTraceId(),
    requestId: incomingRequestId || `req_${newTraceId()}`,
    spanId: newSpanId()
  });
}

export function defineSlo({ name, sli, target, window } = {}) {
  if (typeof name !== 'string' || !name.trim()) throw new TypeError('slo name must be a non-empty string');
  if (typeof sli !== 'string' || !sli.trim()) throw new TypeError('sli must be a non-empty string');
  if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0 || target > 1) throw new TypeError('target must be a number within (0, 1]');
  if (typeof window !== 'string' || !SLO_WINDOW_PATTERN.test(window)) throw new TypeError('window must look like 30d, 12h or 1w');
  return Object.freeze({ name, sli, target, window });
}

export function evaluateSlo(slo, goodEvents, totalEvents) {
  if (!slo || typeof slo !== 'object' || typeof slo.target !== 'number') throw new TypeError('a defined slo is required');
  if (!Number.isInteger(goodEvents) || goodEvents < 0) throw new TypeError('goodEvents must be a non-negative integer');
  if (!Number.isInteger(totalEvents) || totalEvents <= 0) throw new TypeError('totalEvents must be a positive integer');
  if (goodEvents > totalEvents) throw new Error('goodEvents cannot exceed totalEvents');
  const ratio = goodEvents / totalEvents;
  return Object.freeze({
    met: ratio >= slo.target,
    ratio: roundTo6(ratio),
    errorBudgetRemaining: Math.max(0, roundTo6(ratio - slo.target))
  });
}

export function createObservability({ serviceName = 'zaffiliate', now = null } = {}) {
  if (typeof serviceName !== 'string' || !serviceName.trim()) throw new TypeError('serviceName must be a non-empty string');
  const timestamp = typeof now === 'function' ? now : () => new Date().toISOString();
  const redactor = createRedactor({ now: timestamp });
  const store = new Map();
  const lines = [];

  function sortedLabels(labels) {
    if (labels == null) return {};
    if (typeof labels !== 'object' || Array.isArray(labels)) throw new TypeError('labels must be a plain object');
    const out = {};
    for (const key of Object.keys(labels).sort()) {
      const value = labels[key];
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new TypeError('label values must be string, number or boolean');
      out[key] = value;
    }
    return out;
  }

  function metricEntry(type, name, labels) {
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('metric name must be a non-empty string');
    const sorted = sortedLabels(labels);
    const key = `${name}|${Object.entries(sorted).map(([k, v]) => `${k}=${String(v).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}`).join(',')}`;
    let entry = store.get(key);
    if (!entry) {
      entry = { type, name, labels: sorted, count: 0, sum: 0, min: Infinity, max: -Infinity, value: 0 };
      store.set(key, entry);
    } else if (entry.type !== type) {
      throw new TypeError(`metric ${name} is already recorded as ${entry.type}`);
    }
    return entry;
  }

  function incrementCounter(name, labels = null) {
    const entry = metricEntry('counter', name, labels);
    entry.count += 1;
  }

  function observeHistogram(name, value, labels = null) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('histogram value must be a finite number');
    const entry = metricEntry('histogram', name, labels);
    entry.count += 1;
    entry.sum += value;
    entry.min = Math.min(entry.min, value);
    entry.max = Math.max(entry.max, value);
  }

  function setGauge(name, value, labels = null) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('gauge value must be a finite number');
    const entry = metricEntry('gauge', name, labels);
    entry.value = value;
    entry.count += 1;
  }

  function snapshot() {
    const rows = [];
    for (const entry of store.values()) {
      const labels = Object.freeze({ ...entry.labels });
      if (entry.type === 'counter') rows.push(Object.freeze({ type: entry.type, name: entry.name, labels, count: entry.count }));
      else if (entry.type === 'gauge') rows.push(Object.freeze({ type: entry.type, name: entry.name, labels, value: entry.value }));
      else rows.push(Object.freeze({ type: entry.type, name: entry.name, labels, count: entry.count, sum: entry.sum, min: entry.min, max: entry.max }));
    }
    rows.sort((a, b) => {
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      const aLabels = JSON.stringify(a.labels);
      const bLabels = JSON.stringify(b.labels);
      if (aLabels !== bLabels) return aLabels < bLabels ? -1 : 1;
      return 0;
    });
    return Object.freeze(rows);
  }

  let current = null;

  function startSpan(name, options = {}) {
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('span name must be a non-empty string');
    if (options == null || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('span options must be an object');
    const parent = current;
    const spanId = newSpanId();
    const traceId = options.traceId != null ? String(options.traceId) : parent ? parent.traceId : newTraceId();
    const parentSpanId = options.parentSpanId != null ? String(options.parentSpanId) : parent ? parent.spanId : null;
    const tenantId = options.tenantId != null ? String(options.tenantId) : parent && parent.tenantId != null ? parent.tenantId : null;
    const startedAt = performance.now();
    let ended = false;
    let durationMs = null;
    const span = {
      name,
      spanId,
      traceId,
      parentSpanId,
      tenantId,
      get ended() {
        return ended;
      },
      get durationMs() {
        return durationMs;
      },
      end() {
        if (ended) {
          const error = new Error('span already ended');
          error.code = 'SPAN_ALREADY_ENDED';
          throw error;
        }
        ended = true;
        durationMs = roundTo6(performance.now() - startedAt);
        observeHistogram(SPAN_DURATION_METRIC, durationMs, tenantId ? { name, tenantId } : { name });
        if (current === spanRef) current = parent;
        return Object.freeze({ name, spanId, traceId, parentSpanId, durationMs });
      }
    };
    const spanRef = Object.freeze(span);
    current = spanRef;
    return spanRef;
  }

  function log(level, msg, fields = null) {
    if (!LOG_LEVELS.includes(level)) throw new TypeError(`unsupported log level: ${level}`);
    const line = redactor.redactLogLine(level, msg, fields);
    const enriched = deepFreeze({ service: serviceName, ...line });
    lines.push(enriched);
    if (lines.length > MAX_BUFFERED_LINES) lines.shift();
    return enriched;
  }

  function logs() {
    return Object.freeze([...lines]);
  }

  return Object.freeze({
    serviceName,
    log,
    logs,
    metrics: Object.freeze({ incrementCounter, observeHistogram, setGauge, snapshot }),
    startSpan,
    createCorrelation: (input = {}) => createCorrelation(input),
    defineSlo
  });
}

const secretKeyPattern = /(secret|token|password|authorization|cookie|api[_-]?key|private[_-]?key)/i;

export function redact(value, key = '') {
  if (secretKeyPattern.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  return value;
}

export function createLogRecord(level, event, fields = {}, now = new Date()) {
  return Object.freeze({
    timestamp: now.toISOString(),
    level: String(level || 'info').toLowerCase(),
    event: String(event || 'event'),
    ...redact(fields)
  });
}

export function createLogger(write = (record) => console.log(JSON.stringify(record))) {
  const obs = createObservability({ serviceName: 'zaffiliate' });
  return Object.freeze({
    info(event, fields) { write(obs.log('info', event, fields)); },
    warn(event, fields) { write(obs.log('warn', event, fields)); },
    error(event, fields) { write(obs.log('error', event, fields)); }
  });
}

export function traceContext(headers = {}) {
  const requestId = String(headers['x-request-id'] || headers['X-Request-Id'] || randomUUID()).slice(0, 128);
  const traceId = String(headers['x-trace-id'] || headers['X-Trace-Id'] || randomUUID().replaceAll('-', '')).slice(0, 128);
  return Object.freeze({ requestId, traceId });
}

export class MetricsRegistry {
  #obs;
  #legacyStore = new Map();

  constructor(serviceName = 'zaffiliate') {
    this.#obs = createObservability({ serviceName });
  }

  inc(name, labels = {}, amount = 1) {
    const key = `${name}|${Object.entries(labels).sort().map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`).join(',')}`;
    const entry = this.#legacyStore.get(key) || { type: 'counter', name, labels: Object.fromEntries(Object.entries(labels).sort()), count: 0 };
    entry.count += Number(amount);
    this.#legacyStore.set(key, entry);
    this.#obs.metrics.incrementCounter(name, Object.fromEntries(Object.entries(labels).sort()));
  }

  set(name, labels = {}, value = 0) {
    const key = `${name}|${Object.entries(labels).sort().map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`).join(',')}`;
    const entry = this.#legacyStore.get(key) || { type: 'gauge', name, labels: Object.fromEntries(Object.entries(labels).sort()), value: 0 };
    entry.value = Number(value);
    this.#legacyStore.set(key, entry);
    this.#obs.metrics.setGauge(name, Number(value), Object.fromEntries(Object.entries(labels).sort()));
  }

  render() {
    const rows = [];
    for (const entry of this.#legacyStore.values()) {
      const labels = Object.entries(entry.labels).map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`).join(',');
      if (entry.type === 'counter') rows.push(`${entry.name}{${labels}} ${entry.count}`);
      else if (entry.type === 'gauge') rows.push(`${entry.name}{${labels}} ${entry.value}`);
    }
    return rows.join('\n') + (rows.length ? '\n' : '');
  }
}
