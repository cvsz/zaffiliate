import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

function checksum(data) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function runReconcile({ dataset = 'commissions' } = {}) {
  const valid = ['commissions', 'billing', 'webhooks'];
  if (!valid.includes(dataset)) throw new Error(`unsupported dataset: ${dataset}`);

  const evidencePath = `dist/${dataset}-evidence.json`;
  let recorded = [];
  let attributed = [];

  if (existsSync(evidencePath)) {
    const data = JSON.parse(readFileSync(evidencePath, 'utf8'));
    recorded = Array.isArray(data.recorded) ? data.recorded : [];
    attributed = Array.isArray(data.attributed) ? data.attributed : [];
  }

  const recordedTotal = recorded.reduce((sum, row) => sum + Number(row.amountMinorUnits || 0), 0);
  const attributedTotal = attributed.reduce((sum, row) => sum + Number(row.creditMinorUnits || 0), 0);
  const delta = attributedTotal - recordedTotal;
  const balanced = delta === 0;

  const report = Object.freeze({
    dataset,
    checkedAt: new Date().toISOString(),
    recordedCount: recorded.length,
    attributedCount: attributed.length,
    recordedTotalMinorUnits: recordedTotal,
    attributedTotalMinorUnits: attributedTotal,
    deltaMinorUnits: delta,
    balanced,
    sha256: checksum({ recorded, attributed })
  });

  mkdirSync('dist', { recursive: true });
  writeFileSync(`dist/reconcile-${dataset}-evidence.json`, JSON.stringify(report, null, 2));
  return report;
}

const args = process.argv.slice(2);
function argValue(flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.split('=')[1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataset = argValue('--dataset') || 'commissions';
  const report = runReconcile({ dataset });
  console.log(JSON.stringify(report));
  if (!report.balanced) process.exit(1);
}
