import { randomUUID } from 'node:crypto';

const CONFIDENCE_TIERS = new Set(['HIGH', 'MEDIUM', 'LOW']);
const FEEDBACK_DECISIONS = new Set(['ACCEPTED', 'REJECTED', 'MODIFIED', 'IGNORED']);

function mint(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

export function createTrainingDatasetStore({ clock = () => Date.now() } = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const partitions = new Map();

  function partition(tenantId) {
    const id = requireText(tenantId, 'tenantId');
    let scope = partitions.get(id);
    if (!scope) {
      scope = [];
      partitions.set(id, scope);
    }
    return scope;
  }

  function create({ tenantId, labelDefinition, timeRange, rowCount, featureSetVersions = {}, scope = 'ORGANIZATION' }) {
    const id = requireText(tenantId, 'tenantId');
    requireText(tenantLabel(labelDefinition), 'label definition');
    const from = new Date(timeRange?.from ?? '');
    const to = new Date(timeRange?.to ?? '');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error('timeRange must contain valid timestamps');
    if (to.getTime() <= from.getTime()) throw new Error('timeRange.to must be after timeRange.from');
    const rows = Number(rowCount);
    if (!Number.isInteger(rows) || rows < 0) throw new Error('rowCount must be a non-negative integer');

    const list2 = partition(id);
    const dataset = Object.freeze({
      datasetId: mint('ds'),
      created_at: new Date(clock()).toISOString(),
      tenant_id: id,
      scope: String(scope).toUpperCase(),
      label_definition: Object.freeze(JSON.parse(JSON.stringify(labelDefinition))),
      time_range: Object.freeze({ from: from.toISOString(), to: to.toISOString() }),
      row_count: rows,
      feature_set_versions: Object.freeze(JSON.parse(JSON.stringify(featureSetVersions)))
    });
    list2.push(dataset);
    return dataset;
  }

  function tenantLabel(definition) {
    return definition == null ? '' : String(definition.name ?? '');
  }

  function list(tenantId) {
    return Object.freeze([...(partitions.get(requireText(tenantId, 'tenantId')) ?? [])]);
  }

  return Object.freeze({ create, list });
}

export function createPredictionStore({ clock = () => Date.now() } = {}) {
  const partitions = new Map();

  function save({ tenantId, model, modelVersion, entity, featuresVersion = {}, prediction, confidence, validUntil }) {
    const scope = partition(tenantId);
    const modelKey = `${requireText(model, 'model')}@${requireText(modelVersion, 'modelVersion')}`;
    if (!CONFIDENCE_TIERS.has(String(confidence ?? '').toUpperCase())) {
      throw new Error(`unsupported confidence tier: ${confidence}`);
    }
    const expiry = new Date(validUntil ?? '');
    if (Number.isNaN(expiry.getTime())) throw new Error('validUntil must be a valid timestamp');
    if (expiry.getTime() <= clock()) throw new Error('validUntil must be in the future');
    requireText(entity?.id, 'entity.id');

    const record = Object.freeze({
      predictionId: mint('prd'),
      createdAt: new Date(clock()).toISOString(),
      model,
      modelVersion,
      entityType: requireText(entity.type, 'entity.type'),
      entityId: String(entity.id).trim(),
      featuresVersion: Object.freeze(JSON.parse(JSON.stringify(featuresVersion))),
      prediction: Object.freeze(JSON.parse(JSON.stringify(prediction))),
      confidence: String(confidence).toUpperCase(),
      validUntil: expiry.toISOString()
    });
    const key = `${entityType(record)}:${record.entityId}`;
    const list2 = scope.byEntity.get(key) ?? [];
    list2.push(record);
    scope.byEntity.set(key, list2);
    return record;
  }

  function entityType(record) {
    return record.entityType;
  }

  function partition(tenantId) {
    const id = requireText(tenantId, 'tenantId');
    let scope = partitions.get(id);
    if (!scope) {
      scope = { byEntity: new Map(), byModel: new Map() };
      partitions.set(id, scope);
    }
    return scope;
  }

  function historyFor(scope, model, entityId) {
    return scope.byModel.get(`${requireText(model, 'model')}@`) ?? [];
  }

  function latest(tenantId, model, entityId) {
    const scope = partition(tenantId);
    const nowMs = clock();
    let best = null;
    for (const [, records] of scope.byEntity) {
      for (const record of records) {
        if (record.model !== model || record.entityId !== String(entityId ?? '').trim()) continue;
        if (new Date(record.validUntil).getTime() <= nowMs) continue;
        if (best == null || record.createdAt >= best.createdAt) best = record;
      }
    }
    void historyFor;
    return best;
  }

  function history(tenantId, model, entityId) {
    const scope = partition(tenantId);
    const out = [];
    for (const [, records] of scope.byEntity) {
      for (const record of records) {
        if (record.model === model && record.entityId === String(entityId ?? '').trim()) out.push(record);
      }
    }
    return Object.freeze(out.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }

  return Object.freeze({ save, latest, history });
}

export function createRecommendationStore({ clock = () => Date.now() } = {}) {
  const partitions = new Map();

  function save({ tenantId, type, subjectId, productId, score, confidence, explanation, expiresAt, modelVersion }) {
    const scope = partition(tenantId);
    const record = Object.freeze({
      recommendationId: mint('rcm'),
      tenantId,
      type: requireText(type, 'type').toUpperCase(),
      subjectId: String(subjectId ?? productId ?? '').trim(),
      score: Number(score ?? 0),
      confidence: String(confidence ?? 'LOW').toUpperCase(),
      explanation: Object.freeze(JSON.parse(JSON.stringify(explanation ?? { reasons: [] }))),
      modelVersion: requireText(modelVersion ?? 'unknown', 'modelVersion'),
      status: 'ACTIVE',
      feedback: null,
      expiresAt
    });
    scope.byId.set(record.recommendationId, record);
    return record;
  }

  function feedback(tenantId, recommendationId, { decision, actorId, reason = '' }) {
    const normalizedDecision = String(decision ?? '').toUpperCase();
    if (!FEEDBACK_DECISIONS.has(normalizedDecision)) throw new Error(`unsupported feedback decision: ${decision}`);
    const scope = partition(tenantId);
    const record = scope.byId.get(requireText(recommendationId, 'recommendationId'));
    if (!record || record.tenantId !== tenantId) throw new Error(`recommendation ${recommendationId} not found`);
    if (['ACCEPTED', 'REJECTED', 'MODIFIED', 'IGNORED'].includes(record.status)) return record;

    const expired = new Date(record.expiresAt ?? 0).getTime() <= clock();
    let nextStatus = normalizedDecision;
    if (expired && normalizedDecision === 'ACCEPTED') nextStatus = 'EXPIRED';

    const updated = Object.freeze({
      ...record,
      status: nextStatus,
      feedback: Object.freeze({
        decision: normalizedDecision,
        actorId: requireText(actorId, 'actorId'),
        reason: String(reason ?? '').slice(0, 512),
        at: new Date(clock()).toISOString()
      })
    });
    scope.byId.set(recommendationId, updated);
    return updated;
  }

  function list(tenantId) {
    return Object.freeze([...(partitions.get(requireText(tenantId, 'tenantId'))?.byId?.values() ?? [])]);
  }

  function partition(tenantId) {
    const id = requireText(tenantId, 'tenantId');
    let scope = partitions.get(id);
    if (!scope) {
      scope = { byId: new Map() };
      partitions.set(id, scope);
    }
    return scope;
  }

  return Object.freeze({ save, feedback, list });
}
