import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256, createReleaseManifest, serializeReleaseManifest, manifestDigest } from '../packages/release/src/manifest.js';

test('sha256 is deterministic', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('release manifest sorts artifacts and source snapshots deterministically', () => {
  const manifest = createReleaseManifest({
    version: '0.1.0-rc.1', commitSha: 'abc123', createdAt: '2026-08-22T12:00:00Z',
    artifacts: [
      { name: 'web.tar', mediaType: 'application/x-tar', sha256: 'b', size: 2 },
      { name: 'api.tar', mediaType: 'application/x-tar', sha256: 'a', size: 1 }
    ],
    sourceSnapshots: [{ repo: 'cvsz/ztsaff', sha: '2' }, { repo: 'cvsz/zaffhub', sha: '1' }],
    ci: { workflow: 'CI', conclusion: 'success' }
  });
  assert.deepEqual(manifest.artifacts.map((a) => a.name), ['api.tar','web.tar']);
  assert.deepEqual(manifest.sourceSnapshots.map((s) => s.repo), ['cvsz/zaffhub','cvsz/ztsaff']);
  assert.match(manifestDigest(manifest), /^[a-f0-9]{64}$/);
  assert.equal(serializeReleaseManifest(manifest).endsWith('\n'), true);
});
