#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CANONICAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BACKUP_DIR = process.env.LEGACY_BACKUP_DIR || '/home/cvsz/legacy-migration-backup';
const EVIDENCE_DIR = path.join(CANONICAL_ROOT, 'docs/migration/evidence');
const BUNDLE_DIR = path.join(BACKUP_DIR, 'bundles');
const RESTORE_DIR = '/tmp/ep00-restore-drill';

const ledgerSource = JSON.parse(
  readFileSync(path.join(CANONICAL_ROOT, 'docs/migration/SOURCE-SNAPSHOT-LEDGER.json'), 'utf8'),
);

const CLASSIFICATIONS = new Set([
  'MIGRATE',
  'PORT',
  'REFERENCE',
  'DROP-GENERATED',
  'DROP-DUPLICATE',
  'DROP-UNRELATED',
  'QUARANTINE-SECRET',
  'ARCHIVE-EVIDENCE',
]);

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { maxBuffer: 1 << 28 }).toString();
}

function gh(url, jq) {
  const args = ['api', url];
  if (jq) args.push('--jq', jq);
  try {
    return execFileSync('gh', args, { maxBuffer: 1 << 26 }).toString();
  } catch {
    return null;
  }
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const SECRET_PATTERNS = [
  { id: 'private-key-block', re: /BEGIN (RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY/ },
  { id: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  { id: 'openai-style-token', re: /sk-[A-Za-z0-9]{20,}/ },
  { id: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { id: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'gitlab-token', re: /glpat-[A-Za-z0-9\-_]{20,}/ },
  { id: 'google-api-key', re: /AIza[0-9A-Za-z\-_]{35}/ },
];

function scanEnvLike(pathName, content) {
  const base = path.basename(pathName);
  if (base.endsWith('.example') || base.endsWith('.sample') || base.endsWith('.template')) return false;
  if (/\.[a-z]{2,4}$/i.test(base) && !/\.env$/i.test(base)) return false;
  if (base !== '.env' && !/\.env$/i.test(base) && !/(^|\.)(env|secrets)$/.test(base)) return false;
  const lines = content.split('\n');
  return lines.some((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(\S.*)$/);
    if (!m) return false;
    const value = m[2].replace(/^["']|["']$/g, '').trim();
    if (!value) return false;
    if (/^(changeme|change-me|xxx+|your[-_].*|<.*>|\$\{.*\}|TODO|example.*|test|secret|password|key|token)$/i.test(value)) return false;
    if (/^(true|false|0|[0-9]+)$/.test(value)) return false;
    return true;
  });
}

function extractEnvKeys(content) {
  const keys = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*\S/);
    if (m && !line.trim().startsWith('#')) keys.push(m[1]);
  }
  return keys;
}

function scanSecretContent(pathName, content) {
  const hits = [];
  for (const { id, re } of SECRET_PATTERNS) {
    if (re.test(content)) hits.push(id);
  }
  if (scanEnvLike(pathName, content)) hits.push('env-assignment-value');
  return hits;
}

function catFileBatch(dir, shas) {
  return new Promise((resolve, reject) => {
    const map = new Map();
    if (shas.length === 0) return resolve(map);
    const child = spawn('git', ['-C', dir, 'cat-file', '--batch'], { maxBuffer: 1 << 28 });
    const out = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(Buffer.concat(stderr).toString()));
      const buf = Buffer.concat(out);
      let offset = 0;
      while (offset < buf.length) {
        const nl = buf.indexOf(0x0a, offset);
        if (nl === -1) break;
        const header = buf.slice(offset, nl).toString();
        const [sha, type, sizeStr] = header.split(' ');
        if (type === 'missing') {
          offset = nl + 1;
          continue;
        }
        const size = Number(sizeStr);
        const contentStart = nl + 1;
        map.set(sha, { type, content: buf.slice(contentStart, contentStart + size).toString('utf8') });
        offset = contentStart + size + 1;
      }
      resolve(map);
    });
    child.stdin.end(shas.join('\n') + '\n');
  });
}

const GENERIC_RULES = [
  {
    test: (p) => path.basename(p) === '.env',
    classification: 'QUARANTINE-SECRET',
    note: 'tracked runtime env file; never imported; rotation required (EP-01)',
  },
  {
    test: (p) => p === 'secrets' || p.startsWith('secrets/') || p.includes('/secrets/'),
    classification: 'QUARANTINE-SECRET',
    note: 'tracked secret material; never imported; rotation required (EP-01)',
  },
  {
    test: (p) => p.includes('.vitepress/cache/'),
    classification: 'DROP-GENERATED',
    note: 'build cache; regenerate locally, never import',
  },
  {
    test: (p) => /__\d+$/.test(path.basename(p)),
    classification: 'DROP-DUPLICATE',
    note: 'numeric-suffix duplicate artifact of merge tooling',
  },
  {
    test: (p) => ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'package.json'].includes(path.basename(p)) === false && false,
  },
  {
    test: (p) => ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].includes(path.basename(p)),
    classification: 'DROP-GENERATED',
    note: 'lockfile regenerated inside canonical workspace',
  },
  {
    test: (p) => /^sitemap.*\.xml$/.test(path.basename(p)),
    classification: 'DROP-GENERATED',
    note: 'generated sitemap artifact',
  },
  {
    test: (p) => path.basename(p) === 'i18n-generated.ts',
    classification: 'DROP-GENERATED',
    note: 'generated i18n types artifact',
  },
];

function rule(classification, target, note) {
  return { classification, target, note };
}

function prefix(prefixPath, r) {
  return { test: (p) => p === prefixPath || p.startsWith(prefixPath + '/'), ...r };
}

const REPO_RULES = {
  zaffhub: {
    default: rule('REFERENCE', 'docs/migration/evidence/zaffhub/<path>', 'specification provenance; extract requirements'),
    rules: [
      prefix('FULLPhase', rule('ARCHIVE-EVIDENCE', 'docs/migration/evidence/zaffhub/<path>', 'phase prompt provenance preserved as evidence')),
    ],
  },
  ztsaff: {
    default: rule('DROP-UNRELATED', null, 'Gitea platform machinery; explicit non-goal for affiliate core'),
    rules: [
      prefix('tiktok-review-saas/backend/server.js', rule('PORT', 'services/identity + services/billing + services/content-ai', 'behavioral port of application endpoints, not copy-paste')),
      prefix('tiktok-review-saas/database/init.sql', rule('PORT', 'packages/db/migrations', 'normalize and version schema')),
      prefix('tiktok-review-saas/frontend', rule('REFERENCE', 'docs/migration/evidence/ztsaff/frontend-ux/<path>', 'UX reference for apps/web rewrite')),
      prefix('tiktok-review-saas', rule('REFERENCE', 'docs/migration/evidence/ztsaff/<path>', 'runtime/ops reference for canonical services')),
      prefix('ROOT_PROJECT_SOURCE_MERGED.md', rule('ARCHIVE-EVIDENCE', 'docs/migration/evidence/ztsaff/<path>', 'merged source provenance')),
      prefix('prompt.md', rule('ARCHIVE-EVIDENCE', 'docs/migration/evidence/ztsaff/<path>', 'prompt provenance')),
      prefix('Gitea-plathform.md', rule('ARCHIVE-EVIDENCE', 'docs/migration/evidence/ztsaff/<path>', 'platform doc provenance')),
      prefix('.gitignore', rule('REFERENCE', 'docs/migration/evidence/ztsaff/<path>', 'trivial hygiene reference')),
      prefix('LICENSE', rule('REFERENCE', 'docs/migration/evidence/ztsaff/<path>', 'license provenance')),
    ],
  },
  'tiktok-shop-bot': {
    default: rule('REFERENCE', 'docs/migration/evidence/tiktok-shop-bot/<path>', 'outreach prototype provenance'),
    rules: [
      prefix('src/cli.py', rule('PORT', 'services/outreach/src/cli', 'rebuild as thin API client per EP-06')),
      prefix('src', rule('PORT', 'services/outreach/src', 'port dedupe/rate-limit/template semantics; repair missing src.utils dependency')),
      prefix('template', rule('PORT', 'services/outreach/templates', 'migrate templates with version metadata')),
      prefix('requirements.txt', rule('PORT', 'services/outreach', 'dependency reference for semantic port')),
    ],
  },
  'tiktok-shop-sdk': {
    default: rule('REFERENCE', 'docs/migration/evidence/tiktok-shop-sdk/<path>', 'toolchain/docs donor reference'),
    rules: [
      prefix('apps/docs/.vitepress/cache', rule('DROP-GENERATED', null, 'vitepress build cache; excluded from canonical import')),
      prefix('apps/docs', rule('REFERENCE', 'docs/integrations/tiktok/<path>', 'API documentation preserved')),
      prefix('apps/examples', rule('REFERENCE', 'docs/integrations/tiktok/examples/<path>', 'usage examples preserved')),
      prefix('apps/landing', rule('DROP-UNRELATED', null, 'upstream marketing landing site; out of canonical scope')),
      prefix('packages/sdk', rule('MIGRATE', 'packages/tiktok-adapter/<path>', 'primary TypeScript TikTok implementation')),
      prefix('images/fnatic.png', rule('DROP-UNRELATED', null, 'unrelated upstream asset')),
      prefix('package-lock.json', rule('DROP-GENERATED', null, 'lockfile regenerated in canonical workspace')),
      prefix('pnpm-lock.yaml', rule('DROP-GENERATED', null, 'lockfile regenerated in canonical workspace')),
    ],
  },
  'tiktokshop-php': {
    default: rule('REFERENCE', 'docs/migration/evidence/tiktokshop-php/<path>', 'PHP SDK provenance and toolchain reference'),
    rules: [
      prefix('src', rule('PORT', 'packages/php-tiktok-compat/<path>', 'compatibility-only port; parity-gated against canonical TS adapter')),
      prefix('tests', rule('PORT', 'packages/php-tiktok-compat/tests/<path>', 'parity oracle tests')),
    ],
  },
  zlttbots: {
    default: rule('DROP-UNRELATED', null, 'out-of-scope platform machinery (RL/crawler/farm/blockchain/exchange); explicit non-goal'),
    rules: [
      prefix('configs/env/production.env', rule('QUARANTINE-SECRET', null, 'tracked production env; never imported; rotation required (EP-01)')),
      prefix('.env.example', rule('REFERENCE', 'docs/migration/evidence/zlttbots/<path>', 'env contract reference')),
      prefix('packages/shared-runtime', rule('PORT', 'packages/runtime-resiliency/<path>', 'circuit breaker/idempotency/retry/otel/kafka primitives')),
      prefix('apps/affiliate-marketing', rule('PORT', 'services/affiliate-core', 'engine/schemas semantics port')),
      prefix('infrastructure/postgres/migrations', rule('REFERENCE', 'docs/migration/evidence/zlttbots/schema/<path>', 'schema normalization oracle')),
      prefix('.github', rule('REFERENCE', 'docs/migration/evidence/zlttbots/ci/<path>', 'CI/SAST/SCA workflow donor')),
      prefix('services/security-api', rule('REFERENCE', 'docs/migration/evidence/zlttbots/security/<path>', 'security service pattern donor')),
      { test: (p) => /^services\/[^/]+\/security\/rate_limit\.py$/.test(p), ...rule('REFERENCE', 'docs/migration/evidence/zlttbots/security/<path>', 'rate limiting pattern donor') },
      prefix('deploy', rule('REFERENCE', 'docs/migration/evidence/zlttbots/deploy/<path>', 'helm/argocd hardening donor')),
      prefix('infrastructure/monitoring', rule('REFERENCE', 'docs/migration/evidence/zlttbots/monitoring/<path>', 'observability stack donor')),
      prefix('infrastructure/policy', rule('REFERENCE', 'docs/migration/evidence/zlttbots/policy/<path>', 'OPA policy donor')),
      prefix('infrastructure/k8s/policies', rule('REFERENCE', 'docs/migration/evidence/zlttbots/policy/<path>', 'admission policy donor')),
      prefix('docs', rule('ARCHIVE-EVIDENCE', 'docs/migration/evidence/zlttbots/docs/<path>', 'operations/architecture provenance')),
      { test: (p) => ['docker-compose.yml', 'docker-compose.enterprise.yml', 'configs/nginx.conf', 'infrastructure/redis.conf', 'config/service-surface-manifest.json'].includes(p), ...rule('REFERENCE', 'docs/migration/evidence/zlttbots/<path>', 'local stack/config donor') },
      { test: (p) => ['README.md', 'SECURITY.md', 'CHANGELOG.md', 'LICENSE', 'AGENTS.md', 'AUTONOMOUS_SYSTEM.md', 'Gemini.md'].includes(p), ...rule('ARCHIVE-EVIDENCE', 'docs/migration/evidence/zlttbots/<path>', 'repository doc provenance') },
    ],
  },
  zttlbots: {
    default: rule('DROP-UNRELATED', null, 'cloudflare/meta ops machinery or empty placeholder; out of canonical scope'),
    rules: [
      prefix('zlinebot-lean/app/src/billing', rule('PORT', 'services/billing/<path>', 'ledger/meter/guard/cost primitives port')),
      prefix('zlinebot-lean/app/src/llm', rule('PORT', 'services/content-ai/<path>', 'router/safety/tooling abstractions port')),
      prefix('zlinebot-lean/app/src/routes/tiktok.ts', rule('PORT', 'packages/tiktok-adapter', 'tiktok service parity reference port')),
      prefix('zlinebot-lean/app/src/services/tiktok.service.ts', rule('PORT', 'packages/tiktok-adapter', 'tiktok service parity reference port')),
      prefix('zlinebot-lean/app/src/core/security.ts', rule('PORT', 'packages/security', 'security/config pattern port')),
      prefix('zlinebot-lean/app/src/core/config.ts', rule('PORT', 'apps/api/src/config', 'typed config loader port')),
      prefix('zlinebot-lean/app/src/core/logger.ts', rule('PORT', 'packages/observability', 'structured logger port')),
      prefix('zlinebot-lean/app/src/core/region-routing.ts', rule('REFERENCE', 'docs/migration/evidence/zttlbots/<path>', 'multi-region routing reference')),
      prefix('zlinebot-lean/app/src/utils/validator.ts', rule('PORT', 'packages/security', 'validation primitive port')),
      prefix('zlinebot-lean/app/src/routes/stream.ts', rule('PORT', 'services/content-ai', 'streaming route semantics port')),
      prefix('zlinebot-lean/app/src/routes/line.ts', rule('REFERENCE', 'docs/migration/evidence/zttlbots/<path>', 'optional LINE adapter reference')),
      prefix('zlinebot-lean/app/src/services/line.service.ts', rule('REFERENCE', 'docs/migration/evidence/zttlbots/<path>', 'optional LINE adapter reference')),
      prefix('zlinebot-lean/app/src/services/redis.service.ts', rule('REFERENCE', 'docs/migration/evidence/zttlbots/<path>', 'redis client pattern reference')),
      prefix('zlinebot-lean/app/src/sandbox', rule('REFERENCE', 'docs/migration/evidence/zttlbots/<path>', 'tool sandbox donor reference')),
      prefix('zlinebot-lean/app/db/schema.sql', rule('REFERENCE', 'docs/migration/evidence/zttlbots/<path>', 'schema normalization oracle')),
      prefix('zlinebot-lean/docker/docker-compose.yml', rule('REFERENCE', 'docs/migration/evidence/zttlbots/<path>', 'local stack donor')),
      prefix('zlinebot-lean/infra/docker/docker-compose.yml', rule('REFERENCE', 'docs/migration/evidence/zttlbots/<path>', 'local stack donor')),
      prefix('zlinebot-lean/ARCHITECTURE', rule('ARCHIVE-EVIDENCE', 'docs/migration/evidence/zttlbots/<path>', 'architecture provenance')),
      prefix('zlinebot-lean/README.md', rule('ARCHIVE-EVIDENCE', 'docs/migration/evidence/zttlbots/<path>', 'repository doc provenance')),
      prefix('zlinebot-lean/.env.example', rule('REFERENCE', 'docs/migration/evidence/zttlbots/<path>', 'env contract reference')),
      { test: (p) => ['zlinebot-lean/app/package.json', 'zlinebot-lean/app/tsconfig.json', 'zlinebot-lean/app/Dockerfile', 'zlinebot-lean/.github/workflows/deploy.yml', 'zlinebot-lean/.gitignore'].includes(p), ...rule('REFERENCE', 'docs/migration/evidence/zttlbots/<path>', 'toolchain reference') },
    ],
  },
};

function classifyRow(repo, pathName) {
  for (const g of GENERIC_RULES) {
    if (g.test(pathName)) return { classification: g.classification, target_path: g.target ?? null, notes: g.note };
  }
  const table = REPO_RULES[repo];
  for (const r of table.rules) {
    if (r.test(pathName)) return { classification: r.classification, target_path: typeof r.target === 'string' ? r.target.replace('<path>', pathName) : r.target, notes: r.note };
  }
  const d = table.default;
  return { classification: d.classification, target_path: typeof d.target === 'string' ? d.target.replace('<path>', pathName) : d.target, notes: d.note };
}

function listTree(dir, ref) {
  const out = git(dir, 'ls-tree', '-r', '-l', ref);
  const rows = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [meta, pathName] = line.split('\t');
    const [, type, sha, size] = meta.split(/\s+/);
    if (type !== 'blob') continue;
    rows.push({ path: pathName, blob_sha: sha, bytes: Number(size) });
  }
  return rows;
}

function listRefs(dir) {
  const out = git(dir, 'for-each-ref', '--format=%(refname) %(objectname)');
  const branches = [];
  const tags = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [ref, sha] = line.split(' ');
    if (ref.startsWith('refs/heads/')) branches.push({ name: ref.slice('refs/heads/'.length), sha });
    else if (ref.startsWith('refs/tags/')) tags.push({ name: ref.slice('refs/tags/'.length), sha });
  }
  return { branches, tags };
}

const generatedAt = new Date().toISOString();
const allRows = [];
const sources = [];
const secretScan = [];
const rotationRequirements = [];

for (const src of ledgerSource.sources) {
  const repo = src.repo.replace('cvsz/', '');
  const mirror = path.join(BACKUP_DIR, `${repo}.git`);
  if (!existsSync(mirror)) throw new Error(`missing mirror for ${repo}`);
  const head = git(mirror, 'rev-parse', 'HEAD').trim();
  if (head !== src.snapshot_sha) throw new Error(`pin mismatch for ${repo}: ${head} != ${src.snapshot_sha}`);

  const blobs = listTree(mirror, src.snapshot_sha);
  const treeContents = await catFileBatch(mirror, blobs.map((b) => b.blob_sha));
  const rows = [];
  for (const b of blobs) {
    const base = classifyRow(repo, b.path);
    let classification = base.classification;
    const notes = [base.notes];
    if (classification !== 'QUARANTINE-SECRET') {
      const entry = treeContents.get(b.blob_sha);
      const hits = entry ? scanSecretContent(b.path, entry.content) : [];
      if (hits.length > 0) {
        classification = 'QUARANTINE-SECRET';
        notes.push(`content scan hit: ${hits.join(',')}; escalated to quarantine; rotation required (EP-01)`);
      }
    }
    if (classification === 'QUARANTINE-SECRET') {
      const entry = treeContents.get(b.blob_sha);
      rotationRequirements.push({
        repo: `cvsz/${repo}`,
        source_path: b.path,
        blob_sha: b.blob_sha,
        present_in_pinned_tree: true,
        key_names_only: entry ? extractEnvKeys(entry.content) : [],
      });
    }
    const row = {
      source_repo: `cvsz/${repo}`,
      source_ref: src.snapshot_sha,
      source_path: b.path,
      blob_sha: b.blob_sha,
      bytes: b.bytes,
      classification,
      target_path: classification.startsWith('DROP') || classification === 'QUARANTINE-SECRET' ? null : base.target_path,
      drop_reason: classification.startsWith('DROP') ? base.notes : null,
      target_commit: null,
      validation: classification === 'QUARANTINE-SECRET'
        ? 'quarantined-not-imported; rotation outstanding'
        : classification.startsWith('DROP')
          ? 'drop-reason-recorded'
          : 'classified-pending-implementation',
      notes: notes.join('; '),
      reviewed_by: 'automated ep00 ledger builder v1.0; pending human sign-off',
      reviewed_at: generatedAt,
    };
    rows.push(row);
    allRows.push({ repo, row });
  }

  const refs = listRefs(mirror);
  const releasesRaw = gh(`repos/cvsz/${repo}/releases?per_page=100`, '[.[] | {number: .id, name: .tag_name, title: .name}]');
  const issuesRaw = gh(`repos/cvsz/${repo}/issues?state=all&per_page=100`, '[.[] | select(.pull_request == null) | {number, title, state}]');
  const pullsRaw = gh(`repos/cvsz/${repo}/pulls?state=all&per_page=100`, '[.[] | {number, title, state}]');

  const scanFindings = [];
  const revObjects = git(mirror, 'rev-list', '--all', '--objects').split('\n').filter(Boolean);
  const shaPaths = new Map();
  for (const line of revObjects) {
    const [sha, ...rest] = line.split(' ');
    if (rest.length > 0) {
      if (!shaPaths.has(sha)) shaPaths.set(sha, []);
      shaPaths.get(sha).push(rest.join(' '));
    }
  }
  const allShas = [...shaPaths.keys()];
  const typeMap = await catFileBatch(mirror, allShas);
  const blobShas = allShas.filter((sha) => typeMap.get(sha)?.type === 'blob');
  const historyContents = await catFileBatch(mirror, blobShas);
  for (const sha of blobShas) {
    const paths = shaPaths.get(sha);
    const entry = historyContents.get(sha);
    if (!entry) continue;
    const hits = scanSecretContent(paths[0], entry.content);
    if (hits.length > 0) {
      scanFindings.push({ blob_sha: sha, paths: [...new Set(paths)], patterns: hits });
      const inTree = blobs.some((b) => b.blob_sha === sha);
      rotationRequirements.push({
        repo: `cvsz/${repo}`,
        source_path: [...new Set(paths)].join(', '),
        blob_sha: sha,
        present_in_pinned_tree: inTree,
        key_names_only: extractEnvKeys(entry.content),
      });
    }
  }
  secretScan.push({ repo: `cvsz/${repo}`, snapshot_sha: src.snapshot_sha, history_blob_findings: scanFindings });

  sources.push({
    repo: `cvsz/${repo}`,
    snapshot_sha: src.snapshot_sha,
    head_matches_pin: head === src.snapshot_sha,
    blob_count: rows.length,
    refs,
    github_inventory: {
      releases: releasesRaw ? JSON.parse(releasesRaw) : { error: 'github api unavailable' },
      issues: issuesRaw ? JSON.parse(issuesRaw) : { error: 'github api unavailable' },
      pull_requests: pullsRaw ? JSON.parse(pullsRaw) : { error: 'github api unavailable' },
    },
    rows,
  });
}

const crossRepo = new Map();
for (const { repo, row } of allRows) {
  if (!crossRepo.has(row.blob_sha)) crossRepo.set(row.blob_sha, []);
  crossRepo.get(row.blob_sha).push(`${repo}:${row.source_path}`);
}
let duplicateRowCount = 0;
for (const { row } of allRows) {
  const occurrences = crossRepo.get(row.blob_sha);
  if (occurrences.length > 1) {
    duplicateRowCount += 1;
    row.notes += `; duplicate blob content also at: ${occurrences.filter((o) => !o.endsWith(`:${row.source_path}`)).join(', ')}`;
    if (row.classification === 'REFERENCE' || row.classification === 'ARCHIVE-EVIDENCE') {
      row.validation = 'duplicate-content-noted';
    }
  }
}

const byRepo = {};
for (const s of sources) {
  const counts = {};
  for (const r of s.rows) counts[r.classification] = (counts[r.classification] || 0) + 1;
  byRepo[s.repo] = { blob_count: s.rows.length, by_classification: counts };
}
const totals = {};
for (const { row } of allRows) totals[row.classification] = (totals[row.classification] || 0) + 1;

const unresolved = allRows.filter(({ row }) => !CLASSIFICATIONS.has(row.classification) || (row.target_path === null && row.drop_reason === null && row.classification !== 'QUARANTINE-SECRET'));
if (unresolved.length > 0) {
  console.error('unresolved rows:', unresolved.map(({ repo, row }) => `${repo}:${row.source_path}`).join('\n'));
  process.exit(1);
}

mkdirSync(EVIDENCE_DIR, { recursive: true });
writeFileSync(
  path.join(EVIDENCE_DIR, 'blob-ledger.json'),
  JSON.stringify({ schema_version: '1.0', generated_at: generatedAt, generator: 'tools/migration/build-ep00-evidence.mjs', summary: { total_blobs: allRows.length, by_classification: totals, by_repo: byRepo, duplicate_blob_rows: duplicateRowCount, coverage_percent: 100 }, sources }, null, 2) + '\n',
);

writeFileSync(path.join(EVIDENCE_DIR, 'secret-history-scan.json'), JSON.stringify({ schema_version: '1.0', generated_at: generatedAt, scope: 'all blobs across all refs (full history)', repos: secretScan }, null, 2) + '\n');

const dedupedRotation = [];
const seenRot = new Set();
for (const r of rotationRequirements) {
  const key = `${r.repo}:${r.blob_sha}`;
  if (seenRot.has(key)) continue;
  seenRot.add(key);
  dedupedRotation.push(r);
}
writeFileSync(
  path.join(EVIDENCE_DIR, 'rotation-requirements.json'),
  JSON.stringify({ schema_version: '1.0', generated_at: generatedAt, policy: 'key names only; values never exported; rotate/revoke every listed credential and anything reused from it (EP-01)', requirements: dedupedRotation }, null, 2) + '\n',
);

mkdirSync(BUNDLE_DIR, { recursive: true });
mkdirSync(RESTORE_DIR, { recursive: true });
const manifestRepos = [];
for (const src of sources) {
  const repo = src.repo.replace('cvsz/', '');
  const mirror = path.join(BACKUP_DIR, `${repo}.git`);
  const bundle = path.join(BUNDLE_DIR, `${repo}.bundle`);
  execFileSync('git', ['-C', mirror, 'bundle', 'create', bundle, '--all'], { stdio: 'pipe' });
  execFileSync('git', ['-C', mirror, 'bundle', 'verify', bundle], { stdio: 'pipe' });
  const bundleSha = sha256File(bundle);
  const restoreTarget = path.join(RESTORE_DIR, repo);
  execFileSync('rm', ['-rf', restoreTarget]);
  execFileSync('git', ['clone', '--quiet', '--mirror', bundle, restoreTarget]);
  const originalRefs = git(mirror, 'ls-remote', mirror).split('\n').filter(Boolean).sort().join('\n');
  const restoredRefs = git(restoreTarget, 'ls-remote', restoreTarget).split('\n').filter(Boolean).sort().join('\n');
  const restoreVerified = originalRefs === restoredRefs;
  manifestRepos.push({
    repo: src.repo,
    snapshot_sha: src.snapshot_sha,
    head_matches_pin: src.head_matches_pin,
    default_branch: ledgerSource.sources.find((s) => s.repo === src.repo).default_branch,
    branches: src.refs.branches.length,
    tags: src.refs.tags.length,
    bundle_path: bundle,
    bundle_sha256: bundleSha,
    bundle_verified: true,
    restore_drill_refs_identical: restoreVerified,
  });
  console.log(`${repo}: bundle ${bundleSha.slice(0, 12)} restore_refs_identical=${restoreVerified}`);
}

writeFileSync(
  path.join(EVIDENCE_DIR, 'legacy-manifest.json'),
  JSON.stringify({ schema_version: '1.0', generated_at: generatedAt, backup_root: BACKUP_DIR, mirrors: 'git clone --mirror', repositories: manifestRepos }, null, 2) + '\n',
);

console.log(JSON.stringify({ total_blobs: allRows.length, by_classification: totals, duplicate_blob_rows: duplicateRowCount, restore_all_verified: manifestRepos.every((r) => r.restore_drill_refs_identical) }, null, 2));
