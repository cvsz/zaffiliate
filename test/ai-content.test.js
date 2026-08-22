import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIRequest, recordAIUsage, createAgentExecution, evaluateToolPolicy, selectProviderCandidate } from '../packages/ai-content/src/domain.js';

test('AI request carries deterministic provenance fields', () => {
  const request = createAIRequest({ tenantId: 't1', requestId: 'r1', actorId: 'u1', provider: 'openai', model: 'model-a', modality: 'text', promptTemplateId: 'caption', promptTemplateVersion: 'v2', inputHash: 'sha256:abc', maxCost: 1.5 });
  assert.equal(request.promptTemplateVersion, 'v2');
  assert.equal(request.inputHash, 'sha256:abc');
});

test('usage recording rejects cost beyond request budget', () => {
  const request = createAIRequest({ tenantId: 't1', requestId: 'r1', actorId: 'u1', provider: 'p', model: 'm', modality: 'text', promptTemplateId: 'x', promptTemplateVersion: 'v1', inputHash: 'h', maxCost: 0.5 });
  assert.throws(() => recordAIUsage({ request, outputHash: 'o', actualCost: 0.6 }), (error) => error.code === 'AI_COST_BUDGET_EXCEEDED');
  assert.equal(recordAIUsage({ request, outputHash: 'o', actualCost: 0.4 }).actualCost, 0.4);
});

test('mutating or high-risk tools require approval', () => {
  const request = createAIRequest({ tenantId: 't1', requestId: 'r1', actorId: 'u1', provider: 'p', model: 'm', modality: 'text', promptTemplateId: 'x', promptTemplateVersion: 'v1', inputHash: 'h', maxCost: 1 });
  const execution = createAgentExecution({ tenantId: 't1', executionId: 'e1', role: 'publisher', aiRequest: request, tools: [
    { name: 'read_catalog', mutating: false, risk: 'low' },
    { name: 'publish_post', mutating: true, risk: 'high' }
  ] });
  assert.deepEqual(evaluateToolPolicy({ execution, toolName: 'read_catalog' }), { allowed: true, reason: 'read_only_grant' });
  assert.deepEqual(evaluateToolPolicy({ execution, toolName: 'publish_post' }), { allowed: false, reason: 'approval_required' });
  assert.deepEqual(evaluateToolPolicy({ execution, toolName: 'publish_post', hasApproval: true }), { allowed: true, reason: 'approved' });
  assert.deepEqual(evaluateToolPolicy({ execution, toolName: 'unknown' }), { allowed: false, reason: 'tool_not_granted' });
});

test('provider selection respects modality, enabled flag, priority and cost cap', () => {
  const selected = selectProviderCandidate({ modality: 'text', maxUnitCost: 0.2, candidates: [
    { provider: 'a', model: 'm1', modalities: ['text'], unitCost: 0.1, priority: 20 },
    { provider: 'b', model: 'm2', modalities: ['text'], unitCost: 0.15, priority: 10 },
    { provider: 'c', model: 'm3', modalities: ['image'], unitCost: 0.01, priority: 1 }
  ] });
  assert.equal(selected.provider, 'b');
  assert.throws(() => selectProviderCandidate({ modality: 'video', maxUnitCost: 0.01, candidates: [] }), (error) => error.code === 'NO_AI_PROVIDER_CANDIDATE');
});
