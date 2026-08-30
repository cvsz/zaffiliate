import { createAffiliateRuntime } from '../../../packages/affiliate-core/src/runtime.js';
import { createAffiliateCoreRepo } from '../../../packages/db/src/affiliate-core-repo.js';
import { createDbClient } from '../../../packages/db/src/client.js';

export function affiliateRuntimeBackend(env = process.env) {
  const explicit = String(env.AFFILIATE_RUNTIME_BACKEND ?? '').trim().toLowerCase();
  if (explicit) {
    if (!['memory', 'postgres'].includes(explicit)) throw new Error(`unsupported AFFILIATE_RUNTIME_BACKEND: ${explicit}`);
    return explicit;
  }
  const production = String(env.NODE_ENV ?? '').toLowerCase() === 'production' || String(env.APP_ENV ?? '').toLowerCase() === 'production';
  return production ? 'postgres' : 'memory';
}

export function createAffiliateRuntimeForEnv({ env = process.env, logger = null, clock = () => Date.now() } = {}) {
  const backend = affiliateRuntimeBackend(env);
  if (backend === 'memory') return createAffiliateRuntime({ clock });
  const connectionString = String(env.DATABASE_URL ?? '').trim();
  if (!connectionString) {
    const error = new Error('DATABASE_URL is required for AFFILIATE_RUNTIME_BACKEND=postgres');
    error.code = 'AFFILIATE_DATABASE_REQUIRED';
    throw error;
  }
  const db = createDbClient({ connectionString, logger });
  return createAffiliateCoreRepo({ db, clock });
}
