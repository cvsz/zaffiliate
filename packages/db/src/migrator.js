import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';

const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

export class MigrationDriftError extends Error {
  constructor(drift) {
    super(`migration drift detected for: ${drift.map((entry) => entry.id).join(', ')}`);
    this.name = 'MigrationDriftError';
    this.code = 'MIGRATION_DRIFT_DETECTED';
    this.drift = Object.freeze(drift);
  }
}

function checksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

function unwrapTransaction(sql) {
  const lines = sql.replace(/\r\n/g, '\n').split('\n');
  let first = 0;
  while (first < lines.length && !lines[first].trim()) first += 1;
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last -= 1;
  if (first < last && /^BEGIN;?$/i.test(lines[first].trim()) && /^COMMIT;?$/i.test(lines[last].trim())) {
    return lines.slice(first + 1, last).join('\n');
  }
  return sql;
}

export function createMigrator({ client, migrationsDir, logger = null } = {}) {
  if (!client || typeof client.query !== 'function') throw new TypeError('client with query() is required');
  if (!migrationsDir) throw new TypeError('migrationsDir is required');

  async function listLocal() {
    const entries = await readdir(migrationsDir);
    const migrations = entries
      .filter((name) => MIGRATION_FILE_PATTERN.test(name))
      .sort()
      .map((name) => ({
        id: basename(name, '.sql'),
        file: join(migrationsDir, name),
        content: null
      }));
    for (const entry of migrations) await readMigration(entry);
    return migrations;
  }

  async function readMigration(entry) {
    if (entry.content == null) {
      entry.content = await readFile(entry.file, 'utf8');
      entry.checksum = checksum(entry.content);
    }
    return entry;
  }

  function log(event, fields) {
    if (logger && typeof logger.info === 'function') logger.info(event, fields);
  }

  async function appliedRecords() {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const result = await client.query('SELECT id, checksum FROM schema_migrations ORDER BY id');
    const map = new Map();
    for (const row of result.rows || []) map.set(row.id, row.checksum);
    return map;
  }

  async function plan() {
    const local = await listLocal();
    const applied = await appliedRecords();
    const pending = [];
    const done = [];
    const drift = [];
    for (const entry of local) {
      await readMigration(entry);
      if (!applied.has(entry.id)) pending.push(entry);
      else if (applied.get(entry.id) !== entry.checksum) drift.push({ id: entry.id, expected: entry.checksum, actual: applied.get(entry.id) });
      else done.push({ id: entry.id, checksum: entry.checksum });
    }
    return { pending, applied: done, drift };
  }

  async function applyAll({ dryRun = false } = {}) {
    const state = await plan();
    if (state.drift.length > 0) throw new MigrationDriftError(state.drift);
    if (dryRun) return { applied: [], skipped: state.applied.map((entry) => entry.id), planned: state.pending.map((entry) => entry.id), drift: [] };
    const appliedIds = [];
    for (const entry of state.pending) {
      const body = unwrapTransaction(entry.content);
      await client.query('BEGIN');
      try {
        await client.query(body);
        await client.query('INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)', [entry.id, entry.checksum]);
        await client.query('COMMIT');
        appliedIds.push(entry.id);
        log('db_migration_applied', { migrationId: entry.id });
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          log('db_migration_rollback_failed', { migrationId: entry.id });
        }
        error.message = `migration ${entry.id} failed: ${error.message}`;
        throw error;
      }
    }
    return { applied: appliedIds, skipped: state.applied.map((entry) => entry.id), planned: [], drift: [] };
  }

  return Object.freeze({ listLocal, plan, applyAll });
}
