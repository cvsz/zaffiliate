export class ConfigError extends Error {
  constructor(issues) {
    super(`configuration validation failed: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
    this.name = 'ConfigError';
    this.code = 'CONFIG_VALIDATION_FAILED';
    this.issues = Object.freeze(issues);
  }
}

const APP_ENVIRONMENTS = Object.freeze(['development', 'test', 'production']);
const LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);
const MIN_SECRET_LENGTH = 32;

function issue(path, message) {
  return { path, message };
}

function parsePort(raw) {
  if (raw == null || String(raw).trim() === '') return { value: 8080 };
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: issue('PORT', 'must be an integer between 1 and 65535') };
  }
  return { value: port };
}

function parseServiceUrl(raw, path, allowedSchemes) {
  const value = String(raw ?? '').trim();
  if (!value) return { value: null };
  try {
    const parsed = new URL(value);
    if (!allowedSchemes.includes(parsed.protocol.replace(':', ''))) {
      return { error: issue(path, `scheme must be one of ${allowedSchemes.join('/')}`) };
    }
    return { value: parsed.toString() };
  } catch {
    return { error: issue(path, 'must be a valid URL') };
  }
}

function parseSecret(raw, path, requiredInProduction, appEnv, issues) {
  const value = raw == null ? '' : String(raw);
  if (!value.trim()) {
    if (appEnv === 'production' && requiredInProduction) {
      issues.push(issue(path, 'is required in production'));
    }
    return false;
  }
  if (value.length < MIN_SECRET_LENGTH) {
    issues.push(issue(path, `must be at least ${MIN_SECRET_LENGTH} characters`));
    return false;
  }
  return true;
}

export function loadConfig(env = process.env) {
  const issues = [];
  const appEnvRaw = String(env.APP_ENV ?? 'development').trim().toLowerCase();
  if (!APP_ENVIRONMENTS.includes(appEnvRaw)) {
    issues.push(issue('APP_ENV', `must be one of ${APP_ENVIRONMENTS.join(', ')}`));
  }
  const appEnv = appEnvRaw;

  const portResult = parsePort(env.PORT);
  if (portResult.error) issues.push(portResult.error);

  const database = parseServiceUrl(env.DATABASE_URL, 'DATABASE_URL', ['postgresql', 'postgres']);
  if (database.error) issues.push(database.error);

  const redis = parseServiceUrl(env.REDIS_URL, 'REDIS_URL', ['redis', 'rediss']);
  if (redis.error) issues.push(redis.error);

  const logLevelRaw = String(env.LOG_LEVEL ?? 'info').trim().toLowerCase();
  if (!LOG_LEVELS.includes(logLevelRaw)) {
    issues.push(issue('LOG_LEVEL', `must be one of ${LOG_LEVELS.join(', ')}`));
  }

  const sessionSecretPresent = parseSecret(env.SESSION_SECRET, 'SESSION_SECRET', true, appEnv, issues);
  const encryptionKeyPresent = parseSecret(env.ENCRYPTION_KEY, 'ENCRYPTION_KEY', false, appEnv, issues);

  if (appEnv === 'production') {
    if (!String(env.DATABASE_URL ?? '').trim()) issues.push(issue('DATABASE_URL', 'is required in production'));
    if (!String(env.REDIS_URL ?? '').trim()) issues.push(issue('REDIS_URL', 'is required in production'));
  }

  if (issues.length > 0) throw new ConfigError(issues);

  return Object.freeze({
    appEnv,
    port: portResult.value,
    databaseUrl: database.value,
    redisUrl: redis.value,
    logLevel: logLevelRaw,
    sessionSecretPresent,
    encryptionKeyPresent,
    visitorSalt: String(env.VISITOR_SALT ?? '').trim() || null
  });
}
