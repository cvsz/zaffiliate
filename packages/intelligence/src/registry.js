import { randomUUID } from 'node:crypto';

const STATUSES = new Set(['CANDIDATE', 'VALIDATING', 'SHADOW', 'PRODUCTION', 'RETIRED', 'REJECTED']);
const LEGAL_TRANSITIONS = new Map([
  ['CANDIDATE', ['VALIDATING', 'REJECTED']],
  ['VALIDATING', ['SHADOW', 'REJECTED']],
  ['SHADOW', ['PRODUCTION', 'RETIRED', 'REJECTED']],
  ['PRODUCTION', ['RETIRED']],
  ['RETIRED', ['PRODUCTION']],
  ['REJECTED', []]
]);

function mint(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

export function createModelRegistry({ clock = () => new Date().toISOString(), auditSink = null } = {}) {
  const partitions = new Map();

  function partition() {
    if (!partitions.size) {
      partitions.set('default', { byKey: new Map(), production: new Map() });
    }
    return partitions.get('default');
  }

  function key(modelName, modelVersion) {
    return `${requireText(modelName, 'modelName')}@${requireText(modelVersion, 'modelVersion')}`;
  }

  function register(input) {
    const scope = partition();
    const modelKey = key(input.modelName, input.modelVersion);
    if (scope.byKey.has(modelKey)) throw new Error(`model ${modelKey} already registered`);
    for (const field of ['modelName', 'modelVersion', 'task', 'trainingDatasetId', 'artifactRef']) {
      requireText(input[field], field);
    }
    if (!input.metrics || typeof input.metrics !== 'object') throw new Error('metrics are required at registration');
    const record = Object.freeze({
      registryId: mint('mdl'),
      created_at: clock(),
      status: 'CANDIDATE',
      approved_by: null,
      metrics: Object.freeze(JSON.parse(JSON.stringify(input.metrics))),
      feature_set_versions: Object.freeze(JSON.parse(JSON.stringify(input.featureSetVersions ?? {}))),
      modelName: String(input.modelName).trim(),
      modelVersion: String(input.modelVersion).trim(),
      task: String(input.task).trim(),
      trainingDatasetId: String(input.trainingDatasetId).trim(),
      artifactRef: String(input.artifactRef).trim()
    });
    scope.byKey.set(modelKey, record);
    return record;
  }

  function get(modelName, modelVersion) {
    return partition().byKey.get(key(modelName, modelVersion)) ?? null;
  }

  function transition(modelName, modelVersion, toStatus) {
    if (!STATUSES.has(toStatus)) throw new Error(`unknown model status: ${toStatus}`);
    const scope = partition();
    const modelKey = key(modelName, modelVersion);
    const record = scope.byKey.get(modelKey);
    if (!record) throw new Error(`model ${modelKey} not found`);
    if (record.status === 'PRODUCTION' && toStatus !== 'RETIRED') {
      throw new Error(`illegal transition ${record.status} -> ${toStatus}: demote via promotion of another version or retire explicitly`);
    }
    if (!LEGAL_TRANSITIONS.get(record.status).includes(toStatus)) {
      if (toStatus === 'PRODUCTION') throw new Error(`promotion to PRODUCTION must pass through shadow first (current: ${record.status})`);
      if (['RETIRED', 'REJECTED'].includes(record.status)) throw new Error(`illegal transition from terminal status ${record.status} -> ${toStatus}`);
      throw new Error(`illegal transition ${record.status} -> ${toStatus}`);
    }
    const updated = Object.freeze({ ...record, status: toStatus });
    scope.byKey.set(modelKey, updated);
    if (toStatus === 'RETIRED' && scope.production.get(modelName)?.modelVersion === record.modelVersion) {
      scope.production.delete(modelName);
    }
    return updated;
  }

  function promote(modelName, modelVersion, { approvedBy, isRollback = false } = {}) {
    const scope = partition();
    const modelKey = key(modelName, modelVersion);
    const record = scope.byKey.get(modelKey);
    if (!record) throw new Error(`model ${modelKey} not found`);
    const approver = requireText(approvedBy, 'approvedBy');
    if (record.status !== 'SHADOW' && !(isRollback && record.status === 'RETIRED')) {
      throw new Error(`promotion to PRODUCTION requires SHADOW status${isRollback ? ' or RETIRED for rollback' : ''}; ${record.status} must pass through shadow first`);
    }
    const champion = scope.production.get(modelName);
    if (champion && champion.modelVersion !== record.modelVersion) {
      const demoted = Object.freeze({ ...champion, status: 'RETIRED' });
      scope.byKey.set(key(champion.modelName, champion.modelVersion), demoted);
    }
    const promoted = Object.freeze({ ...record, status: 'PRODUCTION', approved_by: approver });
    scope.byKey.set(modelKey, promoted);
    scope.production.set(modelName, promoted);
    return promoted;
  }

  function reject(modelName, modelVersion, { reason }) {
    requireText(reason, 'reason');
    return transition(modelName, modelVersion, 'REJECTED');
  }

  function getProduction(modelName) {
    return partition().production.get(requireText(modelName, 'modelName')) ?? null;
  }

  const rollbacks = [];

  function rollbackModel(modelName, { toVersion, actorId, reason, auditSink: localSink = null } = {}) {
    const target = get(modelName, toVersion);
    if (!target) throw new Error(`rollback target model ${modelName}@${toVersion} not found`);
    const current = getProduction(modelName);
    if (current && current.modelVersion === toVersion) {
      throw new Error(`${modelName}@${toVersion} is already the active production version`);
    }
    const promoted = promote(modelName, toVersion, { approvedBy: requireText(actorId, 'actorId'), isRollback: true });
    const event = Object.freeze({
      action: 'model.rollback',
      actor: String(actorId).trim(),
      resource: `${modelName}@${toVersion}`,
      detail: Object.freeze({
        reason: String(reason ?? '').slice(0, 512),
        previousVersion: current ? current.modelVersion : null,
        at: clock()
      })
    });
    rollbacks.push(event);
    const sink = localSink ?? auditSink;
    if (sink) sink(event);
    return promoted;
  }

  return Object.freeze({ register, get, transition, promote, reject, getProduction, rollbackModel });
}
