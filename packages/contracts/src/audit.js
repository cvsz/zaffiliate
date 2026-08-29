import { createHash } from 'node:crypto';

const ACTOR_TYPES = Object.freeze(['user', 'service', 'system']);
const OUTCOMES = Object.freeze(['allow', 'deny']);
export const GENESIS_HASH = Object.freeze('0'.repeat(64));

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}

function sha256Hex(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function requireNonEmptyString(value, label) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('audit event is required');
  const tenantId = requireNonEmptyString(event.tenantId, 'tenantId');
  if (!event.actor || typeof event.actor !== 'object') throw new TypeError('actor is required');
  const actorId = requireNonEmptyString(event.actor.id, 'actor.id');
  const actorType = String(event.actor.type || '').trim();
  if (!ACTOR_TYPES.includes(actorType)) throw new Error(`unsupported actor type: ${actorType}`);
  const action = requireNonEmptyString(event.action, 'action');
  if (!event.resource || typeof event.resource !== 'object') throw new TypeError('resource is required');
  const resourceType = requireNonEmptyString(event.resource.type, 'resource.type');
  const resourceId = requireNonEmptyString(event.resource.id, 'resource.id');
  const outcome = String(event.outcome || '').trim();
  if (!OUTCOMES.includes(outcome)) throw new Error(`unsupported outcome: ${outcome}`);
  let traceId = null;
  if (event.traceId != null) traceId = requireNonEmptyString(event.traceId, 'traceId');
  return { tenantId, actor: { id: actorId, type: actorType }, action, resource: { type: resourceType, id: resourceId }, outcome, traceId };
}

function entryWithoutHashes(entry) {
  const { prevHash, entryHash, ...rest } = entry;
  return rest;
}

function computeEntryHash(prevHash, entry) {
  return sha256Hex(String(prevHash) + canonicalJson(entryWithoutHashes(entry)));
}

export function createInMemoryAuditStore({ clock = () => new Date().toISOString() } = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const byTenant = new Map();

  function tenantLog(tenantId) {
    let log = byTenant.get(tenantId);
    if (!log) {
      log = [];
      byTenant.set(tenantId, log);
    }
    return log;
  }

  function append(event) {
    const validated = validateEvent(event);
    const log = tenantLog(validated.tenantId);
    const sequence = log.length + 1;
    const storedAt = clock();
    const occurredAt = event.occurredAt == null ? storedAt : requireNonEmptyString(event.occurredAt, 'occurredAt');
    if (Number.isNaN(Date.parse(occurredAt))) throw new Error('occurredAt must be a valid timestamp');
    const base = { version: 1, sequence, tenantId: validated.tenantId, actor: validated.actor, action: validated.action, resource: validated.resource, outcome: validated.outcome, traceId: validated.traceId, occurredAt, storedAt };
    const prevHash = log.length === 0 ? GENESIS_HASH : log[log.length - 1].entryHash;
    const entryHash = computeEntryHash(prevHash, base);
    const entry = deepFreeze({ ...base, prevHash, entryHash });
    log.push(entry);
    return entry;
  }

  function list(tenantId, { fromSequence, limit, actorId, action, outcome } = {}) {
    const scopedTenantId = requireNonEmptyString(tenantId, 'tenantId');
    const options = { fromSequence, limit, actorId, action, outcome };
    if (options.fromSequence != null) {
      if (!Number.isInteger(options.fromSequence) || options.fromSequence < 1) throw new Error('fromSequence must be a positive integer');
    }
    if (options.limit != null) {
      if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error('limit must be a positive integer');
    }
    if (options.action != null) options.action = requireNonEmptyString(options.action, 'action filter');
    if (options.actorId != null) options.actorId = requireNonEmptyString(options.actorId, 'actorId filter');
    if (options.outcome != null) {
      options.outcome = requireNonEmptyString(options.outcome, 'outcome filter');
      if (!OUTCOMES.includes(options.outcome)) throw new Error(`unsupported outcome: ${options.outcome}`);
    }
    const log = byTenant.get(scopedTenantId) || [];
    const selected = [];
    for (const entry of log) {
      if (entry.sequence < (options.fromSequence ?? 1)) continue;
      if (options.actorId != null && entry.actor.id !== options.actorId) continue;
      if (options.action != null && entry.action !== options.action) continue;
      if (options.outcome != null && entry.outcome !== options.outcome) continue;
      selected.push(entry);
      if (options.limit != null && selected.length >= options.limit) break;
    }
    return deepFreeze(selected.map((entry) => entry));
  }

  function verifyChain(tenantId) {
    const scopedTenantId = requireNonEmptyString(tenantId, 'tenantId');
    const log = byTenant.get(scopedTenantId) || [];
    let expectedPrevHash = GENESIS_HASH;
    for (let index = 0; index < log.length; index += 1) {
      const entry = log[index];
      if (entry.prevHash !== expectedPrevHash || entry.entryHash !== computeEntryHash(expectedPrevHash, entry)) {
        return Object.freeze({ valid: false, brokenAt: index });
      }
      expectedPrevHash = entry.entryHash;
    }
    return Object.freeze({ valid: true });
  }

  function _entriesFor(tenantId) {
    const scopedTenantId = requireNonEmptyString(tenantId, 'tenantId');
    return byTenant.get(scopedTenantId) || [];
  }

  return Object.freeze({ append, list, verifyChain, _entriesFor });
}

export function createAuditPersistenceAdapter(store) {
  if (!store || typeof store.append !== 'function' || typeof store.list !== 'function') {
    throw new TypeError('audit store with append and list is required');
  }
  function record(event) {
    return store.append(event);
  }
  function replay(tenantId, { fromSequence } = {}) {
    const scopedTenantId = requireNonEmptyString(tenantId, 'tenantId');
    if (fromSequence != null && (!Number.isInteger(fromSequence) || fromSequence < 1)) {
      throw new Error('fromSequence must be a positive integer');
    }
    return store.list(scopedTenantId, { fromSequence });
  }
  return Object.freeze({ record, replay });
}
