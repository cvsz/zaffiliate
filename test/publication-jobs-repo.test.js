import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicationJobsRepo, PublicationTransitionError } from '../packages/db/src/publication-jobs-repo.js';

const NOW = '2026-08-25T16:00:00.000Z';
const TENANT = '11111111-1111-4111-8111-111111111111';

function scriptedClient(handlers = []) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: String(text).replace(/\s+/g, ' ').trim(), params });
      for (const handler of handlers) {
        const response = handler(text, params);
        if (response !== undefined) return response;
      }
      return { rows: [] };
    }
  };
}

function jobRow(overrides = {}) {
  return {
    tenant_id: TENANT,
    id: '22222222-2222-4222-8222-222222222222',
    content_item_id: null,
    platform: 'tiktok',
    status: 'draft',
    idempotency_key: 'job-key-1',
    attempt: 0,
    max_attempts: 3,
    next_retry_at: null,
    provider_response: null,
    external_content_id: null,
    failure_code: null,
    failure_reason: null,
    scheduled_for: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides
  };
}

test('create persists a parameterized row and returns the created job', async () => {
  let insertCount = 0;
  const client = scriptedClient([(text) => {
    if (/INSERT INTO publication_jobs/i.test(text)) {
      insertCount += 1;
      return { rows: [jobRow({ status: 'scheduled' })] };
    }
    return undefined;
  }]);
  const repo = createPublicationJobsRepo(client);
  const result = await repo.create(TENANT, { platform: 'tiktok', idempotencyKey: 'job-key-1', status: 'scheduled' });
  assert.equal(result.created, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.job.status, 'scheduled');
  assert.equal(insertCount, 1);
  const { text, params } = client.calls[0];
  assert.match(text, /ON CONFLICT \(tenant_id, idempotency_key\) DO NOTHING/);
  assert.equal(params[0], TENANT);
  assert.equal(params[2], 'tiktok');
  assert.equal(params[3], 'scheduled');
});

test('duplicate idempotency key returns the existing job without a second insert effect', async () => {
  const client = scriptedClient([
    (text) => (/INSERT INTO publication_jobs/i.test(text) ? { rows: [] } : undefined),
    (text) => (/SELECT \* FROM publication_jobs WHERE tenant_id = \$1 AND idempotency_key/i.test(text)
      ? { rows: [jobRow({ status: 'processing', attempt: 1 })] }
      : undefined)
  ]);
  const repo = createPublicationJobsRepo(client);
  const result = await repo.create(TENANT, { platform: 'tiktok', idempotencyKey: 'job-key-1' });
  assert.equal(result.created, false);
  assert.equal(result.duplicate, true);
  assert.equal(result.job.status, 'processing');
});

test('illegal transitions fail closed and terminal statuses refuse further movement', async () => {
  const current = jobRow({ status: 'draft' });
  const client = scriptedClient([
    (text) => (/FOR UPDATE/i.test(text) ? { rows: [current] } : undefined)
  ]);
  const repo = createPublicationJobsRepo(client);
  await assert.rejects(
    () => repo.transition(TENANT, current.id, 'published'),
    (error) => error instanceof PublicationTransitionError && /draft -> published/.test(error.message)
  );
  const terminalRepo = createPublicationJobsRepo(scriptedClient([
    () => ({ rows: [jobRow({ status: 'published' })] })
  ]));
  await assert.rejects(() => terminalRepo.transition(TENANT, current.id, 'processing'), PublicationTransitionError);
  const unknownRepo = createPublicationJobsRepo(scriptedClient());
  await assert.rejects(() => unknownRepo.transition(TENANT, current.id, 'exploded'), /status must be one of/);
});

test('full happy path draft to published transitions with optimistic status guard', async () => {
  const states = ['draft', 'waiting_approval', 'approved', 'scheduled', 'processing'];
  let stage = 0;
  const client = scriptedClient([
    () => ({ rows: [jobRow({ status: states[stage] })] }),
    (text) => (/UPDATE publication_jobs SET/i.test(text) ? { rows: [jobRow({ status: 'moved' })] } : undefined)
  ]);
  const repo = createPublicationJobsRepo(client);
  for (const target of ['waiting_approval', 'approved', 'scheduled', 'processing', 'published']) {
    const result = await repo.transition(TENANT, 'x-job', target);
    assert.equal(result.transitioned, true);
    stage += 1;
  }
  const guardCalls = client.calls.filter((call) => /AND status = \$10/.test(call.text));
  assert.equal(guardCalls.length, 5, 'every transition must be guarded by expected current status');
  assert.equal(guardCalls[guardCalls.length - 1].params.at(-1), 'processing');
});

test('retry budget is enforced when reprocessing failed jobs', async () => {
  const exhausted = jobRow({ status: 'failed', attempt: 3, max_attempts: 3 });
  const client = scriptedClient([() => ({ rows: [exhausted] })]);
  const repo = createPublicationJobsRepo(client);
  const denied = await repo.transition(TENANT, exhausted.id, 'processing');
  assert.equal(denied.transitioned, false);
  assert.equal(denied.reason, 'retry_budget_exhausted');
  assert.equal(denied.maxAttempts, 3);

  const retryable = jobRow({ status: 'failed', attempt: 1, max_attempts: 3 });
  const retryClient = scriptedClient([
    (text) => (/FOR UPDATE/i.test(text) ? { rows: [retryable] } : undefined),
    (text) => (/UPDATE publication_jobs SET/i.test(text) ? { rows: [jobRow({ status: 'processing', attempt: 2 })] } : undefined)
  ]);
  const allowed = await createPublicationJobsRepo(retryClient).transition(TENANT, retryable.id, 'processing');
  assert.equal(allowed.transitioned, true);
  assert.equal(allowed.job.attempt, 2);
});

test('claimDue claims due scheduled and retry-candidate jobs atomically via skip-locked', async () => {
  const client = scriptedClient([
    (text) => (/UPDATE publication_jobs SET/i.test(text)
      ? { rows: [jobRow({ status: 'processing', attempt: 1 }), jobRow({ status: 'processing', attempt: 2, id: '33333333-3333-4333-8333-333333333333' })] }
      : undefined)
  ]);
  const claimed = await createPublicationJobsRepo(client).claimDue(TENANT, NOW, 5);
  assert.equal(claimed.length, 2);
  const { text, params } = client.calls[0];
  assert.match(text, /FOR UPDATE SKIP LOCKED/);
  assert.match(text, /attempt < max_attempts/);
  assert.match(text, /status IN \('failed','partial'\) AND \(next_retry_at IS NULL OR next_retry_at <= \$2::timestamptz\)/);
  assert.match(text, /\(status = 'scheduled' AND \(scheduled_for IS NULL OR scheduled_for <= \$2::timestamptz\)\)/);
  assert.match(text, /attempt \+ 1/);
  assert.equal(params[0], TENANT);
  assert.equal(params[1], NOW);
  assert.equal(params[2], 5);
});

test('read paths map snake_case rows into camelCase jobs', async () => {
  const row = jobRow({ external_content_id: 'vid-9', failure_code: null });
  const client = scriptedClient([() => ({ rows: [row] })]);
  const repo = createPublicationJobsRepo(client);
  const single = await repo.getById(TENANT, row.id);
  assert.equal(single.externalContentId, 'vid-9');
  assert.equal(single.tenantId, TENANT);
  const many = await repo.listByStatus(TENANT, 'draft', 5);
  assert.equal(many.length, 1);
  const listCall = client.calls[1];
  assert.equal(listCall.params[1], 'draft');
  assert.equal(listCall.params[2], 5);
});

test('integration: jobs survive a simulated process restart and claim exactly once', async (t) => {
  const { createDbClient } = await import('../packages/db/src/client.js');
  const { createMigrator } = await import('../packages/db/src/migrator.js');
  const clientA = createDbClient({});
  const status = await clientA.check();
  if (!status.reachable) {
    t.skip(`postgres not reachable (${status.reason})`);
    await clientA.close();
    return;
  }
  try {
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
    await createMigrator({ client: clientA, migrationsDir }).applyAll();

    const tenantId = await clientA.transaction(async (tx) => {
      const rows = await tx.query(
        `INSERT INTO tenants (slug, name) VALUES ('gm-b3-restart', 'GM-B3 restart rehearsal')
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        []
      );
      return rows.rows[0].id;
    });

    const key = `restart-${Date.now()}`;
    let createdJobId;
    await clientA.transaction(async (tx) => {
      await tx.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(tenantId)]);
      const repoA = createPublicationJobsRepo(tx);
      const created = await repoA.create(tenantId, { platform: 'tiktok', idempotencyKey: key, status: 'scheduled' });
      assert.equal(created.created, true);
      const duplicate = await repoA.create(tenantId, { platform: 'tiktok', idempotencyKey: key });
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.job.jobId, created.job.jobId);
      createdJobId = created.job.jobId;
    });

    // Simulated restart: brand-new client instance, no shared in-memory state.
    const clientB = createDbClient({});
    try {
      await clientB.check();
      await clientB.transaction(async (tx) => {
        await tx.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(tenantId)]);
        const repoB = createPublicationJobsRepo(tx);
        const persisted = await repoB.getById(tenantId, createdJobId);
        assert.equal(persisted.status, 'scheduled');

        const claimedFirst = await repoB.claimDue(tenantId, new Date().toISOString(), 100);
        const mine = claimedFirst.filter((job) => job.jobId === createdJobId);
        assert.equal(mine.length, 1);
        assert.equal(mine[0].attempt, 1);

        const claimedAgain = await repoB.claimDue(tenantId, new Date().toISOString(), 100);
        assert.equal(claimedAgain.filter((job) => job.jobId === createdJobId).length, 0, 'no double dispatch after claim');

        const published = await repoB.transition(tenantId, createdJobId, 'published', { externalContentId: 'vid-1' });
        assert.equal(published.transitioned, true);
        const terminal = await repoB.getById(tenantId, createdJobId);
        assert.equal(terminal.status, 'published');
        assert.equal(terminal.externalContentId, 'vid-1');
      });
    } finally {
      await clientB.close();
    }
  } finally {
    await clientA.close();
  }
});
