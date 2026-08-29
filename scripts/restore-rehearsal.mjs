#!/usr/bin/env node
// GM-B5 restore rehearsal verifier — runs against a CLEAN restored database only.
// Never point this at production: it creates throwaway tenants, an app role,
// jobs and events. Phase order mirrors master-spec §41/§56:
//   restore → run release migrations forward → schema/tenant/financial checks
//   → golden flow — all exercised through a dedicated non-owner app role so
//   RLS is genuinely binding (superuser BYPASSRLS would mask every policy).
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createDbClient } from '../packages/db/src/client.js';
import { createMigrator } from '../packages/db/src/migrator.js';

const TARGET = process.env.RESTORED_DATABASE_URL;
if (!TARGET || !/127\.0\.0\.1|localhost/.test(new URL(TARGET).hostname)) {
  console.error('restore-rehearsal: RESTORED_DATABASE_URL must point at an isolated localhost target');
  process.exit(2);
}

const TENANT_SCOPED_TABLES = Object.freeze([
  'tenants', 'tenant_memberships', 'products', 'offers', 'affiliate_links', 'audit_events',
  'creator_contacts', 'outreach_outbox', 'jobs', 'approvals', 'idempotency_records',
  'analytics_events', 'publication_jobs'
]);

function fail(message) {
  console.error(`restore-rehearsal: FAIL ${message}`);
  process.exit(1);
}

const evidence = { target: new URL(TARGET).host, startedAt: new Date().toISOString(), checks: {} };

const admin = createDbClient({ connectionString: TARGET });
const adminStatus = await admin.check();
if (!adminStatus.reachable) fail(`target unreachable (${adminStatus.reason})`);

// ── Phase 1 (admin): schema integrity + forward migration of the restored snapshot
const tables = await admin.query(`
  SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`);
const tableNames = (tables.rows ?? []).map((r) => r.relname);
for (const table of TENANT_SCOPED_TABLES) {
  if (!tableNames.includes(table)) fail(`core table missing after restore: ${table}`);
}
evidence.checks.restoredTables = tableNames.length;
console.log(`restore: ${tableNames.length} public tables present`);

const migrationsDir = new URL('../db/migrations', import.meta.url).pathname;
const applied = await createMigrator({ client: admin, migrationsDir }).applyAll();
const plan = await createMigrator({ client: admin, migrationsDir }).plan();
evidence.checks.forwardMigrations = applied.applied;
evidence.checks.migrationPending = plan.pending.length;
evidence.checks.migrationDrift = plan.drift.length;
if (plan.drift.length > 0) fail('restored schema diverges from release migration checksums');
if (plan.pending.length > 0) fail('release migrations did not fully apply onto restored snapshot');
console.log(`migrator: forward-applied=${JSON.stringify(applied.applied)} pending=0 drift=0`);

const rls = await admin.query(`
  SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'`);
const rlsRows = rls.rows ?? [];
for (const table of TENANT_SCOPED_TABLES) {
  const row = rlsRows.find((r) => r.relname === table);
  if (!row || !row.enabled || !row.forced) fail(`RLS not enabled+forced on ${table}`);
}
evidence.checks.rlsEnabledForcedTables = TENANT_SCOPED_TABLES.length;
console.log(`rls: all ${TENANT_SCOPED_TABLES.length} tenant-scoped tables enabled+forced`);

// ── Phase 2 (admin): throwaway tenants + dedicated non-owner app role
let tenantA;
let tenantB;
await admin.transaction(async (tx) => {
  const inserted = await tx.query(
    `INSERT INTO tenants (slug, name) VALUES
       ('gm-b5-iso-a', 'GM-B5 isolated A'),
       ('gm-b5-iso-b', 'GM-B5 isolated B')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING slug, id`, []);
  const bySlug = Object.fromEntries(inserted.rows.map((r) => [r.slug, r.id]));
  tenantA = bySlug['gm-b5-iso-a'];
  tenantB = bySlug['gm-b5-iso-b'];
});
if (!tenantA || !tenantB) fail('throwaway tenants missing after upsert');

const rolePassword = randomBytes(18).toString('base64url');
async function dropRehearsalRole() {
  const existing = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = 'gm_b5_app'`, []);
  if ((existing.rows ?? []).length === 0) return;
  await admin.query(`DROP OWNED BY gm_b5_app`, []);
  await admin.query(`DROP ROLE IF EXISTS gm_b5_app`, []);
}
await dropRehearsalRole();
await admin.query(`CREATE ROLE gm_b5_app LOGIN PASSWORD '${rolePassword}'`, []);
await admin.query(`GRANT USAGE ON SCHEMA public TO gm_b5_app`, []);
await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gm_b5_app`, []);
await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gm_b5_app`, []);

const targetUrl = new URL(TARGET);
const appUrl = `${targetUrl.protocol}//gm_b5_app:${encodeURIComponent(rolePassword)}@${targetUrl.host}${targetUrl.pathname}`;
const app = createDbClient({ connectionString: appUrl });
if (!(await app.check()).reachable) fail('app role cannot connect');

async function asTenant(client, tenantId, fn) {
  return client.transaction(async (tx) => {
    await tx.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(tenantId)]);
    return fn(tx);
  });
}

// ── Phase 3 (app role): tenant isolation is genuinely binding
await asTenant(app, tenantA, async (tx) => {
  await tx.query(
    `INSERT INTO products (tenant_id, platform, external_product_id, title)
     VALUES ($1, 'tiktok', 'gm-b5-p1', 'Rehearsal Gadget') ON CONFLICT DO NOTHING`,
    [tenantA]);
  const own = await tx.query('SELECT count(*)::int AS n FROM products WHERE external_product_id = $1', ['gm-b5-p1']);
  if (own.rows[0].n !== 1) fail('tenant A cannot see its own row under RLS');
});

await asTenant(app, tenantB, async (tx) => {
  const leak = await tx.query('SELECT count(*)::int AS n FROM products WHERE external_product_id = $1', ['gm-b5-p1']);
  if (leak.rows[0].n !== 0) fail('CROSS-TENANT READ LEAK through RLS');
  try {
    await tx.query(
      `INSERT INTO products (tenant_id, platform, external_product_id, title)
       VALUES ($1, 'tiktok', 'gm-b5-spoof', 'Spoofed')`,
      [tenantA]);
    fail('CROSS-TENANT WRITE accepted — WITH CHECK not enforced');
  } catch (error) {
    if (!/row-level security/i.test(String(error.message))) throw error;
  }
});
evidence.checks.crossTenantReadIsolation = true;
evidence.checks.crossTenantWriteDenied = true;
console.log('tenant isolation: A sees own row; B reads none; B spoofed write rejected by WITH CHECK');

// ── Phase 4 (app role): golden publication flow incl. exactly-once claim
await asTenant(app, tenantA, async (tx) => {
  const { createPublicationJobsRepo } = await import('../packages/db/src/publication-jobs-repo.js');
  const repo = createPublicationJobsRepo(tx);
  const key = `gm-b5-golden-${Date.now()}`;
  const created = await repo.create(tenantA, { platform: 'tiktok', idempotencyKey: key, status: 'scheduled' });
  if (!created.created) fail('publication job create failed on restored env');
  const dup = await repo.create(tenantA, { platform: 'tiktok', idempotencyKey: key });
  if (!dup.duplicate || dup.job.jobId !== created.job.jobId) fail('idempotent create broken on restored env');
  const claimed = await repo.claimDue(tenantA, new Date().toISOString(), 100);
  const mine = claimed.filter((j) => j.jobId === created.job.jobId);
  if (mine.length !== 1) fail(`exactly-once claim broken: claimed ${mine.length}`);
  if (mine[0].attempt !== 1) fail('claim did not increment attempt');
  const again = await repo.claimDue(tenantA, new Date().toISOString(), 100);
  if (again.some((j) => j.jobId === created.job.jobId)) fail('double dispatch on restored env');
  const published = await repo.transition(tenantA, created.job.jobId, 'published', { externalContentId: 'vid-golden' });
  if (!published.transitioned) fail('publish transition failed on restored env');
  try {
    await repo.transition(tenantA, created.job.jobId, 'processing');
    fail('terminal status accepted an illegal transition');
  } catch (error) {
    if (error.name !== 'PublicationTransitionError') throw error;
  }
});
evidence.checks.goldenPublicationFlow = true;
console.log('golden publication flow: idempotent create, exactly-once claim, publish, terminal freeze');

// ── Phase 5 (app role): golden financial dataset survives restore with dedupe
const NOW = '2026-08-25T17:00:00.000Z';
await asTenant(app, tenantA, async (tx) => {
  const { buildEventEnvelope } = await import('../packages/analytics/src/events.js');
  const { saveAnalyticsEvents } = await import('../packages/db/src/analytics-repo.js');
  const MARKER = `gm-b5-golden-${Date.now()}`;
  const envelope = (overrides) => buildEventEnvelope({
    organizationId: tenantA, provider: 'tiktok',
    sourceType: 'FIRST_PARTY', occurredAt: NOW, receivedAt: NOW,
    ...overrides
  });
  const impressions = [];
  for (let i = 0; i < 1000; i += 1) {
    impressions.push(envelope({
      type: 'impression_recorded', externalEventId: `${MARKER}-imp-${i}`,
      payload: { rehearsalMarker: MARKER }
    }));
  }
  const clicks = [];
  for (let i = 0; i < 100; i += 1) {
    clicks.push(envelope({
      type: 'affiliate_click_recorded', externalEventId: `${MARKER}-clk-${i}`,
      affiliateLinkId: 'lnk-golden', payload: { rehearsalMarker: MARKER, linkId: 'lnk-golden' }
    }));
  }
  const conversions = [];
  for (let i = 0; i < 10; i += 1) {
    conversions.push(envelope({
      type: 'conversion_reported', sourceType: 'PROVIDER_REPORTED',
      externalEventId: `${MARKER}-cnv-${i}`,
      payload: { rehearsalMarker: MARKER, revenueMinorUnits: 10000, commissionMinorUnits: 9000, currency: 'THB' }
    }));
  }
  await saveAnalyticsEvents(tx, tenantA, [...impressions, ...clicks, ...conversions]);
  await saveAnalyticsEvents(tx, tenantA, [clicks[0], conversions[0]]);
  const counts = await tx.query(`
    SELECT event_type, count(*)::int AS n FROM analytics_events
    WHERE tenant_id = $1 AND dimensions->'payload'->>'rehearsalMarker' = $2
    GROUP BY event_type`, [tenantA, MARKER]);
  const byType = Object.fromEntries(counts.rows.map((r) => [r.event_type, r.n]));
  if (byType.impression_recorded !== 1000 || byType.affiliate_click_recorded !== 100 || byType.conversion_reported !== 10) {
    fail(`golden dataset corrupted: ${JSON.stringify(byType)}`);
  }
  const ctr = byType.affiliate_click_recorded / byType.impression_recorded;
  const cvr = byType.conversion_reported / byType.affiliate_click_recorded;
  if (Math.abs(ctr - 0.1) > 1e-9) fail(`golden CTR broken: ${ctr}`);
  if (Math.abs(cvr - 0.1) > 1e-9) fail(`golden CVR broken: ${cvr}`);
  evidence.checks.goldenMetrics = { impressions: 1000, clicks: 100, conversions: 10, ctr, cvr };
});
console.log('golden metrics: 1000/100/10 single-effect after duplicate delivery, CTR=CVR=10%');

// ── Phase 6 (admin): cleanup + evidence
await app.close();
await dropRehearsalRole();
for (const tenantId of [tenantA, tenantB]) {
  await admin.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
}
const residual = await admin.query("SELECT count(*)::int AS n FROM tenants WHERE slug LIKE 'gm-b5-%'");
if ((residual.rows?.[0]?.n ?? 0) !== 0) fail('throwaway tenants not cleaned up');
evidence.checks.cleanup = true;

evidence.passed = ['crossTenantReadIsolation', 'crossTenantWriteDenied', 'goldenPublicationFlow', 'cleanup']
  .every((k) => evidence.checks[k] === true)
  && Number.isFinite(evidence.checks.goldenMetrics?.ctr)
  && Math.abs(evidence.checks.goldenMetrics.ctr - 0.1) < 1e-9
  && Math.abs(evidence.checks.goldenMetrics.cvr - 0.1) < 1e-9
  && evidence.checks.migrationPending === 0 && evidence.checks.migrationDrift === 0;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/restore-rehearsal-evidence.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));

await admin.close();
if (!evidence.passed) process.exit(1);
