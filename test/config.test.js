import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../packages/config/src/index.js';

const DEV_DB = 'postgresql://zaffiliate:zaffiliate@127.0.0.1:5432/zaffiliate';

test('development defaults parse without any environment variables', () => {
  const config = loadConfig({});
  assert.equal(config.appEnv, 'development');
  assert.equal(config.port, 8080);
  assert.equal(config.databaseUrl, null);
  assert.equal(config.redisUrl, null);
});

test('provided values are normalized and returned frozen', () => {
  const config = loadConfig({ APP_ENV: ' PRODUCTION ', PORT: '9000', DATABASE_URL: DEV_DB, REDIS_URL: 'redis://127.0.0.1:6379/0', LOG_LEVEL: 'warn', SESSION_SECRET: 's'.repeat(32) });
  assert.equal(config.appEnv, 'production');
  assert.equal(config.port, 9000);
  assert.equal(config.logLevel, 'warn');
  assert.ok(Object.isFrozen(config));
});

test('invalid app environment enum fails fast', () => {
  const error = capture(() => loadConfig({ APP_ENV: 'staging-prod-xyz' }));
  assert.ok(error instanceof ConfigError);
  assert.ok(error.issues.some((issue) => issue.path === 'APP_ENV'));
});

function capture(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

test('non-integer or out-of-range ports fail fast', () => {
  for (const bad of ['abc', '0', '70000', '-1']) {
    const error = capture(() => loadConfig({ PORT: bad }));
    assert.ok(error instanceof ConfigError, `port ${bad} must be rejected`);
    assert.ok(error.issues.some((issue) => issue.path === 'PORT'));
  }
});

test('malformed service URLs fail fast', () => {
  const error = capture(() => loadConfig({ DATABASE_URL: 'not-a-url', REDIS_URL: 'https://wrong-scheme' }));
  assert.ok(error instanceof ConfigError);
  assert.ok(error.issues.some((issue) => issue.path === 'DATABASE_URL'));
  assert.ok(error.issues.some((issue) => issue.path === 'REDIS_URL'));
});

test('production requires database, redis and a strong session secret', () => {
  const error = capture(() => loadConfig({ APP_ENV: 'production' }));
  assert.ok(error instanceof ConfigError);
  const paths = error.issues.map((issue) => issue.path).sort();
  assert.deepEqual(paths, ['DATABASE_URL', 'REDIS_URL', 'SESSION_SECRET']);

  const weak = capture(() => loadConfig({ APP_ENV: 'production', DATABASE_URL: DEV_DB, REDIS_URL: 'redis://r:6379/0', SESSION_SECRET: 'short' }));
  assert.ok(weak.issues.some((issue) => issue.path === 'SESSION_SECRET'));

  const ok = loadConfig({
    APP_ENV: 'production',
    DATABASE_URL: DEV_DB,
    REDIS_URL: 'redis://r:6379/0',
    SESSION_SECRET: 'a'.repeat(32),
    ENCRYPTION_KEY: 'b'.repeat(32)
  });
  assert.equal(ok.appEnv, 'production');
});

test('secrets shorter than 32 characters are rejected whenever provided', () => {
  const error = capture(() => loadConfig({ SESSION_SECRET: 'x'.repeat(31) }));
  assert.ok(error.issues.some((issue) => issue.path === 'SESSION_SECRET'));
  const fine = loadConfig({ SESSION_SECRET: 'y'.repeat(64) });
  assert.equal(fine.sessionSecretPresent, true);
});

test('config never echoes secret material in issue messages', () => {
  const error = capture(() => loadConfig({ APP_ENV: 'production', DATABASE_URL: DEV_DB, REDIS_URL: 'redis://r:6379/0', SESSION_SECRET: 'short-but-secret-value' }));
  assert.ok(!JSON.stringify(error.issues).includes('secret-value'));
});
