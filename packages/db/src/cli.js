import { createDbClient, createMigrator } from './index.js';

const client = createDbClient({});
const status = await client.check();
if (!status.reachable) {
  console.error(JSON.stringify({ ok: false, reason: status.reason }));
  process.exit(2);
}
try {
  const migrator = createMigrator({ client });
  const result = await migrator.applyAll();
  console.log(JSON.stringify({ ok: true, applied: result.applied, skipped: result.skipped.length }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code ?? 'MIGRATION_FAILED', message: error.message }));
  process.exit(1);
} finally {
  await client.close();
}
