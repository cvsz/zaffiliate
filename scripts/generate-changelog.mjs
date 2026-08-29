import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { extractChangelogEntries, parseConventionalSubject, unreleasedSection, writeChangelog } from '../packages/release/src/changelog.js';

const execFileAsync = promisify(execFile);

function usage() {
  return 'usage: node scripts/generate-changelog.mjs [fromRef=HEAD~10] [toRef=HEAD] [outputPath=CHANGELOG.draft.md]';
}

async function main() {
  const fromRef = process.argv[2] || 'HEAD~10';
  const toRef = process.argv[3] || 'HEAD';
  const outputPath = process.argv[4] ? resolve(process.argv[4]) : new URL('../CHANGELOG.draft.md', import.meta.url);
  let stdout;
  try {
    ({ stdout } = await execFileAsync('git', ['log', '--pretty=format:%H%x09%s', `${fromRef}..${toRef}`], {
      maxBuffer: 32 * 1024 * 1024
    }));
  } catch (error) {
    const detail = String(error.stderr || error.message || 'unknown git failure').trim();
    console.error(`generate-changelog: git log failed for range ${fromRef}..${toRef}: ${detail}`);
    process.exitCode = 1;
    return;
  }
  const commits = stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const separator = line.indexOf('\t');
      return {
        sha: separator === -1 ? line : line.slice(0, separator),
        subject: separator === -1 ? '' : line.slice(separator + 1)
      };
    })
    .filter((commit) => parseConventionalSubject(commit.subject) !== null);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const version = process.env.RELEASE_VERSION || pkg.version;
  const date = new Date().toISOString().slice(0, 10);
  const section = unreleasedSection(extractChangelogEntries({ commits }), { version, date });
  let existing = '';
  try {
    existing = await readFile(outputPath, 'utf8');
  } catch {}
  const content = writeChangelog(existing, section);
  await writeFile(outputPath, content);
  console.log(JSON.stringify({
    event: 'changelog_draft_generated',
    version,
    range: `${fromRef}..${toRef}`,
    commits: commits.length,
    output: String(outputPath)
  }));
}

main().catch((error) => {
  console.error(`generate-changelog: ${error && error.message ? error.message : error}`);
  console.error(usage());
  process.exitCode = 1;
});
