import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicClickId, normalizeClickProvenance } from '../packages/db/src/click-identity.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const TOUCHPOINT = Object.freeze({
  source: 'shopee',
  medium: 'affiliate',
  occurredAt: '2026-09-19T12:34:56Z',
  visitorHash: 'visitor-stable'
});

test('click replay identity is deterministic for canonical provenance', () => {
  const first = deterministicClickId(TENANT, 'lnk_test', TOUCHPOINT);
  const second = deterministicClickId(TENANT, 'lnk_test', {
    ...TOUCHPOINT,
    occurredAt: '2026-09-19T12:34:56.000Z'
  });

  assert.equal(second, first);
  assert.match(first, /^clk_[A-Za-z0-9_-]{43}$/);
});

test('tenant identity is part of the replay boundary', () => {
  assert.notEqual(
    deterministicClickId(TENANT, 'lnk_test', TOUCHPOINT),
    deterministicClickId(OTHER_TENANT, 'lnk_test', TOUCHPOINT)
  );
});

test('link and attribution provenance are part of the replay boundary', () => {
  const baseline = deterministicClickId(TENANT, 'lnk_test', TOUCHPOINT);
  assert.notEqual(baseline, deterministicClickId(TENANT, 'lnk_other', TOUCHPOINT));
  assert.notEqual(baseline, deterministicClickId(TENANT, 'lnk_test', { ...TOUCHPOINT, source: 'lazada' }));
  assert.notEqual(baseline, deterministicClickId(TENANT, 'lnk_test', { ...TOUCHPOINT, visitorHash: 'visitor-other' }));
});

test('normalization is Unicode NFC and timestamp canonical', () => {
  const normalized = normalizeClickProvenance(TENANT, 'lnk_test', {
    ...TOUCHPOINT,
    source: 'cafe\u0301'
  });
  assert.equal(normalized.source, 'café');
  assert.equal(normalized.occurredAt, '2026-09-19T12:34:56.000Z');
});
