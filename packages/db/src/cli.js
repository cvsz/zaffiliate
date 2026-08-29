import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbClient, createMigrator } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const defaultMigrationsDir = join(here, '../../../db/migrations');

const client = createDbClient({});
const status = await client.check();
if (!status.reachable) {
  console.error(JSON.stringify({ ok: false, reason: status.reason }));
  process.exit(2);
}
try {
  const migrator = createMigrator({ client, migrationsDir: process.env.MIGRATIONS_DIR || defaultMigrationsDir });
  const result = await migrator.applyAll();
  console.log(JSON.stringify({ ok: true, applied: result.applied, skipped: result.skipped.length }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code ?? 'MIGRATION_FAILED', message: error.message }));
  process.exit(1);
} finally {
  await client.close();
}
