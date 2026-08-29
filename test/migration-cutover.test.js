import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { runMigration } from '../scripts/migrate-data.mjs';
import { runCutover } from '../scripts/cutover.mjs';
import { runReconcile } from '../scripts/reconcile.mjs';

const LEDGER = JSON.stringify({
  records: [
    { source_repo: 'zaffhub', source_ref: 'main', path: 'src/index.js', blob_sha: 'abc', size: 100, class: 'PORT', canonical_destination: 'packages/affiliate/src/index.js' },
    { source_repo: 'tiktok-shop-sdk', source_ref: 'main', path: 'src/client.ts', blob_sha: 'def', size: 200, class: 'REWRITE', canonical_destination: 'packages/tiktok-shop/src/client.js' },
    { source_repo: 'ztsaff', source_ref: 'main', path: 'src/utils.php', blob_sha: 'ghi', size: 50, class: 'DROP-UNRELATED', canonical_destination: null }
  ]
}, null, 2);

function setupLedger() {
  mkdirSync('docs/migration', { recursive: true });
  writeFileSync('docs/migration/SOURCE-SNAPSHOT-LEDGER.json', LEDGER);
}

test('migration is idempotent and balanced across dry-run and live', () => {
  setupLedger();
  const dry = runMigration({ dryRun: true });
  assert.equal(dry.transformed, 2);
  assert.equal(dry.skipped, 1);
  assert.equal(dry.balanced, true);
  assert.equal(dry.dryRun, true);
  const live = runMigration({ dryRun: false });
  assert.equal(live.transformed, dry.transformed);
  assert.equal(live.skipped, dry.skipped);
  assert.equal(live.balanced, true);
  assert.equal(live.dryRun, false);
  assert.ok(typeof live.sha256 === 'string' && live.sha256.length > 0);
  const secondLive = runMigration({ dryRun: false });
  assert.equal(live.sha256, secondLive.sha256);
});

test('cutover transitions through phases and reports rollback availability', () => {
  const dry = runCutover({ phase: 'dry-run' });
  assert.equal(dry.phase, 'dry-run');
  assert.equal(dry.rollbackAvailable, false);
  const shadow = runCutover({ phase: 'shadow' });
  assert.equal(shadow.phase, 'shadow');
  assert.equal(shadow.rollbackAvailable, true);
  assert.ok(shadow.checks.dualWriteEnabled === true);
  const enable = runCutover({ phase: 'enable' });
  assert.equal(enable.checks.routingFlipped, true);
  const rollback = runCutover({ phase: 'rollback' });
  assert.equal(rollback.checks.routingReverted, true);
});

test('reconcile balanced true and detects delta via forced imbalance', () => {
  mkdirSync('dist', { recursive: true });
  const balancedInput = { recorded: [{ amountMinorUnits: 1000 }], attributed: [{ creditMinorUnits: 1000 }] };
  writeFileSync('dist/commissions-evidence.json', JSON.stringify(balancedInput));
  const balanced = runReconcile({ dataset: 'commissions' });
  assert.equal(balanced.balanced, true);
  assert.equal(balanced.deltaMinorUnits, 0);
  const imbalancedInput = { recorded: [{ amountMinorUnits: 1000 }], attributed: [{ creditMinorUnits: 900 }] };
  writeFileSync('dist/commissions-evidence.json', JSON.stringify(imbalancedInput));
  const imbalanced = runReconcile({ dataset: 'commissions' });
  assert.equal(imbalanced.balanced, false);
  assert.equal(imbalanced.deltaMinorUnits, -100);
});
