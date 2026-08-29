import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { rm, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { bumpVersion, compareVersions, isValidVersion, parseVersion } from '../packages/release/src/version.js';
import { extractChangelogEntries, parseConventionalSubject, unreleasedSection, writeChangelog } from '../packages/release/src/changelog.js';

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('parseVersion accepts valid semver strings and returns frozen contracts', () => {
  const valid = [
    '0.0.0',
    '1.2.3',
    '10.20.30',
    '1.2.3-alpha',
    '1.2.3-alpha.1',
    '1.2.3-0.3.7',
    '1.2.3-x.7.z.92',
    '1.2.3-alpha+build.5',
    '1.2.3+20130313144700',
    '1.2.3-beta+exp.sha.5114f85'
  ];
  for (const raw of valid) {
    const parsed = parseVersion(raw);
    assert.equal(parsed.raw, raw);
    assert.ok(Object.isFrozen(parsed));
    assert.ok(Object.isFrozen(parsed.prerelease));
    assert.ok(Object.isFrozen(parsed.build));
  }
  const parsed = parseVersion('1.2.3-rc.2+build.7');
  assert.deepEqual([parsed.major, parsed.minor, parsed.patch], [1, 2, 3]);
  assert.deepEqual([...parsed.prerelease], ['rc', '2']);
  assert.deepEqual([...parsed.build], ['build', '7']);
  assert.deepEqual([...parseVersion('1.2.3').prerelease], []);
  assert.deepEqual([...parseVersion('1.2.3').build], []);
});

test('parseVersion rejects malformed versions fail-closed', () => {
  const invalid = [
    '1.2',
    '1',
    '1.2.3.4',
    'v1.2.3',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-',
    '1.2.3+',
    '1.2.3-alpha.',
    '1.2.3-alpha..1',
    '1.2.3-01',
    '1.2.3-01.2',
    '1.2.3-a_b',
    '1.2.3+#.1',
    '1.2.3-alpha.01',
    '',
    '   ',
    'not-a-version',
    '1.2.3 ',
    ' 1.2.3',
    null,
    undefined,
    42,
    {},
    []
  ];
  for (const raw of invalid) {
    assert.throws(() => parseVersion(raw), Error, `expected rejection for ${JSON.stringify(raw) ?? String(raw)}`);
  }
});

test('isValidVersion reports validity without throwing', () => {
  assert.equal(isValidVersion('1.2.3'), true);
  assert.equal(isValidVersion('1.2.3-rc.1+build'), true);
  assert.equal(isValidVersion('1.2'), false);
  assert.equal(isValidVersion('v1.2.3'), false);
  assert.equal(isValidVersion(''), false);
  assert.equal(isValidVersion(null), false);
  assert.equal(isValidVersion(123), false);
});

test('compareVersions implements full semver precedence including prerelease rules', () => {
  const ascending = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0'
  ];
  for (let i = 0; i < ascending.length; i += 1) {
    for (let j = i + 1; j < ascending.length; j += 1) {
      assert.equal(compareVersions(ascending[i], ascending[j]), -1, `${ascending[i]} < ${ascending[j]}`);
      assert.equal(compareVersions(ascending[j], ascending[i]), 1, `${ascending[j]} > ${ascending[i]}`);
    }
  }
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0+build.1', '1.0.0+other'), 0);
  assert.equal(compareVersions('1.0.0-alpha.1+meta', '1.0.0-alpha.1'), 0);
  assert.equal(compareVersions('2.1.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1);
  assert.equal(compareVersions('1.0.0-2', '1.0.0-11'), -1);
  assert.equal(compareVersions('1.2.3', '1.2.3-0'), 1);
  assert.throws(() => compareVersions('1.2', '1.2.3'));
  assert.throws(() => compareVersions('1.2.3', null));
});

test('bumpVersion resets lower components per semver spec', () => {
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(bumpVersion('1.2.3-alpha.1+build', 'major'), '2.0.0');
  assert.equal(bumpVersion('1.2.3-rc.1+meta', 'minor'), '1.3.0');
  assert.equal(bumpVersion('1.2.3-alpha', 'patch'), '1.2.4');
  assert.equal(bumpVersion('1.2.3', 'prerelease'), '1.2.4-0');
  assert.equal(bumpVersion('1.2.3-0', 'prerelease'), '1.2.3-1');
  assert.equal(bumpVersion('1.2.3-alpha', 'prerelease'), '1.2.3-alpha.0');
  assert.equal(bumpVersion('1.2.3-alpha.1', 'prerelease'), '1.2.3-alpha.2');
  assert.equal(bumpVersion('1.2.3-alpha.beta', 'prerelease'), '1.2.3-alpha.beta.0');
  assert.equal(bumpVersion('1.2.3-alpha.1.beta.2', 'prerelease'), '1.2.3-alpha.1.beta.3');
  assert.equal(bumpVersion('1.2.3-rc.1', 'prerelease'), '1.2.3-rc.2');
  assert.equal(bumpVersion('1.2.3-alpha.1+b', 'prerelease'), '1.2.3-alpha.2');
  assert.throws(() => bumpVersion('1.2.3', 'build'));
  assert.throws(() => bumpVersion('1.2.3', ''));
  assert.throws(() => bumpVersion('1.2.3', null));
  assert.throws(() => bumpVersion('1.2', 'major'));
});

test('parseConventionalSubject parses type, scope, bang and description', () => {
  assert.deepEqual(parseConventionalSubject('feat(api)!: add x'), {
    type: 'feat', scope: 'api', breaking: true, subject: 'add x'
  });
  assert.deepEqual(parseConventionalSubject('fix: repair y'), {
    type: 'fix', scope: '', breaking: false, subject: 'repair y'
  });
  assert.equal(parseConventionalSubject('merge branch into main'), null);
  assert.equal(parseConventionalSubject('testing: nope'), null);
  assert.equal(parseConventionalSubject('feat:no-space'), null);
  assert.equal(parseConventionalSubject(undefined), null);
});

test('extractChangelogEntries groups conventional commits into deterministic sections', () => {
  const result = extractChangelogEntries({
    commits: [
      { sha: 'c3', subject: 'chore: tidy deps' },
      { sha: 'c1', subject: 'feat(api): add endpoint' },
      { sha: 'c2', subject: 'fix!: drop legacy auth' },
      { sha: 'c4', subject: 'docs: update readme' },
      { sha: 'c5', subject: 'perf(db): index lookups' },
      { sha: 'c6', subject: 'feat: root feature' },
      { sha: 'c7', subject: 'ci: cache installs' },
      { sha: 'c8', subject: 'refactor(core): split module' },
      { sha: 'c9', subject: 'security: patch dependency' },
      { sha: 'c10', subject: 'test: cover signing' },
      { sha: 'c11', type: 'fix', subject: 'patch crash on empty cart', breaking: true }
    ]
  });
  assert.equal(result.total, 11);
  assert.deepEqual(result.sections.map((section) => section.name), [
    'Added', 'Fixed', 'Changed', 'Performance', 'Security', 'Docs', 'CI', 'Tests', 'Chore'
  ]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.sections));
  const added = result.sections[0];
  assert.deepEqual(added.entries.map((entry) => entry.scope), ['', 'api']);
  assert.deepEqual(added.entries.map((entry) => entry.subject), ['root feature', 'add endpoint']);
  assert.ok(Object.isFrozen(added));
  assert.ok(Object.isFrozen(added.entries));
  const fixed = result.sections[1];
  assert.deepEqual(fixed.entries.map((entry) => entry.subject), ['drop legacy auth', 'patch crash on empty cart']);
  assert.deepEqual(fixed.entries.map((entry) => entry.breaking), [true, true]);
  assert.deepEqual(result.sections[2].entries.map((entry) => entry.type), ['refactor']);
  assert.deepEqual(result.sections[8].entries.map((entry) => entry.subject), ['tidy deps']);
});

test('extractChangelogEntries is fail-closed on malformed input', () => {
  assert.throws(() => extractChangelogEntries());
  assert.throws(() => extractChangelogEntries({ commits: 'nope' }));
  assert.throws(() => extractChangelogEntries({ commits: [{ sha: 'x', subject: 'not conventional' }] }));
  assert.throws(() => extractChangelogEntries({ commits: [{ sha: 'x', type: 'deploy', subject: 'ship it' }] }));
  assert.throws(() => extractChangelogEntries({ commits: [{ subject: 'feat: missing sha' }] }));
  assert.throws(() => extractChangelogEntries({ commits: [{ sha: 'x', subject: 'feat: ok', breaking: 'yes' }] }));
  assert.throws(() => extractChangelogEntries({ commits: [{ sha: 'x', subject: 'feat: ok', scope: 7 }] }));
  assert.throws(() => extractChangelogEntries({ commits: [{ sha: 'x', type: 'feat', subject: '' }] }));
});

test('unreleasedSection renders deterministic markdown with BREAKING markers', () => {
  const extracted = extractChangelogEntries({
    commits: [
      { sha: 'b', subject: 'fix!: drop legacy auth' },
      { sha: 'a', subject: 'feat(api): add endpoint' }
    ]
  });
  const section = unreleasedSection(extracted, { version: '1.2.0', date: '2026-08-22' });
  assert.equal(section, [
    '## [1.2.0] - 2026-08-22',
    '',
    '### Added',
    '',
    '- feat(api): add endpoint',
    '',
    '### Fixed',
    '',
    '- fix: drop legacy auth **BREAKING**'
  ].join('\n') + '\n');
  const empty = unreleasedSection(extractChangelogEntries({ commits: [] }), { version: '0.0.1', date: '2026-01-01' });
  assert.equal(empty, '## [0.0.1] - 2026-01-01\n');
  assert.throws(() => unreleasedSection(extracted, { version: '1.2', date: '2026-08-22' }));
  assert.throws(() => unreleasedSection(extracted, { version: '1.2.0', date: '' }));
  assert.throws(() => unreleasedSection(extracted, { version: '1.2.0' }));
  assert.throws(() => unreleasedSection([{ sha: 'a' }], { version: '1.2.0', date: '2026-08-22' }));
  assert.throws(() => unreleasedSection(extracted, { version: '1.2.0', date: '   ' }));
});

test('writeChangelog prepends under the heading idempotently', () => {
  const section = unreleasedSection(
    extractChangelogEntries({ commits: [{ sha: 'a', subject: 'feat: x' }] }),
    { version: '1.0.0', date: '2026-08-22' }
  );
  const fresh = writeChangelog('', section);
  assert.equal(fresh, '# Changelog\n\n## [1.0.0] - 2026-08-22\n\n### Added\n\n- feat: x\n');
  const repeated = writeChangelog(fresh, section);
  assert.equal(repeated, fresh);
  const older = '# Changelog\n\n## [0.9.0] - 2026-01-01\n\n- fix: old\n';
  const updated = writeChangelog(older, section);
  assert.equal(updated, '# Changelog\n\n## [1.0.0] - 2026-08-22\n\n### Added\n\n- feat: x\n\n## [0.9.0] - 2026-01-01\n\n- fix: old\n');
  const withoutHeading = '## [0.9.0] - 2026-01-01\n\n- fix: old\n';
  const withHeading = writeChangelog(withoutHeading, section);
  assert.equal(withHeading, '# Changelog\n\n## [1.0.0] - 2026-08-22\n\n### Added\n\n- feat: x\n\n## [0.9.0] - 2026-01-01\n\n- fix: old\n');
  assert.throws(() => writeChangelog(null, section));
  assert.throws(() => writeChangelog(undefined, section));
  assert.throws(() => writeChangelog('', ''));
  assert.throws(() => writeChangelog('', '## [bogus] - 2026-08-22\n\n- feat: x\n'));
  assert.throws(() => writeChangelog('', '- feat: x\n'));
});

test('generate-changelog draft script runs against a tiny temp git repo', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'zaffiliate-changelog-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const git = (...args) => execFileAsync('git', ['-C', dir, ...args]);
  await git('init', '-b', 'main');
  await git('config', 'user.email', 'changelog@example.com');
  await git('config', 'user.name', 'Changelog Test');
  await writeFile(join(dir, 'init.txt'), 'init\n');
  await git('add', '.');
  await git('-c', 'commit.gpgsign=false', 'commit', '-m', 'chore: init');
  const firstSha = (await git('rev-parse', 'HEAD')).stdout.trim();
  await writeFile(join(dir, 'feature.txt'), 'feature\n');
  await git('add', '.');
  await git('-c', 'commit.gpgsign=false', 'commit', '-m', 'feat: x');
  await writeFile(join(dir, 'fix.txt'), 'fix\n');
  await git('add', '.');
  await git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fix!: y');
  const scriptPath = join(repoRoot, 'scripts', 'generate-changelog.mjs');
  const draftPath = join(dir, 'CHANGELOG.draft.md');
  const firstRun = await execFileAsync(process.execPath, [scriptPath, firstSha, 'HEAD', draftPath], { cwd: dir });
  assert.equal(JSON.parse(firstRun.stdout).event, 'changelog_draft_generated');
  const draft = await readFile(draftPath, 'utf8');
  assert.match(draft, /^# Changelog$/m);
  assert.match(draft, /^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}$/m);
  assert.match(draft, /^### Added$/m);
  assert.match(draft, /^- feat: x$/m);
  assert.match(draft, /^### Fixed$/m);
  assert.match(draft, /^- fix: y \*\*BREAKING\*\*$/m);
  assert.doesNotMatch(draft, /chore: init/);
  await execFileAsync(process.execPath, [scriptPath, firstSha, 'HEAD', draftPath], { cwd: dir });
  assert.equal(await readFile(draftPath, 'utf8'), draft);
  await assert.rejects(
    execFileAsync(process.execPath, [scriptPath, 'no-such-ref-anywhere', 'HEAD', draftPath], { cwd: dir }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(String(error.stderr), /git log failed/);
      return true;
    }
  );
});
