import { createHash } from 'node:crypto';

export const AI_KINDS = Object.freeze(['llm', 'image', 'video', 'voice']);

export const CANONICAL_AGENT_IDS = Object.freeze([
  'product-research',
  'offer-ranking',
  'copy-script',
  'image-video-brief',
  'publisher',
  'conversion-analysis',
  'affiliate-optimizer'
]);

const PUBLISHER_AGENT_ID = 'publisher';
const WEIGHT_TOLERANCE = 1e-9;
const DEFAULT_CACHE_TTL_MS = 60000;
const PLACEHOLDER_PATTERN = /\{\{([^{}]+)\}\}/g;

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`);
  return value;
}

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toSeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
  if (typeof value === 'string' && value.trim()) return Number.parseInt(sha256Hex(value.trim()).slice(0, 8), 16) >>> 0;
  throw new TypeError('seed must be a finite number or a non-empty string');
}

function agentTemplateId(agentId) {
  return `agent.${agentId}`;
}

export function createAiContentRuntime({ clock = () => Date.now(), spendBudgetMinorUnits = 100000, transport = null, moderator = null, cacheTtlMs = DEFAULT_CACHE_TTL_MS } = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  nonNegativeInteger(spendBudgetMinorUnits, 'spendBudgetMinorUnits');
  nonNegativeInteger(cacheTtlMs, 'cacheTtlMs');
  if (transport !== null && typeof transport !== 'function') throw new TypeError('transport must be a function');
  if (moderator !== null && typeof moderator !== 'function') throw new TypeError('moderator must be a function');

  const partitions = new Map();
  const providers = new Map();
  const agents = new Map();
  const experimentIndex = new Map();
  let sequence = 0;
  let provenanceSequence = 0;

  function partition(tenantId) {
    const id = required(tenantId, 'tenantId');
    let scope = partitions.get(id);
    if (!scope) {
      scope = {
        tenantId: id,
        templates: new Map(),
        latestTemplates: new Map(),
        renderedPrompts: new Map(),
        provenance: new Map(),
        cache: new Map(),
        events: [],
        spendMinorUnits: 0,
        experiments: new Map(),
        experimentStats: new Map()
      };
      partitions.set(id, scope);
    }
    return scope;
  }

  function emit(scope, atMs, type, payload) {
    sequence += 1;
    const event = Object.freeze({ sequence, tenantId: scope.tenantId, type, at: iso(atMs), ...payload });
    scope.events.push(event);
    return event;
  }

  function registerProvider(input) {
    const data = requireObject(input, 'provider input');
    const providerId = required(data.providerId, 'providerId');
    const kind = required(data.kind, 'kind');
    if (!AI_KINDS.includes(kind)) throw new TypeError(`unsupported provider kind: ${kind}`);
    if (!Number.isSafeInteger(data.priority)) throw new TypeError('priority must be an integer');
    const costPerCallMinorUnits = nonNegativeInteger(data.costPerCallMinorUnits, 'costPerCallMinorUnits');
    if (providers.has(providerId)) fail('duplicate_provider', `provider already registered: ${providerId}`);
    const record = Object.freeze({ providerId, kind, priority: data.priority, costPerCallMinorUnits });
    providers.set(providerId, record);
    return record;
  }

  function orderedProviders(kind) {
    return [...providers.values()]
      .filter((entry) => entry.kind === kind)
      .sort((a, b) => a.priority - b.priority || compareStrings(a.providerId, b.providerId));
  }

  function collectPlaceholders(text) {
    const names = [];
    for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
      const name = match[1].trim();
      if (!names.includes(name)) names.push(name);
    }
    return names;
  }

  function registerPromptTemplate(input) {
    const data = requireObject(input, 'template input');
    const scope = partition(data.tenantId);
    const templateId = required(data.templateId, 'templateId');
    const version = required(data.version, 'version');
    const text = required(data.text, 'text');
    const declaredRaw = data.variables == null ? [] : data.variables;
    if (!Array.isArray(declaredRaw)) throw new TypeError('variables must be an array');
    const declared = [];
    for (const entry of declaredRaw) {
      const name = required(entry, 'variables entry');
      if (declared.includes(name)) throw new Error(`duplicate variable: ${name}`);
      declared.push(name);
    }
    const referenced = collectPlaceholders(text);
    const undeclared = referenced.filter((name) => !declared.includes(name));
    if (undeclared.length) fail('undeclared_variables', `template references undeclared variables: ${undeclared.join(', ')}`);
    const unreferenced = declared.filter((name) => !referenced.includes(name));
    if (unreferenced.length) fail('unreferenced_variables', `template declares unreferenced variables: ${unreferenced.join(', ')}`);
    let versions = scope.templates.get(templateId);
    if (!versions) {
      versions = new Map();
      scope.templates.set(templateId, versions);
    }
    if (versions.has(version)) fail('duplicate_template_version', `template ${templateId} version ${version} already exists`);
    const record = Object.freeze({ tenantId: scope.tenantId, templateId, version, text, variables: Object.freeze([...declared]) });
    versions.set(version, Object.freeze({ record }));
    scope.latestTemplates.set(templateId, version);
    return record;
  }

  function resolveTemplate(scope, templateId, version) {
    const versions = scope.templates.get(templateId);
    if (!versions) fail('unknown_template', `template not found: ${templateId}`);
    const resolvedVersion = version == null || version === 'latest' ? scope.latestTemplates.get(templateId) : required(version, 'version');
    const entry = versions.get(resolvedVersion);
    if (!entry) fail('unknown_template_version', `template ${templateId} version ${resolvedVersion} not found`);
    return entry.record;
  }

  function renderTemplate(record, variablesSource) {
    const variables = variablesSource == null ? {} : requireObject(variablesSource, 'variables');
    const declared = record.variables;
    const missing = declared.filter((name) => !hasOwn(variables, name) || variables[name] == null);
    if (missing.length) fail('missing_variables', `missing template variables: ${missing.join(', ')}`);
    const extras = Object.keys(variables).filter((name) => !declared.includes(name));
    if (extras.length) fail('extra_variables', `unexpected template variables: ${extras.join(', ')}`);
    return record.text.replace(PLACEHOLDER_PATTERN, (_, rawName) => String(variables[rawName.trim()]));
  }

  function render(input) {
    const data = requireObject(input, 'render input');
    const scope = partition(data.tenantId);
    const templateId = required(data.templateId, 'templateId');
    const record = resolveTemplate(scope, templateId, data.version);
    const renderedPrompt = renderTemplate(record, data.variables);
    const renderedPromptHash = sha256Hex(renderedPrompt);
    if (!scope.renderedPrompts.has(renderedPromptHash)) {
      scope.renderedPrompts.set(renderedPromptHash, Object.freeze({
        renderedPromptHash,
        renderedPrompt,
        templateId: record.templateId,
        templateVersion: record.version,
        createdAt: iso(clock())
      }));
    }
    return Object.freeze({ templateId: record.templateId, templateVersion: record.version, renderedPrompt, renderedPromptHash });
  }

  function cacheKeyFor(tenantId, templateId, templateVersion, purpose, variables) {
    const canonical = canonicalJson(variables == null ? {} : variables);
    return `ck_${sha256Hex([tenantId, templateId, templateVersion, purpose, canonical].join('\n'))}`;
  }

  function lookupCache(scope, cacheKey, atMs) {
    const entry = scope.cache.get(cacheKey);
    if (!entry) return null;
    if (atMs - entry.atMs > cacheTtlMs) {
      scope.cache.delete(cacheKey);
      return null;
    }
    return entry;
  }

  function generate(input) {
    const data = requireObject(input, 'generate input');
    const scope = partition(data.tenantId);
    const actor = required(data.actor, 'actor');
    const purpose = required(data.purpose, 'purpose');
    const kind = required(data.kind, 'kind');
    if (!AI_KINDS.includes(kind)) fail('unsupported_kind', `unsupported AI kind: ${kind}`);
    const modelParamsSource = data.modelParams == null ? {} : requireObject(data.modelParams, 'modelParams');
    const templateId = required(data.templateId, 'templateId');
    const rendered = render({ tenantId: scope.tenantId, templateId, version: data.version, variables: data.variables });
    const atMs = clock();
    const cacheKey = cacheKeyFor(scope.tenantId, rendered.templateId, rendered.templateVersion, purpose, data.variables);
    const hit = lookupCache(scope, cacheKey, atMs);
    if (hit) {
      return Object.freeze({ output: hit.output, cached: true, cacheKey, provenanceId: hit.provenanceId, providerId: hit.providerId });
    }
    const candidates = orderedProviders(kind);
    if (!candidates.length) fail('no_provider', `no provider registered for kind: ${kind}`);
    if (typeof transport !== 'function') fail('transport_required', 'transport must be injected before generating');
    const provenanceId = `prov_${++provenanceSequence}`;
    let lastFailure = null;
    for (const candidate of candidates) {
      if (scope.spendMinorUnits + candidate.costPerCallMinorUnits > spendBudgetMinorUnits) {
        fail('budget_exceeded', `spend budget exceeded: spent ${scope.spendMinorUnits} plus cost ${candidate.costPerCallMinorUnits} exceeds ${spendBudgetMinorUnits}`);
      }
      const request = Object.freeze({
        tenantId: scope.tenantId,
        requestId: provenanceId,
        actor,
        purpose,
        kind,
        providerId: candidate.providerId,
        priority: candidate.priority,
        costPerCallMinorUnits: candidate.costPerCallMinorUnits,
        templateId: rendered.templateId,
        templateVersion: rendered.templateVersion,
        prompt: rendered.renderedPrompt,
        promptHash: rendered.renderedPromptHash,
        modelParams: Object.freeze({ ...modelParamsSource })
      });
      let result;
      try {
        result = transport(request);
      } catch (error) {
        lastFailure = error;
        continue;
      }
      if (!result || typeof result !== 'object' || !('output' in result)) {
        lastFailure = new Error('transport returned an invalid result');
        continue;
      }
      const output = result.output;
      const usage = Object.freeze({ ...(result.usage && typeof result.usage === 'object' ? result.usage : {}) });
      scope.spendMinorUnits += candidate.costPerCallMinorUnits;
      emit(scope, clock(), 'ai.usage.metered', {
        provenanceId,
        providerId: candidate.providerId,
        kind,
        purpose,
        templateId: rendered.templateId,
        templateVersion: rendered.templateVersion,
        costMinorUnits: candidate.costPerCallMinorUnits,
        usage
      });
      if (moderator) {
        let verdict = null;
        try {
          verdict = moderator(output);
        } catch {
          verdict = { allowed: false, reason: 'moderator_error' };
        }
        if (!verdict || verdict.allowed !== true) {
          const reason = verdict && verdict.reason != null ? String(verdict.reason) : 'not_allowed';
          emit(scope, clock(), 'ai.moderation.blocked', { provenanceId, providerId: candidate.providerId, kind, purpose, reason });
          fail('moderation_blocked', `output blocked by moderation: ${reason}`);
        }
      }
      const provenance = Object.freeze({
        provenanceId,
        tenantId: scope.tenantId,
        actor,
        templateId: rendered.templateId,
        templateVersion: rendered.templateVersion,
        renderedPromptHash: rendered.renderedPromptHash,
        providerId: candidate.providerId,
        kind,
        modelParams: request.modelParams,
        purpose,
        createdAt: iso(clock())
      });
      scope.provenance.set(provenanceId, provenance);
      scope.cache.set(cacheKey, Object.freeze({ output, provenanceId, providerId: candidate.providerId, atMs: clock() }));
      return Object.freeze({
        output,
        cached: false,
        cacheKey,
        provenanceId,
        provenance,
        providerId: candidate.providerId,
        purpose,
        usage,
        costMinorUnits: candidate.costPerCallMinorUnits
      });
    }
    fail('provider_failed', `all providers failed for kind ${kind}${lastFailure ? `: ${lastFailure.message}` : ''}`);
  }

  function invokeTool(input) {
    const data = requireObject(input, 'invokeTool input');
    const scope = partition(data.tenantId);
    const actor = required(data.actor, 'actor');
    const toolData = requireObject(data.tool, 'tool');
    const toolName = required(toolData.name, 'tool.name');
    const requiredParamsRaw = toolData.requiredParams == null ? [] : toolData.requiredParams;
    if (!Array.isArray(requiredParamsRaw)) throw new TypeError('tool.requiredParams must be an array');
    const requiredParams = [];
    for (const entry of requiredParamsRaw) {
      const name = required(entry, 'tool.requiredParams entry');
      if (requiredParams.includes(name)) throw new Error(`duplicate required param: ${name}`);
      requiredParams.push(name);
    }
    const atMs = clock();
    const covered = Boolean(data.grant) && typeof data.grant === 'object' && Array.isArray(data.grant.tools) && data.grant.tools.includes(toolName);
    if (!covered) {
      emit(scope, atMs, 'ai.tool.invoked', { tool: toolName, actor, allowed: false, reason: 'tool_not_granted' });
      fail('tool_not_granted', `grant does not cover tool: ${toolName}`);
    }
    const paramsSource = data.params == null ? {} : requireObject(data.params, 'params');
    const missing = requiredParams.filter((name) => !hasOwn(paramsSource, name) || paramsSource[name] == null);
    if (missing.length) {
      emit(scope, atMs, 'ai.tool.invoked', { tool: toolName, actor, allowed: false, reason: 'invalid_params' });
      fail('invalid_params', `missing required params: ${missing.join(', ')}`);
    }
    const extras = Object.keys(paramsSource).filter((name) => !requiredParams.includes(name));
    if (extras.length) {
      emit(scope, atMs, 'ai.tool.invoked', { tool: toolName, actor, allowed: false, reason: 'invalid_params' });
      fail('invalid_params', `unexpected params: ${extras.join(', ')}`);
    }
    const params = Object.freeze({ ...paramsSource });
    emit(scope, atMs, 'ai.tool.invoked', { tool: toolName, actor, allowed: true, reason: 'granted' });
    return Object.freeze({ ok: true, tool: toolName, actor, params, at: iso(atMs) });
  }

  function registerAgent(input) {
    const data = requireObject(input, 'agent input');
    const agentId = required(data.agentId, 'agentId');
    if (!CANONICAL_AGENT_IDS.includes(agentId)) fail('unsupported_agent', `agentId must be one of: ${CANONICAL_AGENT_IDS.join(', ')}`);
    const kind = required(data.kind, 'kind');
    if (!AI_KINDS.includes(kind)) throw new TypeError(`unsupported agent kind: ${kind}`);
    if (agents.has(agentId)) fail('duplicate_agent', `agent already registered: ${agentId}`);
    const record = Object.freeze({ agentId, kind, templateId: agentTemplateId(agentId), purpose: agentTemplateId(agentId) });
    agents.set(agentId, record);
    return record;
  }

  function runAgent(input) {
    const data = requireObject(input, 'runAgent input');
    const agentId = required(data.agentId, 'agentId');
    const agent = agents.get(agentId);
    if (!agent) fail('unknown_agent', `agent not registered: ${agentId}`);
    if (agentId === PUBLISHER_AGENT_ID && (data.approvalRef == null || !String(data.approvalRef).trim())) {
      fail('approval_required', 'publisher agent requires an approvalRef for high-risk runs');
    }
    const variables = data.input == null ? {} : requireObject(data.input, 'input');
    const result = generate({
      tenantId: data.tenantId,
      actor: data.actor == null ? `agent:${agentId}` : data.actor,
      templateId: agent.templateId,
      version: data.version == null ? 'latest' : data.version,
      variables,
      kind: agent.kind,
      purpose: agent.purpose,
      modelParams: data.modelParams
    });
    return Object.freeze({ ...result, agentId });
  }

  function createExperiment(input) {
    const data = requireObject(input, 'experiment input');
    const scope = partition(data.tenantId);
    const experimentId = required(data.experimentId, 'experimentId');
    if (experimentIndex.has(experimentId)) fail('experiment_exists', `experiment already exists: ${experimentId}`);
    const variantsRaw = data.variants;
    if (!Array.isArray(variantsRaw) || variantsRaw.length === 0) throw new TypeError('variants must be a non-empty array');
    const seen = new Set();
    const variants = [];
    let total = 0;
    for (const entry of variantsRaw) {
      const item = requireObject(entry, 'variant');
      const variantId = required(item.variantId, 'variant.variantId');
      if (seen.has(variantId)) fail('duplicate_variant', `duplicate variant: ${variantId}`);
      seen.add(variantId);
      const weight = Number(item.weight);
      if (!Number.isFinite(weight) || weight < 0) throw new TypeError(`weight for variant ${variantId} must be a non-negative finite number`);
      total += weight;
      variants.push({ variantId, weight });
    }
    if (Math.abs(total - 1) > WEIGHT_TOLERANCE) fail('invalid_weights', `variant weights must sum to 1.0 within ${WEIGHT_TOLERANCE} (got ${total})`);
    variants.sort((a, b) => compareStrings(a.variantId, b.variantId));
    const record = Object.freeze({
      tenantId: scope.tenantId,
      experimentId,
      variants: Object.freeze(variants.map((variant) => Object.freeze(variant)))
    });
    scope.experiments.set(experimentId, record);
    experimentIndex.set(experimentId, scope.tenantId);
    return record;
  }

  function lookupExperiment(experimentId) {
    const ownerTenantId = experimentIndex.get(required(experimentId, 'experimentId'));
    if (!ownerTenantId) fail('unknown_experiment', `experiment not found: ${experimentId}`);
    return partition(ownerTenantId).experiments.get(experimentId);
  }

  function selectVariant(input) {
    const data = requireObject(input, 'selectVariant input');
    const experiment = lookupExperiment(data.experimentId);
    const roll = mulberry32(toSeed(data.seed))();
    let selected = experiment.variants[experiment.variants.length - 1];
    let cumulative = 0;
    for (const variant of experiment.variants) {
      cumulative += variant.weight;
      if (roll < cumulative) {
        selected = variant;
        break;
      }
    }
    return selected.variantId;
  }

  function recordOutcome(input) {
    const data = requireObject(input, 'recordOutcome input');
    const experiment = lookupExperiment(data.experimentId);
    const scope = partition(experiment.tenantId);
    const variantId = required(data.variantId, 'variantId');
    if (!experiment.variants.some((variant) => variant.variantId === variantId)) fail('unknown_variant', `variant not in experiment: ${variantId}`);
    const reward = Number(data.reward);
    if (!Number.isFinite(reward)) throw new TypeError('reward must be a finite number');
    let stats = scope.experimentStats.get(experiment.experimentId);
    if (!stats) {
      stats = new Map();
      scope.experimentStats.set(experiment.experimentId, stats);
    }
    const arm = stats.get(variantId) ?? { count: 0, rewardSum: 0 };
    const updated = { count: arm.count + 1, rewardSum: arm.rewardSum + reward };
    stats.set(variantId, updated);
    emit(scope, clock(), 'ai.experiment.outcome', { experimentId: experiment.experimentId, variantId, reward, count: updated.count });
    return Object.freeze({
      experimentId: experiment.experimentId,
      variantId,
      count: updated.count,
      rewardSum: updated.rewardSum,
      averageReward: updated.rewardSum / updated.count
    });
  }

  function suggestVariant(input) {
    const data = requireObject(input, 'suggestVariant input');
    const experiment = lookupExperiment(data.experimentId);
    const stats = partition(experiment.tenantId).experimentStats.get(experiment.experimentId);
    let best = null;
    for (const variant of experiment.variants) {
      const arm = stats?.get(variant.variantId);
      const averageReward = arm && arm.count > 0 ? arm.rewardSum / arm.count : 0;
      if (best === null || averageReward > best.averageReward) {
        best = { variantId: variant.variantId, averageReward };
      }
    }
    return best.variantId;
  }

  function listEvents(tenantId) {
    return Object.freeze([...partition(tenantId).events]);
  }

  function listProvenance(tenantId) {
    return Object.freeze([...partition(tenantId).provenance.values()]);
  }

  function getProvenance(tenantId, provenanceId) {
    const record = partition(tenantId).provenance.get(required(provenanceId, 'provenanceId'));
    if (!record) fail('unknown_provenance', `provenance not found: ${provenanceId}`);
    return record;
  }

  function getRenderedPrompt(tenantId, renderedPromptHash) {
    const record = partition(tenantId).renderedPrompts.get(required(renderedPromptHash, 'renderedPromptHash'));
    if (!record) fail('unknown_rendered_prompt', `rendered prompt not found: ${renderedPromptHash}`);
    return record;
  }

  function getSpend(tenantId) {
    const scope = partition(tenantId);
    return Object.freeze({ tenantId: scope.tenantId, spentMinorUnits: scope.spendMinorUnits, budgetMinorUnits: spendBudgetMinorUnits });
  }

  return Object.freeze({
    registerProvider,
    registerPromptTemplate,
    registerAgent,
    render,
    generate,
    invokeTool,
    runAgent,
    createExperiment,
    selectVariant,
    recordOutcome,
    suggestVariant,
    listEvents,
    listProvenance,
    getProvenance,
    getRenderedPrompt,
    getSpend
  });
}
