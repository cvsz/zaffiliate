const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const BUMP_LEVELS = ['major', 'minor', 'patch', 'prerelease'];

export function isValidVersion(value) {
  return typeof value === 'string' && SEMVER_PATTERN.test(value);
}

export function parseVersion(value) {
  if (typeof value !== 'string') throw new Error(`version must be a semver string, received ${typeof value}`);
  const match = SEMVER_PATTERN.exec(value);
  if (!match) throw new Error(`invalid semver version: ${JSON.stringify(value)}`);
  return Object.freeze({
    raw: value,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: Object.freeze(match[4] === undefined ? [] : match[4].split('.')),
    build: Object.freeze(match[5] === undefined ? [] : match[5].split('.'))
  });
}

function isNumericIdentifier(identifier) {
  return /^\d+$/.test(identifier);
}

function compareNumericIdentifiers(a, b) {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const a = left[index];
    const b = right[index];
    const aNumeric = isNumericIdentifier(a);
    const bNumeric = isNumericIdentifier(b);
    if (aNumeric && bNumeric) {
      const order = compareNumericIdentifiers(a, b);
      if (order !== 0) return order;
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  if (left.length === right.length) return 0;
  return left.length < right.length ? -1 : 1;
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return comparePrerelease(left.prerelease, right.prerelease);
}

function formatVersion({ major, minor, patch, prerelease }) {
  const suffix = prerelease.length > 0 ? `-${prerelease.join('.')}` : '';
  return `${major}.${minor}.${patch}${suffix}`;
}

export function bumpVersion(value, level) {
  if (typeof level !== 'string' || !BUMP_LEVELS.includes(level)) {
    throw new Error(`bump level must be one of ${BUMP_LEVELS.join('|')}, received ${JSON.stringify(level ?? null)}`);
  }
  const parsed = parseVersion(value);
  if (level === 'major') return formatVersion({ major: parsed.major + 1, minor: 0, patch: 0, prerelease: [] });
  if (level === 'minor') return formatVersion({ major: parsed.major, minor: parsed.minor + 1, patch: 0, prerelease: [] });
  if (level === 'patch') return formatVersion({ major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1, prerelease: [] });
  if (parsed.prerelease.length === 0) {
    return formatVersion({ major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1, prerelease: ['0'] });
  }
  const prerelease = [...parsed.prerelease];
  let incremented = false;
  for (let index = prerelease.length - 1; index >= 0; index -= 1) {
    if (isNumericIdentifier(prerelease[index])) {
      prerelease[index] = String(Number(prerelease[index]) + 1);
      incremented = true;
      break;
    }
  }
  if (!incremented) prerelease.push('0');
  return formatVersion({ major: parsed.major, minor: parsed.minor, patch: parsed.patch, prerelease });
}
