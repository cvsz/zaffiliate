const MEMORY_LIMIT_PER_STREAM = 10000;

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

export function createStreamPublisher({ client = null } = {}) {
  let resolvedClient = client;
  let backend = client ? 'redis' : 'memory';
  const memory = new Map();

  async function resolveBackend() {
    if (resolvedClient) {
      backend = 'redis';
      return { kind: 'redis', client: resolvedClient };
    }
    try {
      const mod = await import('ioredis');
      const Redis = mod.default ?? mod;
      if (process.env.REDIS_URL) {
        resolvedClient = new Redis(process.env.REDIS_URL);
        backend = 'redis';
        return { kind: 'redis', client: resolvedClient };
      }
    } catch {
      void 0;
    }
    backend = 'memory';
    return { kind: 'memory' };
  }

  async function publish({ stream, tenantId, type, payload = {}, eventId }) {
    const streamName = requireText(stream, 'stream');
    const tenant = requireText(tenantId, 'tenantId');
    const eventType = requireText(type, 'type');

    if (backend === 'memory') {
      await resolveBackend();
    }

    if (backend === 'redis' && resolvedClient) {
      const fields = [
        'tenantId', tenant,
        'type', eventType,
        'eventId', String(eventId ?? ''),
        'payload', JSON.stringify(payload ?? {})
      ];
      await resolvedClient.xadd(streamName, '*', ...fields);
      return { backend: 'redis', stream: streamName };
    }

    const list = memory.get(streamName) ?? [];
    list.push(Object.freeze({ tenantId: tenant, type: eventType, eventId: String(eventId ?? ''), payload: Object.freeze(JSON.parse(JSON.stringify(payload ?? {}))) }));
    if (list.length > MEMORY_LIMIT_PER_STREAM) list.shift();
    memory.set(streamName, list);
    return { backend: 'memory', stream: streamName };
  }

  function memorySize(streamName) {
    return (memory.get(String(streamName).trim()) ?? []).length;
  }

  return Object.freeze({ publish, memorySize });
}
