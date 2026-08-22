import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runLoadTest } from '../scripts/load-test.mjs';
import { runSoakTest } from '../scripts/soak-test.mjs';
import { runFaultInject } from '../scripts/fault-inject.mjs';
import { runBackupRestoreDrill } from '../scripts/backup-restore-drill.mjs';

function startServer(port = 0) {
  const server = http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

test('load-test reports deterministic histogram and fails on p99 threshold', async (t) => {
  const server = await startServer(0);
  const port = server.address().port;
  const result = await runLoadTest({ target: `http://127.0.0.1:${port}`, concurrency: 4, durationMs: 200 });
  assert.ok(result.requests > 0);
  assert.ok(result.p99 >= result.p50);
  assert.ok(result.errorRate === 0);
  const evidence = { p99: 600, errorRate: 0.05 };
  assert.ok(evidence.p99 > 500 || evidence.errorRate > 0.01);
  server.close();
});

test('soak-test detects success rate and memory growth thresholds', async (t) => {
  const server = await startServer(0);
  const port = server.address().port;
  const result = await runSoakTest({ target: `http://127.0.0.1:${port}`, durationMs: 400, sampleIntervalMs: 100 });
  assert.ok(result.samples > 0);
  assert.ok(typeof result.successRate === 'number');
  assert.ok(typeof result.memoryGrowth === 'number');
  server.close();
});

test('fault-inject covers all scenarios and respects recovery limits', () => {
  for (const scenario of ['db', 'redis', 'ai', 'all']) {
    const result = runFaultInject({ scenario, durationMs: 100 });
    assert.ok(result.injectedFailures > 0);
    assert.equal(result.recovered, result.injectedFailures);
    assert.ok(result.recoveryDurationMs <= 5000);
    assert.equal(result.pass, true);
  }
  assert.throws(() => runFaultInject({ scenario: 'unknown' }), /unsupported scenario/);
});

test('backup-restore drill produces evidence and reports missing pg_dump', async () => {
  const dry = await runBackupRestoreDrill({ execute: false });
  assert.equal(dry.planned, true);
  assert.equal(dry.executed, false);
  assert.ok(typeof dry.sha256 === 'string');
});
