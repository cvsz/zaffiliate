import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReleaseManifest, serializeReleaseManifest, manifestDigest } from '../packages/release/src/manifest.js';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const sourceLedger = JSON.parse(await readFile(new URL('../docs/migration/SOURCE-SNAPSHOT-LEDGER.json', import.meta.url), 'utf8'));
const version = process.env.RELEASE_VERSION || pkg.version;
const commitSha = process.env.GITHUB_SHA || process.env.COMMIT_SHA || 'local-uncommitted';
const createdAt = process.env.RELEASE_CREATED_AT || new Date().toISOString();
const sourceRecords = sourceLedger.sources ?? sourceLedger.records ?? [];
const sourceSnapshots = sourceRecords.map((source) => ({ repo: source.repo ?? source.source_repo, sha: source.snapshot_sha ?? source.blob_sha }));
const manifest = createReleaseManifest({
  version,
  commitSha,
  createdAt,
  artifacts: [],
  sourceSnapshots,
  ci: {
    workflow: process.env.GITHUB_WORKFLOW || 'local',
    runId: process.env.GITHUB_RUN_ID || null,
    runNumber: process.env.GITHUB_RUN_NUMBER || null
  }
});
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/release-manifest.json', import.meta.url), serializeReleaseManifest(manifest));
await writeFile(new URL('../dist/release-manifest.sha256', import.meta.url), `${manifestDigest(manifest)}  release-manifest.json\n`);
console.log(JSON.stringify({ event: 'release_manifest_generated', version, commitSha, digest: manifestDigest(manifest) }));
