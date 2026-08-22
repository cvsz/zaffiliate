# Credential Rotation Evidence

Template for recording EP-01 credential rotation without storing secrets. All evidence entries must reference hashes of external confirmations, not secret values.

## Rotation Evidence Table

| Credential Name | Source Repo | Rotation Status | Rotation Date | Rotated By | Evidence Reference (SHA-256) | Notes |
|---|---|---|---|---|---|---|
| JWT_SECRET | cvsz/ztsaff | pending |  |  |  |  |
| DATABASE_URL | cvsz/ztsaff | pending |  |  |  |  |
| ADMIN_BOOTSTRAP_KEY | cvsz/ztsaff | pending |  |  |  |  |
| Gitea artifact_key | cvsz/ztsaff | pending |  |  |  | Source: zgitea-v8/secrets/artifact_key |
| MinIO root password | cvsz/ztsaff | pending |  |  |  | Source: zgitea-v8/secrets/minio_root_password |
| MinIO root user | cvsz/ztsaff | pending |  |  |  | Source: zgitea-v8/secrets/minio_root_user |
| Webhook HMAC key | cvsz/ztsaff | pending |  |  |  | Source: zgitea-v8/secrets/webhook_hmac_key |
| DB_HOST | cvsz/zlttbots | pending |  |  |  | Source: configs/env/production.env |
| DB_PORT | cvsz/zlttbots | pending |  |  |  | Source: configs/env/production.env |
| DB_NAME | cvsz/zlttbots | pending |  |  |  | Source: configs/env/production.env |
| DB_USER | cvsz/zlttbots | pending |  |  |  | Source: configs/env/production.env |
| DB_PASSWORD | cvsz/zlttbots | pending |  |  |  | Source: configs/env/production.env |
| REDIS_HOST | cvsz/zlttbots | pending |  |  |  | Source: configs/env/production.env |
| REDIS_PORT | cvsz/zlttbots | pending |  |  |  | Source: configs/env/production.env |
| API_HOST | cvsz/zlttbots | pending |  |  |  | Source: configs/env/production.env |
| ENV | cvsz/zlttbots | pending |  |  |  | Source: configs/env/production.env |
| External Secrets (YAML) | cvsz/zlttbots | pending |  |  |  | Source: infrastructure/k8s/enterprise/secrets/external-secrets.yaml; no specific key names identified in scan |
| PR_BOT_ROOT | cvsz/zlttbots | pending |  |  |  | Source: tests/security_platform/test_pr_bot_extension.py; verify if active credential or test fixture |
| result | cvsz/zlttbots | pending |  |  |  | Source: tests/security_platform/test_pr_bot_extension.py; likely test variable, verify before rotation |
| bandit | cvsz/zlttbots | pending |  |  |  | Source: tests/security_platform/test_pr_bot_extension.py; likely test variable, verify before rotation |
| snapshot | cvsz/zlttbots | pending |  |  |  | Source: tests/security_platform/test_pr_bot_extension.py; likely test variable, verify before rotation |
| payload | cvsz/zlttbots | pending |  |  |  | Source: tests/security_platform/test_pr_bot_extension.py; likely test variable, verify before rotation |
| secret | cvsz/zlttbots | pending |  |  |  | Source: tests/security_platform/test_pr_bot_extension.py; likely test variable, verify before rotation |
| digest | cvsz/zlttbots | pending |  |  |  | Source: tests/security_platform/test_pr_bot_extension.py; likely test variable, verify before rotation |
| signature | cvsz/zlttbots | pending |  |  |  | Source: tests/security_platform/test_pr_bot_extension.py; likely test variable, verify before rotation |
| store | cvsz/zlttbots | pending |  |  |  | Source: tests/security_platform/test_pr_bot_extension.py; likely test variable, verify before rotation |
| NODE_ENV | cvsz/zttlbots | pending |  |  |  | Source: zlinebot-lean/.env |
| PORT | cvsz/zttlbots | pending |  |  |  | Source: zlinebot-lean/.env |
| HOST | cvsz/zttlbots | pending |  |  |  | Source: zlinebot-lean/.env |
| LINE_CHANNEL_SECRET | cvsz/zttlbots | pending |  |  |  | Source: zlinebot-lean/.env |
| LINE_CHANNEL_ACCESS_TOKEN | cvsz/zttlbots | pending |  |  |  | Source: zlinebot-lean/.env |
| TIKTOK_VERIFY_TOKEN | cvsz/zttlbots | pending |  |  |  | Source: zlinebot-lean/.env |
| REDIS_URL | cvsz/zttlbots | pending |  |  |  | Source: zlinebot-lean/.env |

## Instructions

### Recording Evidence

1. Do not store secret values, partial secrets, or derivable fragments in this document.
2. For each rotated credential, compute `SHA-256( confirmation_blob )` where `confirmation_blob` is one of:
   - The full response body from the provider's credential rotation API call.
   - The raw content of the rotation confirmation email (including headers).
   - The provider dashboard screenshot exported as PDF with visible timestamp and credential ID.
3. Record only the hex-encoded SHA-256 digest in the **Evidence Reference** column.
4. Retain the original confirmation artifact in the evidence store with path: `evidence/credential-rotation/<CREDENTIAL_NAME>/<YYYYMMDD>-<ACTOR>.json`.

### Verifying No Active Credential Originates from Legacy Material

1. Enumerate all active secrets in the canonical secret store (e.g., Vault, AWS Secrets Manager, Kubernetes external-secrets).
2. For each active secret, compare its creation timestamp and rotation history against the legacy material snapshot ledger (`docs/migration/evidence/blob-ledger.json`).
3. Reject any secret whose value matches or is trivially derived from legacy material (same raw bytes, base64 variants, or simple character substitutions).
4. Document negative findings in the **Notes** column with the verification date and verifier identity.

### Sign-off Template

```
Rotation Sign-off
=================
Credential: <CREDENTIAL_NAME>
Legacy Source: <SOURCE_REPO/PATH>
Rotation Date: <YYYY-MM-DD>
Rotated By: <ACTOR/ROLE>
Evidence SHA-256: <HEX_DIGEST>
Verification Method: <provider API / dashboard export / email confirmation>
Verified No Legacy Reuse: [ ] Yes  [ ] No
Notes:
```

## Stop-the-Line Condition

If any row shows **Rotation Status** as `pending` or `rotated` but the **Evidence Reference** column is empty or the referenced SHA-256 cannot be independently reproduced from the stored confirmation artifact, the credential is **not considered rotated**. All downstream release gates depending on EP-01 must halt until evidence is complete and reproducible.
