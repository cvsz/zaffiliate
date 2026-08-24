import { setDefaultResultOrder } from 'node:dns';

export function createDbClient({ connectionString = process.env.DATABASE_URL || null, poolFactory = null, logger = null } = {}) {
  if (poolFactory != null && typeof poolFactory !== 'function') throw new TypeError('poolFactory must be a function');
  let pool = null;
  let connecting = null;

  function log(event, fields) {
    if (logger && typeof logger.info === 'function') logger.info(event, fields);
  }

  async function getPool() {
    if (pool) return pool;
    if (!connecting) {
      connecting = (async () => {
        try { setDefaultResultOrder('ipv4first'); } catch { void 0; }
        let Pool;
        if (poolFactory) {
          Pool = await poolFactory();
        } else {
          const pg = await import('pg');
          Pool = pg.default ? pg.default.Pool : pg.Pool;
        }
        if (!connectionString) {
          const error = new Error('DATABASE_URL is not configured');
          error.code = 'DB_NOT_CONFIGURED';
          throw error;
        }
        const host = new URL(connectionString).hostname;
        const local = ['localhost', '127.0.0.1', '::1', 'postgres', 'db'].includes(host);
        return new Pool({
          connectionString,
          max: 5,
          connectionTimeoutMillis: 5000,
          ssl: local ? false : { rejectUnauthorized: false }
        });
      })();
    }
    try {
      pool = await connecting;
      return pool;
    } catch (error) {
      connecting = null;
      throw error;
    }
  }

  async function query(text, params) {
    if (typeof text !== 'string' || !text.trim()) throw new TypeError('query text is required');
    const active = await getPool();
    return active.query(text, params);
  }

  async function transaction(fn) {
    if (typeof fn !== 'function') throw new TypeError('transaction body must be a function');
    const active = await getPool();
    const client = await active.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({
        query: (text, params) => client.query(text, params)
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        log('db_rollback_failed', {});
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function check() {
    const startedAt = Date.now();
    try {
      const active = await getPool();
      await active.query('SELECT 1');
      return { reachable: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        reachable: false,
        reason: error?.code === 'DB_NOT_CONFIGURED' ? 'not_configured' : 'unreachable',
        latencyMs: Date.now() - startedAt
      };
    }
  }

  async function close() {
    connecting = null;
    if (!pool) return;
    const closing = pool;
    pool = null;
    await closing.end();
  }

  return Object.freeze({ query, transaction, check, close });
}
