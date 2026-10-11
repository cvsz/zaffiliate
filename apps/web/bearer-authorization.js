// Bounded, linear-time parser for the HTTP Authorization: Bearer credential.
// Do not apply an unbounded regular expression to attacker-controlled headers.
const MAX_AUTHORIZATION_LENGTH = 4096;

export function parseBearerAuthorization(value) {
  if (typeof value !== 'string' || value.length > MAX_AUTHORIZATION_LENGTH) return null;
  if (value.slice(0, 6).toLowerCase() !== 'bearer') return null;
  if (value[6] !== ' ' && value[6] !== '\t') return null;

  let start = 7;
  while (value[start] === ' ' || value[start] === '\t') start += 1;
  let end = value.length;
  while (end > start && (value[end - 1] === ' ' || value[end - 1] === '\t')) end -= 1;
  if (start === end) return null;

  // Bearer tokens are opaque credentials, never multi-word values.
  for (let i = start; i < end; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return null;
  }
  return value.slice(start, end);
}
