function required(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function command(parts) {
  return parts.map((part) => String(part));
}

function assertRawClient(client) {
  if (!client || typeof client.sendCommand !== 'function') {
    throw new TypeError('node-redis client with sendCommand is required');
  }
  if (typeof client.connect !== 'function') throw new TypeError('node-redis client.connect is required');
  return client;
}

/**
 * Adapts node-redis to the small Redis command surface used by the durable
 * event implementation. Using sendCommand keeps the existing RESP-shaped
 * XREADGROUP/XAUTOCLAIM replies and avoids coupling the domain layer to a
 * client library's command-specific response transformers.
 */
export async function connectNodeRedisCompat({
  url = process.env.REDIS_URL,
  createClientFn = null,
  socket = null
} = {}) {
  const redisUrl = required(url, 'Redis URL');
  let factory = createClientFn;
  if (factory == null) {
    const mod = await import('redis');
    factory = mod.createClient;
  }
  if (typeof factory !== 'function') throw new TypeError('redis createClient function is required');

  const raw = assertRawClient(factory({
    url: redisUrl,
    ...(socket ? { socket } : {})
  }));
  raw.on?.('error', () => undefined);
  await raw.connect();
  let closed = false;

  async function send(name, ...args) {
    if (closed) throw new Error('Redis client is closed');
    return raw.sendCommand(command([name, ...args]));
  }

  const compat = {
    xadd: (...args) => send('XADD', ...args),
    xgroup: (...args) => send('XGROUP', ...args),
    xreadgroup: (...args) => send('XREADGROUP', ...args),
    xautoclaim: (...args) => send('XAUTOCLAIM', ...args),
    xack: (...args) => send('XACK', ...args),
    incr: async (...args) => Number(await send('INCR', ...args)),
    pexpire: async (...args) => Number(await send('PEXPIRE', ...args)),
    del: async (...args) => Number(await send('DEL', ...args)),
    set: (...args) => send('SET', ...args),
    async close() {
      if (closed) return;
      closed = true;
      if (typeof raw.quit === 'function' && raw.isOpen !== false) {
        try { await raw.quit(); return; } catch {}
      }
      if (typeof raw.disconnect === 'function') await raw.disconnect();
    }
  };

  return Object.freeze(compat);
}
