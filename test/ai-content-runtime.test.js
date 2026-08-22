import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAiContentRuntime } from '../packages/ai-content/src/runtime.js';

const NOW_MS = Date.parse('2026-08-20T12:00:00Z');

function fixedClock() {
  return () => NOW_MS;
}

function allowAllModerator() {
  return () => ({ allowed: true, reason: 'ok' });
}

function echoTransport(log = []) {
  return (request) => {
    log.push(request);
    return { output: `echo:${request.prompt}`, usage: { inputTokens: 3, outputTokens: 5 } };
  };
}

function seedRuntime(overrides = {}) {
  const log = [];
  const runtime = createAiContentRuntime({
    clock: overrides.clock ?? fixedClock(),
    transport: overrides.transport ?? echoTransport(log),
    moderator: overrides.moderator ?? allowAllModerator(),
    spendBudgetMinorUnits: overrides.spendBudgetMinorUnits ?? 100000,
    cacheTtlMs: overrides.cacheTtlMs ?? 60000
  });
  return { runtime, log };
}

function seedGreetingTemplate(runtime) {
  runtime.registerPromptTemplate({ tenantId: 't1', templateId: 'greet', version: 'v1', text: 'Hello {{name}}', variables: ['name'] });
  runtime.registerPromptTemplate({ tenantId: 't1', templateId: 'greet', version: 'v2', text: 'Hi {{name}} ({{tone}})', variables: ['name', 'tone'] });
}

test('template versioning renders requested and latest versions with strict variable validation', () => {
  const { runtime } = seedRuntime();
  seedGreetingTemplate(runtime);

  const latest = runtime.render({ tenantId: 't1', templateId: 'greet', version: 'latest', variables: { name: 'Ada', tone: 'warm' } });
  assert.equal(latest.templateVersion, 'v2');
  assert.equal(latest.renderedPrompt, 'Hi Ada (warm)');
  assert.equal(latest.renderedPromptHash, createHash('sha256').update('Hi Ada (warm)', 'utf8').digest('hex'));

  const pinned = runtime.render({ tenantId: 't1', templateId: 'greet', version: 'v1', variables: { name: 'Ada' } });
  assert.equal(pinned.templateVersion, 'v1');
  assert.equal(pinned.renderedPrompt, 'Hello Ada');
  const stored = runtime.getRenderedPrompt('t1', pinned.renderedPromptHash);
  assert.equal(stored.renderedPrompt, 'Hello Ada');

  assert.throws(() => runtime.render({ tenantId: 't1', templateId: 'greet', version: 'latest', variables: { name: 'Ada' } }), (error) => error.code === 'missing_variables');
  assert.throws(() => runtime.render({ tenantId: 't1', templateId: 'greet', version: 'latest', variables: { name: 'Ada', tone: 'warm', extra: 'x' } }), (error) => error.code === 'extra_variables');
  assert.throws(() => runtime.registerPromptTemplate({ tenantId: 't1', templateId: 'greet', version: 'v2', text: 'again', variables: [] }), (error) => error.code === 'duplicate_template_version');
  assert.throws(() => runtime.registerPromptTemplate({ tenantId: 't1', templateId: 'other', version: 'v1', text: '{{nope}}', variables: [] }), (error) => error.code === 'undeclared_variables');
});

test('generate resolves providers by priority and falls back on transport failure', () => {
  const { runtime, log } = seedRuntime({
    transport(request) {
      log.push(request);
      if (request.providerId === 'p1') throw new Error('p1 exploded');
      return { output: `echo:${request.prompt}`, usage: { inputTokens: 1, outputTokens: 2 } };
    }
  });
  runtime.registerProvider({ providerId: 'p1', kind: 'llm', priority: 10, costPerCallMinorUnits: 10 });
  runtime.registerProvider({ providerId: 'p2', kind: 'llm', priority: 20, costPerCallMinorUnits: 20 });
  runtime.registerProvider({ providerId: 'img1', kind: 'image', priority: 1, costPerCallMinorUnits: 5 });
  seedGreetingTemplate(runtime);

  const result = runtime.generate({ tenantId: 't1', actor: 'u1', templateId: 'greet', version: 'v1', variables: { name: 'Ada' }, kind: 'llm', purpose: 'caption' });
  assert.equal(result.cached, false);
  assert.equal(result.providerId, 'p2');
  assert.deepEqual(log.map((request) => request.providerId), ['p1', 'p2']);
  assert.equal(result.usage.outputTokens, 2);
  assert.equal(runtime.getSpend('t1').spentMinorUnits, 20);
  const metered = runtime.listEvents('t1').filter((event) => event.type === 'ai.usage.metered');
  assert.equal(metered.length, 1);
  assert.equal(metered[0].providerId, 'p2');
  assert.equal(runtime.listProvenance('t1').length, 1);
  assert.equal(runtime.getProvenance('t1', result.provenanceId).purpose, 'caption');

  assert.throws(() => runtime.generate({ tenantId: 't1', actor: 'u1', templateId: 'greet', version: 'v1', variables: { name: 'Ada' }, kind: 'video', purpose: 'clip' }), (error) => error.code === 'no_provider');
});

test('budget is enforced fail-closed before any provider call', () => {
  const tight = seedRuntime({ spendBudgetMinorUnits: 5 });
  tight.runtime.registerProvider({ providerId: 'p1', kind: 'llm', priority: 10, costPerCallMinorUnits: 10 });
  seedGreetingTemplate(tight.runtime);
  assert.throws(() => tight.runtime.generate({ tenantId: 't1', actor: 'u1', templateId: 'greet', version: 'v1', variables: { name: 'Ada' }, kind: 'llm', purpose: 'p0' }), (error) => error.code === 'budget_exceeded');
  assert.equal(tight.log.length, 0);

  const { runtime, log } = seedRuntime({ spendBudgetMinorUnits: 25 });
  runtime.registerProvider({ providerId: 'p1', kind: 'llm', priority: 10, costPerCallMinorUnits: 10 });
  seedGreetingTemplate(runtime);
  runtime.generate({ tenantId: 't1', actor: 'u1', templateId: 'greet', version: 'v1', variables: { name: 'a' }, kind: 'llm', purpose: 'p1' });
  runtime.generate({ tenantId: 't1', actor: 'u1', templateId: 'greet', version: 'v1', variables: { name: 'b' }, kind: 'llm', purpose: 'p2' });
  assert.equal(runtime.getSpend('t1').spentMinorUnits, 20);
  assert.throws(() => runtime.generate({ tenantId: 't1', actor: 'u1', templateId: 'greet', version: 'v1', variables: { name: 'c' }, kind: 'llm', purpose: 'p3' }), (error) => error.code === 'budget_exceeded');
  assert.equal(log.length, 2);
});

test('moderation blocked outputs are discarded, metered and audited', () => {
  const { runtime, log } = seedRuntime({
    moderator(content) {
      return String(content).includes('bad') ? { allowed: false, reason: 'unsafe' } : { allowed: true, reason: 'ok' };
    }
  });
  runtime.registerProvider({ providerId: 'p1', kind: 'llm', priority: 10, costPerCallMinorUnits: 10 });
  runtime.registerPromptTemplate({ tenantId: 't1', templateId: 'wordy', version: 'v1', text: 'say {{word}}', variables: ['word'] });

  assert.throws(() => runtime.generate({ tenantId: 't1', actor: 'u1', templateId: 'wordy', version: 'v1', variables: { word: 'bad stuff' }, kind: 'llm', purpose: 'copy' }), (error) => error.code === 'moderation_blocked');
  const events = runtime.listEvents('t1');
  assert.equal(events.filter((event) => event.type === 'ai.moderation.blocked').length, 1);
  assert.equal(events.filter((event) => event.type === 'ai.moderation.blocked')[0].reason, 'unsafe');
  assert.equal(events.filter((event) => event.type === 'ai.usage.metered').length, 1);
  assert.equal(runtime.getSpend('t1').spentMinorUnits, 10);
  assert.equal(runtime.listProvenance('t1').length, 0);

  const clean = runtime.generate({ tenantId: 't1', actor: 'u1', templateId: 'wordy', version: 'v1', variables: { word: 'good stuff' }, kind: 'llm', purpose: 'copy' });
  assert.equal(clean.cached, false);
  assert.equal(clean.output, 'echo:say good stuff');
  assert.equal(log.length, 2);
});

test('provenance hash is deterministic sha256 of the rendered prompt and records are immutable', () => {
  const first = seedRuntime();
  first.runtime.registerProvider({ providerId: 'p1', kind: 'llm', priority: 10, costPerCallMinorUnits: 10 });
  first.runtime.registerPromptTemplate({ tenantId: 't1', templateId: 'greet', version: 'v1', text: 'Hello {{name}}', variables: ['name'] });

  const second = seedRuntime();
  second.runtime.registerProvider({ providerId: 'p9', kind: 'llm', priority: 99, costPerCallMinorUnits: 77 });
  second.runtime.registerPromptTemplate({ tenantId: 't2', templateId: 'greet', version: 'v1', text: 'Hello {{name}}', variables: ['name'] });

  const a = first.runtime.generate({ tenantId: 't1', actor: 'u1', templateId: 'greet', version: 'v1', variables: { name: 'Ada' }, kind: 'llm', purpose: 'caption' });
  const b = second.runtime.generate({ tenantId: 't2', actor: 'someone-else', templateId: 'greet', version: 'v1', variables: { name: 'Ada' }, kind: 'llm', purpose: 'other-purpose' });
  assert.equal(a.provenance.renderedPromptHash, b.provenance.renderedPromptHash);
  assert.equal(a.provenance.renderedPromptHash, createHash('sha256').update('Hello Ada', 'utf8').digest('hex'));

  const c = first.runtime.generate({ tenantId: 't1', actor: 'u1', templateId: 'greet', version: 'v1', variables: { name: 'Grace' }, kind: 'llm', purpose: 'caption' });
  assert.notEqual(a.provenance.renderedPromptHash, c.provenance.renderedPromptHash);

  for (const provenance of [a.provenance, b.provenance]) {
    assert.equal(Object.isFrozen(provenance), true);
    assert.equal(provenance.actor != null && provenance.purpose != null && provenance.createdAt != null && provenance.modelParams != null, true);
  }
});

test('cache hits avoid provider calls within ttl and expire afterwards', () => {
  let now = NOW_MS;
  const { runtime, log } = seedRuntime({ clock: () => now, cacheTtlMs: 1000 });
  runtime.registerProvider({ providerId: 'p1', kind: 'llm', priority: 10, costPerCallMinorUnits: 10 });
  runtime.registerPromptTemplate({ tenantId: 't1', templateId: 'greet', version: 'v1', text: 'Hello {{name}}', variables: ['name'] });

  const call = () => runtime.generate({ tenantId: 't1', actor: 'u1', templateId: 'greet', version: 'v1', variables: { name: 'Ada' }, kind: 'llm', purpose: 'caption' });
  const fresh = call();
  assert.equal(fresh.cached, false);
  assert.equal(log.length, 1);
  const hit = call();
  assert.equal(hit.cached, true);
  assert.equal(hit.cacheKey, fresh.cacheKey);
  assert.equal(hit.provenanceId, fresh.provenanceId);
  assert.equal(log.length, 1);

  now += 2000;
  const expired = call();
  assert.equal(expired.cached, false);
  assert.equal(expired.cacheKey, fresh.cacheKey);
  assert.equal(log.length, 2);
});

test('tool invocation fails closed without grant coverage and emits audit events', () => {
  const { runtime } = seedRuntime();
  const tool = { name: 'publish_post', requiredParams: ['postId'] };

  assert.throws(() => runtime.invokeTool({ tenantId: 't1', actor: 'u1', tool, params: { postId: 'p1' }, grant: { tools: ['read_catalog'] } }), (error) => error.code === 'tool_not_granted');
  assert.throws(() => runtime.invokeTool({ tenantId: 't1', actor: 'u1', tool, params: { postId: 'p1' }, grant: null }), (error) => error.code === 'tool_not_granted');

  const allowed = runtime.invokeTool({ tenantId: 't1', actor: 'u1', tool, params: { postId: 'p1' }, grant: { tools: ['publish_post'] } });
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.params, { postId: 'p1' });

  assert.throws(() => runtime.invokeTool({ tenantId: 't1', actor: 'u1', tool, params: {}, grant: { tools: ['publish_post'] } }), (error) => error.code === 'invalid_params');
  assert.throws(() => runtime.invokeTool({ tenantId: 't1', actor: 'u1', tool, params: { postId: 'p1', extra: true }, grant: { tools: ['publish_post'] } }), (error) => error.code === 'invalid_params');

  const audits = runtime.listEvents('t1').filter((event) => event.type === 'ai.tool.invoked');
  assert.equal(audits.length, 5);
  assert.deepEqual(audits.map((event) => event.allowed), [false, false, true, false, false]);
  assert.equal(audits[0].reason, 'tool_not_granted');
  assert.equal(audits[4].reason, 'invalid_params');
});

test('publisher agent requires approvalRef while other agents route to their own templates', () => {
  const { runtime, log } = seedRuntime();
  runtime.registerProvider({ providerId: 'p1', kind: 'llm', priority: 10, costPerCallMinorUnits: 10 });
  runtime.registerAgent({ agentId: 'product-research', kind: 'llm' });
  runtime.registerAgent({ agentId: 'publisher', kind: 'llm' });
  runtime.registerPromptTemplate({ tenantId: 't1', templateId: 'agent.product-research', version: 'v1', text: 'Research: {{brief}}', variables: ['brief'] });
  runtime.registerPromptTemplate({ tenantId: 't1', templateId: 'agent.publisher', version: 'v1', text: 'Publish: {{draft}}', variables: ['draft'] });

  assert.throws(() => runtime.runAgent({ tenantId: 't1', agentId: 'unknown-agent', input: {} }), (error) => error.code === 'unknown_agent');
  assert.throws(() => runtime.runAgent({ tenantId: 't1', agentId: 'publisher', input: { draft: 'post-1' } }), (error) => error.code === 'approval_required');
  assert.equal(log.length, 0);

  const approved = runtime.runAgent({ tenantId: 't1', agentId: 'publisher', input: { draft: 'post-1' }, approvalRef: 'appr-1' });
  assert.equal(approved.agentId, 'publisher');
  assert.equal(approved.purpose, 'agent.publisher');
  assert.equal(approved.output, 'echo:Publish: post-1');

  const research = runtime.runAgent({ tenantId: 't1', agentId: 'product-research', input: { brief: 'wireless earbuds' } });
  assert.equal(research.agentId, 'product-research');
  assert.equal(research.output, 'echo:Research: wireless earbuds');
  assert.equal(log.length, 2);
});

test('bandit selection is deterministic per seed and suggestion argmaxes average reward with lowest-id tie-break', () => {
  const { runtime } = seedRuntime();
  runtime.createExperiment({ tenantId: 't1', experimentId: 'exp1', variants: [{ variantId: 'b', weight: 0.5 }, { variantId: 'a', weight: 0.5 }] });

  const first = runtime.selectVariant({ experimentId: 'exp1', seed: 42 });
  const second = runtime.selectVariant({ experimentId: 'exp1', seed: 42 });
  assert.equal(first, second);
  assert.equal(runtime.selectVariant({ experimentId: 'exp1', seed: 'alpha' }), runtime.selectVariant({ experimentId: 'exp1', seed: 'alpha' }));
  assert.ok(['a', 'b'].includes(first));

  runtime.recordOutcome({ experimentId: 'exp1', variantId: 'a', reward: 0.9 });
  runtime.recordOutcome({ experimentId: 'exp1', variantId: 'a', reward: 0.3 });
  runtime.recordOutcome({ experimentId: 'exp1', variantId: 'b', reward: 0.2 });
  assert.equal(runtime.suggestVariant({ experimentId: 'exp1' }), 'a');

  runtime.createExperiment({ tenantId: 't1', experimentId: 'exp2', variants: [{ variantId: 'z', weight: 0.25 }, { variantId: 'a', weight: 0.75 }] });
  runtime.recordOutcome({ experimentId: 'exp2', variantId: 'z', reward: 0.5 });
  runtime.recordOutcome({ experimentId: 'exp2', variantId: 'a', reward: 0.5 });
  assert.equal(runtime.suggestVariant({ experimentId: 'exp2' }), 'a');

  runtime.createExperiment({ tenantId: 't1', experimentId: 'exp3', variants: [{ variantId: 'n', weight: 1 }] });
  assert.equal(runtime.suggestVariant({ experimentId: 'exp3' }), 'n');
  assert.throws(() => runtime.selectVariant({ experimentId: 'missing', seed: 1 }), (error) => error.code === 'unknown_experiment');
});

test('experiment weights must sum to 1.0 within tolerance and stay valid', () => {
  const { runtime } = seedRuntime();

  assert.throws(() => runtime.createExperiment({ tenantId: 't1', experimentId: 'bad-sum', variants: [{ variantId: 'a', weight: 0.5 }, { variantId: 'b', weight: 0.4 }] }), (error) => error.code === 'invalid_weights');
  assert.throws(() => runtime.createExperiment({ tenantId: 't1', experimentId: 'negative', variants: [{ variantId: 'a', weight: 1.5 }, { variantId: 'b', weight: -0.5 }] }), (error) => error instanceof TypeError);
  assert.throws(() => runtime.createExperiment({ tenantId: 't1', experimentId: 'dupes', variants: [{ variantId: 'a', weight: 0.5 }, { variantId: 'a', weight: 0.5 }] }), (error) => error.code === 'duplicate_variant');
  assert.throws(() => runtime.createExperiment({ tenantId: 't1', experimentId: 'empty', variants: [] }), (error) => error instanceof TypeError);

  const tolerated = runtime.createExperiment({ tenantId: 't1', experimentId: 'ok', variants: [{ variantId: 'a', weight: 0.5 }, { variantId: 'b', weight: 0.5000000005 }] });
  assert.equal(tolerated.experimentId, 'ok');
  assert.deepEqual(tolerated.variants.map((variant) => variant.variantId), ['a', 'b']);
  assert.equal(Object.isFrozen(tolerated.variants[0]), true);
});
