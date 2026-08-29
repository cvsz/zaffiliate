import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createMigrator } from '../packages/db/src/migrator.js';
import { createDbClient } from '../packages/db/src/client.js';

const M001 = "BEGIN;\nCREATE TABLE demo_a (id int PRIMARY KEY);\nCOMMIT;";
const M002 = "BEGIN;\nCREATE TABLE demo_b (id int PRIMARY KEY);\nCOMMIT;";

async function tempMigrations(files) {
  const dir = await mkdtemp(join(tmpdir(), 'zaff-migrations-'));
  for (const [name, content] of files) {
    await writeFile(join(dir, name), content);
  }
  return dir;
}

function sha(content) {
  return createHash('sha256').update(content).digest('hex');
}

function fakeClient({ appliedRows = [], failOn = null } = {}) {
  const statements = [];
  return {
    statements,
    async query(text, params) {
      if (failOn && new RegExp(failOn, 'i').test(text)) throw new Error(`forced failure: ${failOn}`);
      statements.push(String(text).replace(/\s+/g, ' ').trim());
      if (/FROM\s+schema_migrations/i.test(text) && !/CREATE TABLE/i.test(text)) return { rows: appliedRows };
      return { rows: [] };
    }
  };
}

test('migrator lists local migrations sorted with checksums', async () => {
  const dir = await tempMigrations([['0002_b.sql', M002], ['0001_a.sql', M001]]);
  try {
    const migrator = createMigrator({ client: fakeClient(), migrationsDir: dir });
    const local = await migrator.listLocal();
    assert.deepEqual(local.map((m) => m.id), ['0001_a', '0002_b']);
    assert.equal(local[0].checksum, sha(M001));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('empty database state plans every migration as pending', async () => {
  const dir = await tempMigrations([['0001_a.sql', M001]]);
  try {
    const plan = await createMigrator({ client: fakeClient(), migrationsDir: dir }).plan();
    assert.equal(plan.pending.length, 1);
    assert.equal(plan.applied.length, 0);
    assert.equal(plan.drift.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('applyAll wraps unwrapped file bodies plus checksum record in one transaction per migration', async () => {
  const dir = await tempMigrations([['0001_a.sql', M001], ['0002_b.sql', M002]]);
  try {
    const client = fakeClient();
    const result = await createMigrator({ client, migrationsDir: dir }).applyAll();
    assert.deepEqual(result.applied, ['0001_a', '0002_b']);
    const begins = client.statements.filter((s) => s === 'BEGIN');
    const commits = client.statements.filter((s) => s === 'COMMIT');
    assert.equal(begins.length, 2);
    assert.equal(commits.length, 2);
    const inserts = client.statements.filter((s) => s.startsWith('INSERT INTO schema_migrations'));
    assert.equal(inserts.length, 2);
    const bodyA = client.statements.find((s) => s.includes('demo_a'));
    assert.ok(!bodyA.startsWith('BEGIN'), 'file-level transaction wrapper must be unwrapped');
    const secondPlan = await createMigrator({
      client: fakeClient({
        appliedRows: [
          { id: '0001_a', checksum: sha(M001) },
          { id: '0002_b', checksum: sha(M002) }
        ]
      }),
      migrationsDir: dir
    }).plan();
    assert.equal(secondPlan.pending.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('checksum drift fails closed before executing any migration', async () => {
  const dir = await tempMigrations([['0001_a.sql', M001]]);
  try {
    const client = fakeClient({
      appliedRows: [{ id: '0001_a', checksum: 'deadbeef'.repeat(8) }]
    });
    const migrator = createMigrator({ client, migrationsDir: dir });
    const plan = await migrator.plan();
    assert.equal(plan.drift.length, 1);
    assert.equal(plan.drift[0].id, '0001_a');
    await assert.rejects(() => migrator.applyAll(), /drift detected/i);
    const mutating = /(INSERT|UPDATE|DELETE|DROP|ALTER|demo_a)/i;
    assert.ok(client.statements.every((s) => !mutating.test(s)), 'no migration or data writes may occur under drift');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('already-applied matching migrations are skipped without re-execution', async () => {
  const dir = await tempMigrations([['0001_a.sql', M001], ['0002_b.sql', M002]]);
  try {
    const client = fakeClient({ appliedRows: [{ id: '0001_a', checksum: sha(M001) }] });
    const result = await createMigrator({ client, migrationsDir: dir }).applyAll();
    assert.deepEqual(result.applied, ['0002_b']);
    assert.equal(result.skipped.length, 1);
    assert.ok(!client.statements.some((s) => s.includes('demo_a')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('client.check reports reachability without leaking connection material', async () => {
  const unreachable = createDbClient({ connectionString: 'postgresql://nobody:nope@127.0.0.1:1/nope' });
  const status = await unreachable.check();
  assert.equal(status.reachable, false);
  assert.ok(!JSON.stringify(status).includes('nope'), 'credentials must never appear in check output');
  await unreachable.close();
});

test('integration against real postgres when reachable', async (t) => {
  const client = createDbClient({});
  const status = await client.check();
  if (!status.reachable) {
    t.skip(`postgres not reachable (${status.reason})`);
    await client.close();
    return;
  }
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
  const migrator = createMigrator({ client, migrationsDir });
  const first = await migrator.applyAll();
  assert.ok(Array.isArray(first.applied));
  const second = await migrator.applyAll();
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.drift, []);
  await client.close();
});
