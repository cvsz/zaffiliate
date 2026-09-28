import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dir = resolve(process.env.PROVIDER_EVIDENCE_DIR || 'artifacts/provider-evidence');
const maxAgeDays = Math.max(1, Number(process.env.PROVIDER_EVIDENCE_MAX_AGE_DAYS || 30));
const releaseMode = process.argv.includes('--check');
const requirements = {
  tiktok: ['content.publish'],
  shopee: ['affiliate.read', 'video.publish', 'live.publish'],
  meta: ['reels.publish'],
  youtube: ['videos.insert']
};
const forbiddenKeys = /token|secret|password|cookie|authorization/i;
const results = [];
let bundled = null;
if (process.env.PROVIDER_ENTITLEMENT_EVIDENCE_JSON) {
  try { bundled = JSON.parse(process.env.PROVIDER_ENTITLEMENT_EVIDENCE_JSON); }
  catch { throw new Error('PROVIDER_ENTITLEMENT_EVIDENCE_JSON must be valid JSON'); }
}

for (const [provider, required] of Object.entries(requirements)) {
  let evidence = bundled?.[provider] ?? null;
  if (!evidence) {
    try { evidence = JSON.parse(await readFile(resolve(dir, provider + '.json'), 'utf8')); }
    catch {
      results.push({ provider, status: 'BLOCKED', reason: 'evidence_missing', required });
      continue;
    }
  }
  const serializedKeys = [];
  function walk(value, prefix = '') {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? prefix + '.' + key : key;
      serializedKeys.push(path);
      walk(child, path);
    }
  }
  walk(evidence);
  if (serializedKeys.some((key) => forbiddenKeys.test(key))) {
    results.push({ provider, status: 'BLOCKED', reason: 'sensitive_material_forbidden_in_evidence' });
    continue;
  }
  const verifiedAt = new Date(evidence.verifiedAt || 0);
  const ageMs = Date.now() - verifiedAt.getTime();
  if (!Number.isFinite(verifiedAt.getTime()) || ageMs < 0 || ageMs > maxAgeDays * 86400000) {
    results.push({ provider, status: 'BLOCKED', reason: 'evidence_stale_or_invalid', verifiedAt: evidence.verifiedAt ?? null });
    continue;
  }
  if (!evidence.accountRef || !evidence.environment || !evidence.source || typeof evidence.capabilities !== 'object') {
    results.push({ provider, status: 'BLOCKED', reason: 'evidence_contract_incomplete' });
    continue;
  }
  const missing = required.filter((capability) => evidence.capabilities[capability] !== true);
  results.push({
    provider,
    status: missing.length ? 'BLOCKED' : 'PASS',
    verifiedAt: verifiedAt.toISOString(),
    accountRef: String(evidence.accountRef),
    environment: String(evidence.environment),
    missing
  });
}

const decision = results.every((r) => r.status === 'PASS') ? 'PASS' : 'BLOCKED';
const report = { generatedAt: new Date().toISOString(), decision, maxAgeDays, results };
await mkdir('dist/release-evidence', { recursive: true });
await writeFile('dist/release-evidence/provider-entitlements.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (releaseMode && decision !== 'PASS') process.exit(1);
