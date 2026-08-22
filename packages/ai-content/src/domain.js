function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function createAIRequest({ tenantId, requestId, actorId, provider, model, modality, promptTemplateId, promptTemplateVersion, inputHash, maxCost, metadata = {} }) {
  const cost = Number(maxCost);
  if (!Number.isFinite(cost) || cost < 0) throw new Error('maxCost must be a non-negative number');
  const normalizedModality = required(modality, 'modality').toLowerCase();
  if (!['text','image','video','voice','embedding'].includes(normalizedModality)) throw new Error('unsupported AI modality');
  return Object.freeze({
    tenantId: required(tenantId, 'tenantId'),
    requestId: required(requestId, 'requestId'),
    actorId: required(actorId, 'actorId'),
    provider: required(provider, 'provider').toLowerCase(),
    model: required(model, 'model'),
    modality: normalizedModality,
    promptTemplateId: required(promptTemplateId, 'promptTemplateId'),
    promptTemplateVersion: required(promptTemplateVersion, 'promptTemplateVersion'),
    inputHash: required(inputHash, 'inputHash'),
    maxCost: cost,
    metadata: Object.freeze({ ...metadata })
  });
}

export function recordAIUsage({ request, outputHash, inputTokens = 0, outputTokens = 0, actualCost = 0, providerRequestId = null }) {
  const cost = Number(actualCost);
  if (!Number.isFinite(cost) || cost < 0) throw new Error('actualCost must be a non-negative number');
  if (cost > request.maxCost) throw Object.assign(new Error('AI cost budget exceeded'), { code: 'AI_COST_BUDGET_EXCEEDED' });
  return Object.freeze({
    tenantId: request.tenantId,
    requestId: request.requestId,
    provider: request.provider,
    model: request.model,
    modality: request.modality,
    promptTemplateId: request.promptTemplateId,
    promptTemplateVersion: request.promptTemplateVersion,
    inputHash: request.inputHash,
    outputHash: required(outputHash, 'outputHash'),
    inputTokens: Number(inputTokens || 0),
    outputTokens: Number(outputTokens || 0),
    actualCost: cost,
    providerRequestId: providerRequestId == null ? null : String(providerRequestId)
  });
}

export const AgentRoles = Object.freeze(['product_researcher','offer_ranker','copy_script','media_brief','publisher','conversion_analyst','affiliate_optimizer']);

export function createAgentExecution({ tenantId, executionId, role, aiRequest, tools = [] }) {
  const normalizedRole = required(role, 'role').toLowerCase();
  if (!AgentRoles.includes(normalizedRole)) throw new Error('unsupported agent role');
  if (!aiRequest || aiRequest.tenantId !== tenantId) throw new Error('AI request tenant mismatch');
  return Object.freeze({
    tenantId: required(tenantId, 'tenantId'),
    executionId: required(executionId, 'executionId'),
    role: normalizedRole,
    requestId: aiRequest.requestId,
    tools: Object.freeze(tools.map((tool) => Object.freeze({ name: required(tool.name, 'tool.name'), mutating: Boolean(tool.mutating), risk: String(tool.risk || 'low').toLowerCase() })))
  });
}

export function evaluateToolPolicy({ execution, toolName, hasApproval = false }) {
  const tool = execution.tools.find((entry) => entry.name === toolName);
  if (!tool) return Object.freeze({ allowed: false, reason: 'tool_not_granted' });
  const requiresApproval = tool.mutating || ['high','critical'].includes(tool.risk);
  if (requiresApproval && !hasApproval) return Object.freeze({ allowed: false, reason: 'approval_required' });
  return Object.freeze({ allowed: true, reason: requiresApproval ? 'approved' : 'read_only_grant' });
}

export function selectProviderCandidate({ candidates, modality, maxUnitCost }) {
  const limit = Number(maxUnitCost);
  const eligible = (candidates || [])
    .filter((candidate) => candidate.enabled !== false)
    .filter((candidate) => (candidate.modalities || []).includes(modality))
    .filter((candidate) => Number(candidate.unitCost) <= limit)
    .sort((a, b) => Number(a.priority ?? 100) - Number(b.priority ?? 100) || Number(a.unitCost) - Number(b.unitCost));
  if (!eligible.length) throw Object.assign(new Error('no eligible AI provider candidate'), { code: 'NO_AI_PROVIDER_CANDIDATE' });
  const candidate = eligible[0];
  return Object.freeze({ provider: candidate.provider, model: candidate.model, unitCost: Number(candidate.unitCost) });
}
