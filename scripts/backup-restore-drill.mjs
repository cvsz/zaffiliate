import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

export async function runBackupRestoreDrill({ execute = false } = {}) {
  const plan = {
    backupArtifacts: [
      'pg_dumpall > backups/all.sql',
      'pg_dump zaffiliate_test > backups/schema.sql',
      'redis-cli BGSAVE && cp dump.rdb backups/'
    ],
    restoreCommands: [
      'psql -f backups/schema.sql zaffiliate_test',
      'redis-cli SHUTDOWN NOSAVE && cp backups/dump.rdb /data/'
    ],
    validationSql: [
      'db/tests/rls.sql',
      'db/tests/durable-workflow.sql',
      'db/tests/billing-ai-analytics.sql'
    ]
  };

  let executed = false;
  let sha256sum = '';
  const pgDump = existsSync('/usr/bin/pg_dump') || existsSync('/usr/local/bin/pg_dump');

  if (execute) {
    if (!pgDump) {
      return Object.freeze({ planned: true, executed: false, error: 'pg_dump not available; run manually per plan', sha256: '' });
    }
    try {
      mkdirSync('backups', { recursive: true });
      execFileSync('pg_dump', ['zaffiliate_test', '-f', 'backups/schema.sql'], { stdio: 'inherit' });
      executed = true;
      const data = readFileSync('backups/schema.sql');
      sha256sum = createHash('sha256').update(data).digest('hex');
    } catch (error) {
      return Object.freeze({ planned: true, executed: false, error: String(error.message), sha256: '' });
    }
  }

  const evidence = Object.freeze({ planned: true, executed, pgDumpAvailable: pgDump, sha256: sha256sum || 'pending' });
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/backup-restore-drill-evidence.json', JSON.stringify(evidence, null, 2));
  return evidence;
}

const args = process.argv.slice(2);
function hasFlag(flag) { return args.includes(flag); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const evidence = await runBackupRestoreDrill({ execute: hasFlag('--run') });
  console.log(JSON.stringify(evidence));
}
