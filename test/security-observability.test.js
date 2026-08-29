import test from 'node:test';

const AWS_EXAMPLE_KEY = 'AKIA' + 'IOSFODNN7EXAMPLE';
const PEM_PRIVATE = '-----BEGIN ' + 'PRIVATE KEY-----\nMIIEvQ==\n-----END PRIVATE KEY-----';
const RSA_PRIVATE = '-----BEGIN RSA ' + 'PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----';
import assert from 'node:assert/strict';
import { createSecretManager, createInMemorySecretBackend, resolveSecret, assertServerSideOnly } from '../packages/security/src/secrets.js';
import { createRedactor, redactLogLine } from '../packages/security/src/redaction.js';
import { SECRET_CLASSES, POLICY_RULES, classifySecretMaterial, classifyAndAssert } from '../packages/security/src/classification.js';
import { createObservability, createCorrelation, defineSlo, evaluateSlo } from '../packages/observability/src/index.js';

test('secret manager enforces ref: format fail-closed', () => {
  const backend = createInMemorySecretBackend();
  const manager = createSecretManager({ backend });
  assert.throws(() => createSecretManager({}), TypeError);
  assert.throws(() => manager.resolve('plain-secret-value'), (error) => error.code === 'SECRET_REF_REQUIRED');
  assert.throws(() => manager.put('plain-secret-value', 'value'), (error) => error.code === 'SECRET_REF_REQUIRED');
  assert.throws(() => manager.resolve('ref:../escape'), (error) => error.code === 'SECRET_REF_INVALID');
  assert.throws(() => manager.resolve('ref:double//slash'), (error) => error.code === 'SECRET_REF_INVALID');
  assert.throws(() => assertServerSideOnly(AWS_EXAMPLE_KEY), (error) => error.code === 'SERVER_SIDE_ONLY');
  assert.throws(() => assertServerSideOnly(42), (error) => error.code === 'SERVER_SIDE_ONLY');
  assert.equal(assertServerSideOnly('ref:webhooks/tiktok/verify_token', { surface: 'webhook-handler' }), true);

  const ref = 'ref:webhooks/tiktok/verify_token';
  const material = 'a'.repeat(40);
  const receipt = manager.put(ref, material);
  assert.equal(receipt.stored, true);
  const resolved = resolveSecret(manager, ref);
  assert.equal(resolved.ref, ref);
  assert.equal(resolved.value, material);
  assert.equal(resolved.classifiedAs.class, SECRET_CLASSES.WEBHOOK_VERIFY_TOKEN);
  assert.equal(resolved.classifiedAs.handling, 'secret-manager');
  assert.equal(Object.isFrozen(resolved), true);
  assert.throws(() => resolveSecret(manager, 'ref:missing/value'), (error) => error.code === 'SECRET_NOT_FOUND');
  const classified = manager.classify(ref);
  assert.equal(classified.class, SECRET_CLASSES.WEBHOOK_VERIFY_TOKEN);
  assert.equal(classified.severity, 'high');
});

test('redactor masks denylisted keys deeply and case-insensitively without mutating input', () => {
  const { redact } = createRedactor({ extraKeys: ['internalNote'] });
  const input = {
    password: 'hunter2',
    nested: {
      Authorization: 'Bearer abc.def',
      apiKey: 'key-123',
      deeper: [{ JWT_SECRET: 'jwt-value' }]
    },
    DATABASE_URL: 'postgres://u:p@h/db',
    internalNote: 'note',
    safe: 'keep me'
  };
  const out = redact(input);
  assert.equal(out.password, '[REDACTED]');
  assert.equal(out.nested.Authorization, '[REDACTED]');
  assert.equal(out.nested.apiKey, '[REDACTED]');
  assert.equal(out.nested.deeper[0].JWT_SECRET, '[REDACTED]');
  assert.equal(out.DATABASE_URL, '[REDACTED]');
  assert.equal(out.internalNote, '[REDACTED]');
  assert.equal(out.safe, 'keep me');
  assert.equal(input.password, 'hunter2');
  assert.equal(input.nested.apiKey, 'key-123');
  assert.equal(Object.isFrozen(out), true);
  assert.equal(Object.isFrozen(out.nested.deeper[0]), true);
  assert.throws(() => redact('not-an-object'), TypeError);
});

test('redactor scrubs secret-looking substrings in raw strings', () => {
  const { redact } = createRedactor();
  const out = redact({
    bearer: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc should fail closed',
    openai: 'key sk-proj-abcdef12345678901234 rotated',
    aws: `aws key ${AWS_EXAMPLE_KEY} inlined`,
    dsn: 'postgres://alice:s3cret@db.internal:5432/app',
    pem: PEM_PRIVATE
  });
  assert.doesNotMatch(out.bearer, /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/);
  assert.match(out.bearer, /Bearer \[REDACTED\] should fail closed/);
  assert.doesNotMatch(out.openai, /sk-proj-abcdef12345678901234/);
  assert.match(out.openai, /key \[REDACTED\] rotated/);
  assert.doesNotMatch(out.aws, new RegExp(AWS_EXAMPLE_KEY));
  assert.equal(out.dsn, 'postgres://alice:[REDACTED]@db.internal:5432/app');
  assert.equal(out.pem, '[REDACTED]');
});

test('redaction handles cycles and standalone redactLogLine is frozen', () => {
  const cyclic = { name: 'cycle', token: 'tok' };
  cyclic.self = cyclic;
  const out = createRedactor().redact(cyclic);
  assert.equal(out.name, 'cycle');
  assert.equal(out.token, '[REDACTED]');
  assert.equal(out.self, null);

  const line = redactLogLine('info', 'hello', { apiKey: 'sk-abcdef1234567890' });
  assert.ok(line.ts);
  assert.equal(line.level, 'info');
  assert.equal(line.msg, 'hello');
  assert.equal(line.apiKey, '[REDACTED]');
  assert.equal(Object.isFrozen(line), true);
  assert.throws(() => redactLogLine('info', ''), TypeError);
});

const CLASSIFICATION_MATRIX = [
  ['a'.repeat(40), ['github', 'webhook'], SECRET_CLASSES.WEBHOOK_VERIFY_TOKEN],
  [`whsec_${'k'.repeat(24)}`, [], SECRET_CLASSES.WEBHOOK_VERIFY_TOKEN],
  ['sk-prod-abcdefghijklmnopqrstuvwxyz123456', [], SECRET_CLASSES.API_TOKEN],
  [AWS_EXAMPLE_KEY, [], SECRET_CLASSES.API_TOKEN],
  [RSA_PRIVATE, [], SECRET_CLASSES.SIGNING_KEY],
  ['postgresql://bob:hunter2@db.prod:5432/shop', [], SECRET_CLASSES.DATABASE_URL],
  ['Zx9!vB2n#Qw7*Lp3', ['oauth client_secret'], SECRET_CLASSES.OAUTH_CLIENT_SECRET],
  ['c2Vzc2lvbi1zZWNyZXQtMTIzNDU2Nzg5MA==', ['session'], SECRET_CLASSES.SESSION_SECRET],
  ['hmac-signing-material-9876543210', ['jwt'], SECRET_CLASSES.SIGNING_KEY],
  ['totally-unknown-material', [], SECRET_CLASSES.GENERIC_CREDENTIAL]
];

test('classification matrix maps material to class severity and handling', () => {
  for (const [value, hints, expected] of CLASSIFICATION_MATRIX) {
    const result = classifyAndAssert(value, expected, hints);
    const rule = POLICY_RULES[result.class];
    assert.equal(result.severity, rule.severity);
    assert.equal(result.handling, rule.handling);
    assert.ok(['critical', 'high', 'medium'].includes(result.severity));
    assert.ok(['secret-manager', 'never-store', 'rotate'].includes(result.handling));
    assert.equal(Object.isFrozen(result), true);
  }
  const webhook = classifySecretMaterial('a'.repeat(40), 'github webhook secret');
  assert.deepEqual(webhook, { class: 'webhook_verify_token', severity: 'high', handling: 'secret-manager' });
  assert.deepEqual(classifySecretMaterial('sk-prod-abcdef123456'), { class: 'api_token', severity: 'critical', handling: 'never-store' });
  assert.deepEqual(classifySecretMaterial('totally-unknown-material'), { class: 'generic_credential', severity: 'medium', handling: 'rotate' });

  for (const klass of Object.values(SECRET_CLASSES)) {
    assert.ok(POLICY_RULES[klass]);
    assert.ok(typeof POLICY_RULES[klass].rule === 'string' && POLICY_RULES[klass].rule.length > 0);
  }
  assert.equal(Object.isFrozen(SECRET_CLASSES), true);
  assert.equal(Object.isFrozen(POLICY_RULES), true);
  assert.throws(() => classifyAndAssert('sk-prod-abcdef123456', SECRET_CLASSES.DATABASE_URL), (error) => error.code === 'CLASSIFICATION_MISMATCH');
  assert.throws(() => classifyAndAssert('value', 'not-a-class'), TypeError);
  assert.throws(() => classifySecretMaterial('', []), TypeError);
  assert.throws(() => classifySecretMaterial('value', 42), TypeError);
});

test('observability log lines pass through the redactor and never leak raw secrets', () => {
  const obs = createObservability({ serviceName: 'api', now: () => '2026-08-22T00:00:00.000Z' });
  assert.equal(obs.serviceName, 'api');
  const rawSecret = 'sk-live-abcdefghijklmnop1234';
  const line = obs.log('info', 'checkout completed', { apiKey: rawSecret, note: `fallback ${rawSecret}`, amount: 42 });
  assert.equal(line.ts, '2026-08-22T00:00:00.000Z');
  assert.equal(line.level, 'info');
  assert.equal(line.msg, 'checkout completed');
  assert.equal(line.service, 'api');
  assert.equal(line.amount, 42);
  assert.equal(line.apiKey, '[REDACTED]');
  const serialized = JSON.stringify(line);
  assert.ok(!serialized.includes(rawSecret));
  obs.log('warn', `inline ${rawSecret} leak attempt`);
  assert.ok(!JSON.stringify(obs.logs()).includes(rawSecret));
  assert.equal(Object.isFrozen(obs.logs()), true);
  assert.equal(Object.isFrozen(line), true);
  assert.throws(() => obs.log('verbose', 'nope'), TypeError);
  assert.throws(() => obs.log('info', ''), TypeError);
});

test('metrics snapshot is deterministic sorted and frozen', () => {
  const obs = createObservability({});
  obs.metrics.incrementCounter('events.processed', { b: '2', a: '1' });
  obs.metrics.incrementCounter('events.processed', { a: '1', b: '2' });
  obs.metrics.setGauge('queue.depth', 7);
  obs.metrics.observeHistogram('latency', 12, { route: '/x' });
  const snap = obs.metrics.snapshot();
  assert.deepEqual(snap.map((row) => row.name), ['events.processed', 'latency', 'queue.depth']);
  assert.equal(snap[0].count, 2);
  assert.deepEqual(snap[0].labels, { a: '1', b: '2' });
  const histogramRow = snap.find((row) => row.name === 'latency');
  assert.deepEqual({ count: histogramRow.count, sum: histogramRow.sum, min: histogramRow.min, max: histogramRow.max }, { count: 1, sum: 12, min: 12, max: 12 });
  assert.equal(snap.find((row) => row.name === 'queue.depth').value, 7);
  assert.equal(Object.isFrozen(snap), true);
  assert.equal(Object.isFrozen(snap[0]), true);
  assert.equal(Object.isFrozen(snap[0].labels), true);
  assert.throws(() => { snap[0].name = 'tampered'; }, TypeError);
  assert.throws(() => snap.pop(), TypeError);
  assert.throws(() => obs.metrics.observeHistogram('bad', Number.NaN), TypeError);
  assert.throws(() => obs.metrics.setGauge('bad', 'not-a-number'), TypeError);
  assert.throws(() => obs.metrics.incrementCounter('', {}), TypeError);
  obs.metrics.setGauge('conflict', 1, { a: 1 });
  assert.throws(() => obs.metrics.incrementCounter('conflict', { a: 1 }), TypeError);
  assert.throws(() => obs.metrics.incrementCounter('bad-labels', 'not-an-object'), TypeError);
});

test('spans inherit trace context from parent to child and record duration', () => {
  const obs = createObservability({});
  const parent = obs.startSpan('parent', { traceId: 'trace-12345678', tenantId: 't1' });
  const child = obs.startSpan('child');
  assert.equal(child.traceId, 'trace-12345678');
  assert.equal(child.parentSpanId, parent.spanId);
  assert.equal(child.tenantId, 't1');
  child.end();
  parent.end();
  const rows = obs.metrics.snapshot().filter((row) => row.name === 'span.duration_ms');
  assert.equal(rows.reduce((total, row) => total + row.count, 0), 2);
  assert.ok(rows.every((row) => row.labels.tenantId === 't1'));
  assert.throws(() => parent.end(), (error) => error.code === 'SPAN_ALREADY_ENDED');

  const root = obs.startSpan('root');
  assert.notEqual(root.traceId, 'trace-12345678');
  assert.match(root.traceId, /^[0-9a-f]{32}$/);
  assert.equal(root.parentSpanId, null);
  const summary = root.end();
  assert.equal(summary.spanId, root.spanId);
  assert.equal(summary.traceId, root.traceId);
  assert.equal(typeof summary.durationMs, 'number');
  assert.throws(() => obs.startSpan(''), TypeError);
});

test('correlation reuses valid incoming headers and generates otherwise', () => {
  const reused = createCorrelation({ headers: { 'X-Trace-Id': 'tracetestvalue123', 'x-request-id': 'req-test-456' } });
  assert.equal(reused.traceId, 'tracetestvalue123');
  assert.equal(reused.requestId, 'req-test-456');
  assert.match(reused.spanId, /^[0-9a-f]{16}$/);
  assert.equal(Object.isFrozen(reused), true);

  const generated = createCorrelation({});
  assert.notEqual(generated.traceId, reused.traceId);
  assert.match(generated.traceId, /^[0-9a-f]{32}$/);
  assert.match(generated.requestId, /^req_[0-9a-f]{32}$/);

  const rejected = createCorrelation({ headers: { 'x-trace-id': 'bad id with spaces!', 'x-request-id': '' } });
  assert.notEqual(rejected.traceId, 'bad id with spaces!');
  assert.match(rejected.traceId, /^[0-9a-f]{32}$/);

  const viaHeadersInstance = createCorrelation({ headers: new Headers({ 'x-trace-id': 'tracefromheaders123' }) });
  assert.equal(viaHeadersInstance.traceId, 'tracefromheaders123');

  const obs = createObservability({});
  const viaInstance = obs.createCorrelation({ headers: { 'x-trace-id': 'traceviainstance01' } });
  assert.equal(viaInstance.traceId, 'traceviainstance01');
  assert.throws(() => createCorrelation({ headers: 'not-an-object' }), TypeError);
});

test('SLO evaluation computes met ratio and clamped error budget', () => {
  const slo = defineSlo({ name: 'webhook-delivery', sli: 'delivery_success_ratio', target: 0.99, window: '30d' });
  assert.deepEqual({ ...slo }, { name: 'webhook-delivery', sli: 'delivery_success_ratio', target: 0.99, window: '30d' });
  assert.equal(Object.isFrozen(slo), true);

  const met = evaluateSlo(slo, 999, 1000);
  assert.equal(met.met, true);
  assert.equal(met.ratio, 0.999);
  assert.ok(Math.abs(met.errorBudgetRemaining - 0.009) < 1e-9);

  const boundary = evaluateSlo(slo, 990, 1000);
  assert.equal(boundary.met, true);
  assert.equal(boundary.errorBudgetRemaining, 0);

  const missed = evaluateSlo(slo, 950, 1000);
  assert.equal(missed.met, false);
  assert.equal(missed.ratio, 0.95);
  assert.equal(missed.errorBudgetRemaining, 0);
  assert.equal(Object.isFrozen(met), true);

  assert.throws(() => evaluateSlo(slo, 0, 0), TypeError);
  assert.throws(() => evaluateSlo(slo, 1001, 1000), Error);
  assert.throws(() => evaluateSlo(null, 1, 1), TypeError);
  assert.throws(() => evaluateSlo(slo, -1, 10), TypeError);
  assert.throws(() => defineSlo({ name: 'x', sli: 'y', target: 1.5, window: '30d' }), TypeError);
  assert.throws(() => defineSlo({ name: 'x', sli: 'y', target: 0.99, window: 'fortnight' }), TypeError);
});
