import { createHash } from 'node:crypto';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function createReleaseManifest({ version, commitSha, createdAt, artifacts = [], sourceSnapshots = [], ci = {} }) {
  const normalizedArtifacts = artifacts.map((artifact) => Object.freeze({
    name: required(artifact.name, 'artifact.name'),
    mediaType: required(artifact.mediaType, 'artifact.mediaType'),
    sha256: required(artifact.sha256, 'artifact.sha256'),
    size: Number(artifact.size || 0)
  })).sort((a, b) => a.name.localeCompare(b.name));

  const snapshots = sourceSnapshots.map((snapshot) => Object.freeze({
    repo: required(snapshot.repo, 'sourceSnapshot.repo'),
    sha: required(snapshot.sha, 'sourceSnapshot.sha')
  })).sort((a, b) => a.repo.localeCompare(b.repo));

  return Object.freeze({
    schemaVersion: 1,
    product: 'zaffiliate',
    version: required(version, 'version'),
    commitSha: required(commitSha, 'commitSha'),
    createdAt: new Date(required(createdAt, 'createdAt')).toISOString(),
    artifacts: Object.freeze(normalizedArtifacts),
    sourceSnapshots: Object.freeze(snapshots),
    ci: Object.freeze({ ...ci })
  });
}

export function serializeReleaseManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function manifestDigest(manifest) {
  return sha256(serializeReleaseManifest(manifest));
}
