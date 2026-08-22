import { randomUUID } from 'node:crypto';

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
  return Object.freeze({
    info(event, fields) { write(createLogRecord('info', event, fields)); },
    warn(event, fields) { write(createLogRecord('warn', event, fields)); },
    error(event, fields) { write(createLogRecord('error', event, fields)); }
  });
}

export function traceContext(headers = {}) {
  const requestId = String(headers['x-request-id'] || headers['X-Request-Id'] || randomUUID()).slice(0, 128);
  const traceId = String(headers['x-trace-id'] || headers['X-Trace-Id'] || randomUUID().replaceAll('-', '')).slice(0, 128);
  return Object.freeze({ requestId, traceId });
}

export class MetricsRegistry {
  #counters = new Map();
  #gauges = new Map();

  inc(name, labels = {}, amount = 1) {
    const key = metricKey(name, labels);
    this.#counters.set(key, (this.#counters.get(key) || 0) + Number(amount));
  }

  set(name, labels = {}, value = 0) {
    this.#gauges.set(metricKey(name, labels), Number(value));
  }

  render() {
    const rows = [];
    for (const [key, value] of [...this.#counters.entries(), ...this.#gauges.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      rows.push(`${key} ${Number.isFinite(value) ? value : 0}`);
    }
    return `${rows.join('\n')}${rows.length ? '\n' : ''}`;
  }
}

function metricKey(name, labels) {
  const metric = String(name).replace(/[^a-zA-Z0-9_:]/g, '_');
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return metric;
  const serialized = entries.map(([key, value]) => `${key}="${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`).join(',');
  return `${metric}{${serialized}}`;
}
