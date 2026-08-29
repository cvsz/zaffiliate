import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const TRANSFORMS = Object.freeze({
  'legacy:product': 'canonical:product',
  'legacy:offer': 'canonical:offer',
  'legacy:link': 'canonical:link',
  'legacy:conversion': 'canonical:conversion',
  'legacy:commission': 'canonical:commission'
});

export function runMigration({ sourcePath = 'docs/migration/SOURCE-SNAPSHOT-LEDGER.json', dryRun = false } = {}) {
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const records = Array.isArray(source) ? source : (source.records || source.blobs || []);
  const target = [];
  let transformed = 0;
  let skipped = 0;

  for (const record of records) {
    const key = `${record.source_repo || ''}:${record.path || ''}`;
    const rawTarget = TRANSFORMS[key] || record.canonical_destination;
    const targetPath = rawTarget || 'unknown';
    if (targetPath === 'unknown') {
      skipped++;
      continue;
    }
    transformed++;
    target.push(Object.freeze({
      source_repo: record.source_repo,
      source_ref: record.source_ref,
      path: record.path,
      blob_sha: record.blob_sha,
      size: record.size,
      class: record.class,
      canonical_destination: targetPath
    }));
  }

  const targetJson = JSON.stringify({ records: target }, null, 2);
  const sha256 = createHash('sha256').update(targetJson).digest('hex');

  if (!dryRun) {
    mkdirSync('dist', { recursive: true });
    writeFileSync('dist/migration-target-manifest.json', targetJson);
    writeFileSync('dist/migration-target-manifest.sha256', sha256);
  }

  const report = Object.freeze({
    sourceRecords: records.length,
    transformed,
    skipped,
    targetRecords: target.length,
    sha256,
    balanced: transformed === target.length,
    dryRun
  });

  if (!report.balanced) throw new Error(`migration imbalance: transformed ${transformed} != target ${target.length}`);
  return report;
}

const args = process.argv.slice(2);
function hasFlag(flag) { return args.includes(flag); }
function argValue(flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.split('=')[1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sourcePath = argValue('--source') || 'docs/migration/SOURCE-SNAPSHOT-LEDGER.json';
  const report = runMigration({ sourcePath, dryRun: hasFlag('--dry-run') });
  console.log(JSON.stringify(report));
  if (!report.balanced) process.exit(1);
}
