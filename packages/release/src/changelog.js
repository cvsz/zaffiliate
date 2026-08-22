import { isValidVersion } from './version.js';

const SECTION_BY_TYPE = Object.freeze({
  feat: 'Added',
  fix: 'Fixed',
  refactor: 'Changed',
  perf: 'Performance',
  security: 'Security',
  docs: 'Docs',
  ci: 'CI',
  test: 'Tests',
  chore: 'Chore'
});

export const CHANGELOG_TYPES = Object.freeze(Object.keys(SECTION_BY_TYPE));
export const CHANGELOG_SECTIONS = Object.freeze(Object.values(SECTION_BY_TYPE));

const CONVENTIONAL_PATTERN = new RegExp(`^(${CHANGELOG_TYPES.join('|')})(?:\\(([^)]+)\\))?(!)?: (.+)$`);
const HEADING = '# Changelog';
const SECTION_HEADING_PATTERN = /^## \[([^\]]+)\] - (.+)$/m;

function compareText(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

export function parseConventionalSubject(subject) {
  if (typeof subject !== 'string') return null;
  const match = CONVENTIONAL_PATTERN.exec(subject);
  if (!match) return null;
  return Object.freeze({
    type: match[1],
    scope: match[2] || '',
    breaking: match[3] === '!',
    subject: match[4].trim()
  });
}

function toEntry(commit, index) {
  const label = `commits[${index}]`;
  if (typeof commit !== 'object' || commit === null || Array.isArray(commit)) {
    throw new Error(`${label} must be an object`);
  }
  const sha = requiredString(commit.sha, `${label}.sha`);
  if (commit.breaking !== undefined && typeof commit.breaking !== 'boolean') {
    throw new Error(`${label}.breaking must be a boolean`);
  }
  if (commit.scope !== undefined && (typeof commit.scope !== 'string' || !commit.scope.trim())) {
    throw new Error(`${label}.scope must be a non-empty string`);
  }
  if (typeof commit.type === 'string' && commit.type.trim()) {
    const type = commit.type.trim();
    if (!SECTION_BY_TYPE[type]) throw new Error(`${label}.type is not a known changelog type: ${type}`);
    return Object.freeze({
      sha,
      type,
      scope: typeof commit.scope === 'string' ? commit.scope.trim() : '',
      subject: requiredString(commit.subject, `${label}.subject`),
      breaking: commit.breaking === true
    });
  }
  const parsed = parseConventionalSubject(commit.subject);
  if (!parsed) {
    throw new Error(`${label} is not a conventional commit: ${JSON.stringify(commit.subject ?? null)}`);
  }
  return Object.freeze({
    sha,
    type: parsed.type,
    scope: parsed.scope,
    subject: parsed.subject,
    breaking: parsed.breaking || commit.breaking === true
  });
}

export function extractChangelogEntries({ commits } = {}) {
  if (!Array.isArray(commits)) throw new Error('commits must be an array');
  const entries = commits.map(toEntry);
  const buckets = new Map();
  for (const entry of entries) {
    const section = SECTION_BY_TYPE[entry.type];
    if (!buckets.has(section)) buckets.set(section, []);
    buckets.get(section).push(entry);
  }
  const sections = CHANGELOG_SECTIONS
    .filter((name) => buckets.has(name))
    .map((name) => Object.freeze({
      name,
      entries: Object.freeze(buckets.get(name).sort((a, b) =>
        compareText(a.scope, b.scope) || compareText(a.subject, b.subject) || compareText(a.sha, b.sha)
      ))
    }));
  return Object.freeze({ total: entries.length, sections: Object.freeze(sections) });
}

export function unreleasedSection(entries, { version, date } = {}) {
  if (typeof entries !== 'object' || entries === null || !Array.isArray(entries.sections)) {
    throw new Error('entries must be the result of extractChangelogEntries');
  }
  if (!isValidVersion(version)) throw new Error(`version must be valid semver: ${JSON.stringify(version ?? null)}`);
  const normalizedDate = requiredString(date, 'date');
  const lines = [`## [${version}] - ${normalizedDate}`];
  for (const section of entries.sections) {
    if (typeof section !== 'object' || section === null || !CHANGELOG_SECTIONS.includes(section.name)) {
      throw new Error(`entries contain an unknown changelog section: ${JSON.stringify(section?.name ?? null)}`);
    }
    lines.push('', `### ${section.name}`, '');
    for (const entry of section.entries) {
      const scope = entry.scope ? `(${entry.scope})` : '';
      const marker = entry.breaking ? ' **BREAKING**' : '';
      lines.push(`- ${entry.type}${scope}: ${entry.subject}${marker}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function writeChangelog(existingContent, section) {
  if (typeof existingContent !== 'string') throw new Error('existingContent must be a string');
  if (typeof section !== 'string') throw new Error('section must be a string');
  const trimmedSection = section.replace(/\s+$/, '');
  const headingMatch = trimmedSection.match(SECTION_HEADING_PATTERN);
  if (!headingMatch) throw new Error('section must begin with a "## [version] - date" heading');
  const version = headingMatch[1];
  if (!isValidVersion(version)) throw new Error(`section version is not valid semver: ${version}`);
  if (new RegExp(`^## \\[${escapeRegExp(version)}\\]`, 'm').test(existingContent)) return existingContent;
  const normalized = existingContent.replace(/^\s+/, '');
  const body = normalized.startsWith(HEADING) ? normalized : `${HEADING}\n\n${normalized}`;
  const newlineIndex = body.indexOf('\n');
  const headingLine = newlineIndex === -1 ? body : body.slice(0, newlineIndex + 1);
  const rest = body.slice(headingLine.length).replace(/^\n+/, '');
  if (!rest) return `${headingLine}\n${trimmedSection}\n`;
  return `${headingLine}\n${trimmedSection}\n\n${rest}`;
}
