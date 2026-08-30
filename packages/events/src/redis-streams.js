const MEMORY_LIMIT_PER_STREAM = 10000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DLQ_CAPACITY = 1000;

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`);
  return number;
}

function fieldsFromEnvelope({ tenantId, type, payload = {}, eventId }) {
  return [
    'tenantId', requireText(tenantId, 'tenantId'),
    'type', requireText(type, 'type'),
    'eventId', String(eventId ?? ''),
    'payload', JSON.stringify(payload ?? {})
  ];
}

export function createStreamPublisher({ client = null, allowMemoryFallback = process.env.NODE_ENV !== 'production' } = {}) {
  let resolvedClient = client;
  let backend = client ? 'redis' : 'unresolved';
  const memory = new Map();

  async function resolveBackend() {
    if (resolvedClient) {
      backend = 'redis';
      return { kind: 'redis', client: resolvedClient };
    }
    if (process.env.REDIS_URL) {
      try {
        const mod = await import('ioredis');
        const Redis = mod.default ?? mod;
        resolvedClient = new Redis(process.env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 2 });
        backend = 'redis';
        return { kind: 'redis', client: resolvedClient };
      } catch (error) {
        if (!allowMemoryFallback) {
          throw new Error(`Redis is configured but no usable Redis client is available: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (!allowMemoryFallback) throw new Error('Redis client is required when memory fallback is disabled');
    backend = 'memory';
    return { kind: 'memory' };
  }

  async function publish({ stream, tenantId, type, payload = {}, eventId }) {
    const streamName = requireText(stream, 'stream');
    const fields = fieldsFromEnvelope({ tenantId, type, payload, eventId });

    if (backend === 'unresolved') await resolveBackend();

    if (backend === 'redis' && resolvedClient) {
      await resolvedClient.xadd(streamName, '*', ...fields);
      return { backend: 'redis', stream: streamName };
    }

    const list = memory.get(streamName) ?? [];
    list.push(Object.freeze({
      tenantId: fields[1],
      type: fields[3],
      eventId: fields[5],
      payload: Object.freeze(JSON.parse(fields[7]))
    }));
    if (list.length > MEMORY_LIMIT_PER_STREAM) list.shift();
    memory.set(streamName, list);
    return { backend: 'memory', stream: streamName };
  }

  function memorySize(streamName) {
    return (memory.get(String(streamName).trim()) ?? []).length;
  }

  function backendKind() {
    return backend;
  }

  return Object.freeze({ publish, memorySize, backendKind });
}

function fieldArrayToObject(fields) {
  if (!Array.isArray(fields)) return fields && typeof fields === 'object' ? fields : {};
  const out = {};
  for (let index = 0; index < fields.length; index += 2) out[String(fields[index])] = String(fields[index + 1] ?? '');
  return out;
}

export function decodeStreamEntry(entry) {
  const tuple = Array.isArray(entry) ? entry : [entry?.id, entry?.fields ?? entry?.message];
  const id = requireText(tuple[0], 'stream entry id');
  const fields = fieldArrayToObject(tuple[1]);
  let payload;
  try {
    payload = JSON.parse(String(fields.payload ?? '{}'));
  } catch {
    throw new Error(`stream entry ${id} contains invalid JSON payload`);
  }
  return Object.freeze({
    id,
    eventId: String(fields.eventId ?? ''),
    tenantId: requireText(fields.tenantId, 'tenantId'),
    type: requireText(fields.type, 'type'),
    payload: Object.freeze(payload && typeof payload === 'object' ? payload : {})
  });
}

export function createRedisIdempotencyStore({ client, prefix = 'zaffiliate:dedupe', ttlMs = DEFAULT_DEDUPE_TTL_MS } = {}) {
  if (!client || typeof client.set !== 'function' || typeof client.del !== 'function') throw new TypeError('Redis client with set/del is required');
  const ttl = positiveInteger(ttlMs, 'ttlMs');
  const namespace = requireText(prefix, 'prefix');

  async function reserve(key, overrideTtlMs = ttl) {
    const normalized = requireText(key, 'idempotency key');
    const result = await client.set(`${namespace}:${normalized}`, '1', 'PX', positiveInteger(overrideTtlMs, 'ttlMs'), 'NX');
    return result === 'OK';
  }

  async function release(key) {
    await client.del(`${namespace}:${requireText(key, 'idempotency key')}`);
  }

  return Object.freeze({ reserve, release, ttlMs: ttl });
}

function normalizeReadGroupReply(reply) {
  if (!Array.isArray(reply)) return [];
  const entries = [];
  for (const streamReply of reply) {
    if (!Array.isArray(streamReply) || !Array.isArray(streamReply[1])) continue;
    for (const entry of streamReply[1]) entries.push(entry);
  }
  return entries;
}

function normalizeAutoClaimReply(reply) {
  if (!Array.isArray(reply)) return [];
  return Array.isArray(reply[1]) ? reply[1] : [];
}

export function createDurableStreamConsumer({
  client,
  stream,
  group = 'zaffiliate-workers',
  consumer = `worker-${process.pid}`,
  deadLetterStream = null,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  deadLetterCapacity = DEFAULT_DLQ_CAPACITY,
  dedupeStore = null,
  dedupeTtlMs = DEFAULT_DEDUPE_TTL_MS,
  minIdleMs = 30_000,
  batchSize = 25
} = {}) {
  if (!client) throw new TypeError('Redis client is required');
  for (const method of ['xgroup', 'xreadgroup', 'xack', 'xadd', 'incr', 'pexpire', 'del']) {
    if (typeof client[method] !== 'function') throw new TypeError(`Redis client.${method} is required`);
  }
  const streamName = requireText(stream, 'stream');
  const groupName = requireText(group, 'group');
  const consumerName = requireText(consumer, 'consumer');
  const dlqName = deadLetterStream ? requireText(deadLetterStream, 'deadLetterStream') : `${streamName}:dlq`;
  const attemptsLimit = positiveInteger(maxAttempts, 'maxAttempts');
  const capacity = positiveInteger(deadLetterCapacity, 'deadLetterCapacity');
  const dedupeTtl = positiveInteger(dedupeTtlMs, 'dedupeTtlMs');
  const idleMs = positiveInteger(minIdleMs, 'minIdleMs');
  const count = positiveInteger(batchSize, 'batchSize');
  let groupReady = false;

  async function ensureGroup() {
    if (groupReady) return;
    try {
      await client.xgroup('CREATE', streamName, groupName, '0', 'MKSTREAM');
    } catch (error) {
      if (!String(error?.message ?? error).includes('BUSYGROUP')) throw error;
    }
    groupReady = true;
  }

  async function quarantine(entry, attempts, error) {
    await client.xadd(
      dlqName,
      'MAXLEN', '~', capacity,
      '*',
      'sourceId', entry.id,
      'eventId', entry.eventId,
      'tenantId', entry.tenantId,
      'type', entry.type,
      'payload', JSON.stringify(entry.payload),
      'attempts', String(attempts),
      'error', error instanceof Error ? error.message : String(error),
      'failedAt', new Date().toISOString()
    );
    await client.xack(streamName, groupName, entry.id);
  }

  async function deliver(rawEntry, handler) {
    const entry = decodeStreamEntry(rawEntry);
    const attemptKey = `zaffiliate:attempts:${streamName}:${groupName}:${entry.id}`;
    const attempts = Number(await client.incr(attemptKey));
    await client.pexpire(attemptKey, 7 * 24 * 60 * 60 * 1000);

    const dedupeKey = entry.eventId || `${streamName}:${entry.id}`;
    let reserved = false;
    if (dedupeStore) {
      reserved = await dedupeStore.reserve(dedupeKey, dedupeTtl);
      if (!reserved) {
        await client.xack(streamName, groupName, entry.id);
        await client.del(attemptKey);
        return Object.freeze({ status: 'duplicate', entry, attempts });
      }
    }

    try {
      await handler(entry);
    } catch (error) {
      if (reserved) await dedupeStore.release(dedupeKey);
      if (attempts >= attemptsLimit) {
        await quarantine(entry, attempts, error);
        await client.del(attemptKey);
        return Object.freeze({ status: 'dead-lettered', entry, attempts });
      }
      return Object.freeze({ status: 'retry', entry, attempts });
    }

    await client.xack(streamName, groupName, entry.id);
    await client.del(attemptKey);
    return Object.freeze({ status: 'acked', entry, attempts });
  }

  async function consumeOnce(handler, { blockMs = 0 } = {}) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    await ensureGroup();
    const readArgs = ['GROUP', groupName, consumerName, 'COUNT', count];
    const requestedBlockMs = Math.max(0, Number(blockMs) || 0);
    if (requestedBlockMs > 0) readArgs.push('BLOCK', requestedBlockMs);
    readArgs.push('STREAMS', streamName, '>');
    const reply = await client.xreadgroup(...readArgs);
    const results = [];
    for (const entry of normalizeReadGroupReply(reply)) results.push(await deliver(entry, handler));
    return Object.freeze(results);
  }

  async function reclaimOnce(handler) {
    if (typeof client.xautoclaim !== 'function') throw new TypeError('Redis client.xautoclaim is required for pending-message reclaim');
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    await ensureGroup();
    const reply = await client.xautoclaim(streamName, groupName, consumerName, idleMs, '0-0', 'COUNT', count);
    const results = [];
    for (const entry of normalizeAutoClaimReply(reply)) results.push(await deliver(entry, handler));
    return Object.freeze(results);
  }

  return Object.freeze({ ensureGroup, consumeOnce, reclaimOnce, stream: streamName, group: groupName, consumer: consumerName, deadLetterStream: dlqName });
}
