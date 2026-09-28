import { mkdir, writeFile } from 'node:fs/promises';

const token = String(process.env.GITHUB_TOKEN ?? '').trim();
const repository = String(process.env.GITHUB_REPOSITORY ?? 'cvsz/zaffiliate').trim();
const alertNumber = Number(process.env.CODE_SCANNING_ALERT_NUMBER ?? 2);
if (!token) {
  console.error('GITHUB_TOKEN with code-scanning alert read permission is required');
  process.exit(2);
}
const response = await fetch(`https://api.github.com/repos/${repository}/code-scanning/alerts/${alertNumber}`, {
  headers: {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2026-03-10',
    'user-agent': 'zaffiliate-release-gate'
  },
  signal: AbortSignal.timeout(10000)
});
if (!response.ok) {
  console.error(`Unable to read code scanning alert #${alertNumber}: HTTP ${response.status}`);
  process.exit(2);
}
const alert = await response.json();
const accepted = alert.state === 'fixed' || (alert.state === 'dismissed' && Boolean(alert.dismissed_comment));
const evidence = {
  repository,
  alertNumber,
  checkedAt: new Date().toISOString(),
  state: alert.state,
  rule: alert.rule?.id ?? null,
  severity: alert.rule?.security_severity_level ?? alert.rule?.severity ?? null,
  location: alert.most_recent_instance?.location?.path ?? null,
  fixedAt: alert.fixed_at ?? null,
  dismissedAt: alert.dismissed_at ?? null,
  dismissalReason: alert.dismissed_reason ?? null,
  hasDismissalComment: Boolean(alert.dismissed_comment),
  decision: accepted ? 'PASS' : 'BLOCKED'
};
await mkdir('dist/release-evidence', { recursive: true });
await writeFile('dist/release-evidence/code-scanning-alert.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
if (!accepted) process.exit(1);
