import { mkdir, writeFile } from 'node:fs/promises';

const rotatedAtRaw = String(process.env.LEGACY_CREDENTIAL_ROTATION_AT ?? '').trim();
const evidenceSha = String(process.env.LEGACY_CREDENTIAL_ROTATION_EVIDENCE_SHA256 ?? '').trim().toLowerCase();
const incidentRef = String(process.env.LEGACY_CREDENTIAL_INCIDENT_REF ?? '').trim();

const rotatedAt = new Date(rotatedAtRaw);
const validDate = rotatedAtRaw && !Number.isNaN(rotatedAt.getTime()) && rotatedAt.getTime() <= Date.now();
const validSha = /^[a-f0-9]{64}$/.test(evidenceSha);
const validRef = incidentRef.length >= 3 && incidentRef.length <= 200;

const evidence = {
  checkedAt: new Date().toISOString(),
  rotatedAt: validDate ? rotatedAt.toISOString() : null,
  evidenceSha256Present: validSha,
  incidentRefPresent: validRef,
  decision: validDate && validSha && validRef ? 'PASS' : 'BLOCKED',
  note: 'No credential values are accepted or emitted by this gate.'
};
await mkdir('dist/release-evidence', { recursive: true });
await writeFile('dist/release-evidence/legacy-credential-rotation.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
if (evidence.decision !== 'PASS') process.exit(1);
