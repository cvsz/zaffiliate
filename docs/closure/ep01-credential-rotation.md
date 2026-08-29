# EP-01 Credential Rotation Detailed Runbook

## Prerequisites

Before beginning any credential rotation, verify the following:

- [ ] Access to each legacy provider admin console:
  - LINE Developers Console (zlttbots / zttlbots)
  - TikTok Shop Seller Center (ztsaff)
  - MinIO Admin Console (ztsaff)
  - Gitea Admin Console (ztsaff)
- [ ] Canonical secret-manager instance is operational and the operator has write access.
- [ ] `rotation-requirements.json` has been reviewed and approved for this rotation window.
- [ ] All team members notified of maintenance window.
- [ ] Backup of current secret values stored in encrypted offline storage (for rollback only).

---

## A) LINE (zlttbots / zttlbots)

### Credentials
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`

### Rotation Steps

1. Log in to the LINE Developers Console for the target channel.
2. Navigate to **Messaging API** > **Channel settings**.
3. Under **Channel secret**, click **Reset** and confirm.
4. Record the API response (JSON body) containing the new secret. Compute its SHA-256 hash for evidence. Do not copy the plaintext secret into logs.
5. Under **Access tokens**, click **Issue** or **Reset** (long-lived) / **Refresh** (short-lived) as appropriate for your token type.
6. Record the API response containing the new token. Compute its SHA-256 hash for evidence. Do not copy the plaintext token into logs.
7. Update the canonical secret-manager references:
   ```
   secret-manager set zlttbots/LINE_CHANNEL_SECRET <new-secret>
   secret-manager set zlttbots/LINE_CHANNEL_ACCESS_TOKEN <new-token>
   ```
8. Redeploy or restart all services consuming these credentials so they pull from the secret-manager at startup.
9. Send a test webhook event to a staging endpoint and verify the signature block validates against the new `LINE_CHANNEL_SECRET`.

### Verification Commands

```bash
# Verify webhook signature (example using LINE SDK or openssl)
curl -X POST https://staging.example.com/webhook/line \
  -H "X-Line-Signature: <expected-signature>" \
  -d '{"events":[]}'
```

### Evidence Recording

Store the following in the rotation evidence log (never store the secret value itself):

```json
{
  "provider": "LINE",
  "channel": "zlttbots",
  "rotation_timestamp": "<ISO-8601>",
  "secret_sha256": "<SHA-256 of API response containing new LINE_CHANNEL_SECRET>",
  "token_sha256": "<SHA-256 of API response containing new LINE_CHANNEL_ACCESS_TOKEN>",
  "confirmation_email_sha256": "<SHA-256 of confirmation email body, if applicable>"
}
```

### Rollback Procedure

1. Retrieve the previous secret and token from encrypted offline backup.
2. In the LINE Developers Console, re-issue a token or reset the secret to the previous value.
3. Update the secret-manager references to the previous values.
4. Redeploy services.
5. Verify webhook signatures with the restored credentials.
6. Document rollback in the evidence log with reason and timestamp.

---

## B) TikTok Shop (ztsaff)

### Credentials
- `TIKTOK_VERIFY_TOKEN`

### Rotation Steps

1. Log in to TikTok Shop Seller Center for the target shop (ztsaff).
2. Navigate to **Settings** > **Developer** > **Webhooks**.
3. Locate the webhook endpoint configuration for this application.
4. Generate a new verify token or update the existing token value.
5. Record the API response or confirmation screen containing the new token. Compute its SHA-256 hash for evidence. Do not copy the plaintext token into logs.
6. Update the webhook endpoint configuration to use the new verify token.
7. Update the canonical secret-manager reference:
   ```
   secret-manager set ztsaff/TIKTOK_VERIFY_TOKEN <new-token>
   ```
8. Redeploy or restart services that compute webhook HMAC signatures.
9. Trigger a test webhook event from TikTok Shop Seller Center and verify the server computes a matching HMAC.

### Verification Commands

```bash
# Verify HMAC signature (example)
echo -n '{"event":"test"}' | openssl dgst -sha256 -hmac "<new-token>"
# Compare output against signature header in incoming webhook
```

### Evidence Recording

Store the following in the rotation evidence log:

```json
{
  "provider": "TikTok Shop",
  "shop": "ztsaff",
  "rotation_timestamp": "<ISO-8601>",
  "token_sha256": "<SHA-256 of API response or confirmation showing new TIKTOK_VERIFY_TOKEN>",
  "confirmation_email_sha256": "<SHA-256 of confirmation email body, if applicable>"
}
```

### Rollback Procedure

1. Retrieve the previous token from encrypted offline backup.
2. In Seller Center, revert the webhook verify token to the previous value.
3. Update the secret-manager reference to the previous token.
4. Redeploy services.
5. Re-trigger a test webhook and verify HMAC validation passes.
6. Document rollback in the evidence log with reason and timestamp.

---

## C) Generic Application Secrets (ztsaff)

### Credentials
- `JWT_SECRET`
- `DATABASE_URL`
- `ADMIN_BOOTSTRAP_KEY`

### Rotation Steps

1. **JWT_SECRET**
   - Generate a new high-entropy secret (minimum 256 bits, e.g., `openssl rand -base64 32`).
   - Update the canonical secret-manager reference:
     ```
     secret-manager set ztsaff/JWT_SECRET <new-secret>
     ```
   - Redeploy services that sign or verify JWTs.
   - Note: existing JWTs signed with the previous secret will become invalid. Force logout if necessary or maintain a grace period with dual-secret verification.

2. **DATABASE_URL**
   - Provision a new database user or rotate the password in your database admin console.
   - Update the canonical secret-manager reference:
     ```
     secret-manager set ztsaff/DATABASE_URL <new-url>
     ```
   - Redeploy services and verify connection pool establishes successfully.
   - Verify application can read and write to the database.

3. **ADMIN_BOOTSTRAP_KEY**
   - Generate a new bootstrap key (minimum 128 bits, e.g., `openssl rand -hex 24`).
   - Update the canonical secret-manager reference:
     ```
     secret-manager set ztsaff/ADMIN_BOOTSTRAP_KEY <new-key>
     ```
   - Redeploy services.
   - Verify that admin bootstrap endpoints reject the old key and accept the new key.

### Verification Commands

```bash
# Verify JWT signing and verification
curl -X POST https://staging.example.com/auth/login \
  -d '{"username":"test","password":"test"}' | jq -r '.token' | cut -d. -f1 | base64 -d 2>/dev/null | jq .

# Verify database connectivity
curl -s https://staging.example.com/health/db | jq .

# Verify admin bootstrap rejection of old key
curl -X POST https://staging.example.com/admin/bootstrap \
  -H "X-Bootstrap-Key: <old-key>" -w "\nHTTP %{http_code}\n"
# Expected: 401 or 403

curl -X POST https://staging.example.com/admin/bootstrap \
  -H "X-Bootstrap-Key: <new-key>" -w "\nHTTP %{http_code}\n"
# Expected: 200 (or appropriate success code)
```

### Evidence Recording

Store the following in the rotation evidence log:

```json
{
  "provider": "Generic",
  "service": "ztsaff",
  "rotation_timestamp": "<ISO-8601>",
  "jwt_secret_sha256": "<SHA-256 of API response or command output confirming JWT_SECRET update>",
  "database_url_sha256": "<SHA-256 of API response or command output confirming DATABASE_URL update>",
  "admin_bootstrap_key_sha256": "<SHA-256 of API response or command output confirming ADMIN_BOOTSTRAP_KEY update>"
}
```

### Rollback Procedure

1. Retrieve previous values from encrypted offline backup.
2. Update secret-manager references to previous values:
   ```
   secret-manager set ztsaff/JWT_SECRET <previous>
   secret-manager set ztsaff/DATABASE_URL <previous>
   secret-manager set ztsaff/ADMIN_BOOTSTRAP_KEY <previous>
   ```
3. Redeploy services.
4. Verify health checks pass and database connectivity is restored.
5. If database rollback is required, restore from the most recent verified backup.
6. Document rollback in the evidence log with reason and timestamp.

---

## D) Object Storage / Git (MinIO / Gitea from ztsaff)

### Credentials
- MinIO access keys and bucket keys
- Gitea access keys

### Rotation Steps

1. **MinIO**
   - Log in to the MinIO Admin Console.
   - Navigate to **Identity** > **Service Accounts**.
   - For each service account associated with ztsaff:
     - Create a new service account with the same policy.
     - Record the new `Access Key` and `Secret Key`. Compute SHA-256 hashes of the API response containing them for evidence. Do not copy plaintext keys into logs.
     - Update applications and CI pipelines to use the new credentials.
     - Verify read/write/delete operations against target buckets.
     - Delete the old service account.
   - Update canonical secret-manager references:
     ```
     secret-manager set ztsaff/MINIO_ACCESS_KEY <new-access-key>
     secret-manager set ztsaff/MINIO_SECRET_KEY <new-secret-key>
     ```

2. **Gitea**
   - Log in to the Gitea Admin Console.
   - Navigate to **Settings** > **Applications** or **Repositories** > **Settings** > **Deploy Keys** as appropriate.
   - Generate a new access token or deploy key.
   - Record the API response or confirmation page containing the new key. Compute its SHA-256 hash for evidence. Do not copy the plaintext key into logs.
   - Update applications and CI pipelines to use the new credential.
   - Verify git operations (clone, push, pull) succeed.
   - Revoke the old token or delete the old deploy key.
   - Update canonical secret-manager reference:
     ```
     secret-manager set ztsaff/GITEA_ACCESS_TOKEN <new-token>
     ```

### Verification Commands

```bash
# Verify MinIO operations
mc ls myminio/bucket-name
mc cp /dev/null myminio/bucket-name/health-check-$(date +%s)

# Verify Gitea access
curl -H "Authorization: token <new-token>" https://gitea.example.com/api/v1/repos/ztsaff/private-repo | jq .
```

### Evidence Recording

Store the following in the rotation evidence log:

```json
{
  "provider": "ObjectStorage/Git",
  "service": "ztsaff",
  "rotation_timestamp": "<ISO-8601>",
  "minio_access_key_sha256": "<SHA-256 of API response containing new MinIO access key>",
  "minio_secret_key_sha256": "<SHA-256 of API response containing new MinIO secret key>",
  "gitea_token_sha256": "<SHA-256 of API response or confirmation containing new Gitea token>"
}
```

### Rollback Procedure

1. Retrieve previous credentials from encrypted offline backup.
2. In MinIO Admin Console, re-enable or re-create the previous service account (if still available) or create a new one with the previous key material if the platform supports it.
3. In Gitea, regenerate a token matching the previous value or restore the previous deploy key.
4. Update secret-manager references to previous values.
5. Redeploy services and CI pipelines.
6. Verify object storage and git operations succeed.
7. Document rollback in the evidence log with reason and timestamp.

---

## Post-Rotation Validation

After completing all provider rotations:

1. **Run secret-scan CI job**
   ```bash
   # Example: trigger secret scan in CI
   curl -X POST https://ci.example.com/pipeline/trigger \
     -H "Authorization: Bearer <ci-token>" \
     -d '{"project":"zaffiliate","job":"secret-scan"}'
   ```
   - Confirm zero new secret exposures.
   - Confirm no plaintext legacy secrets remain in environment variables, config files, or logs.

2. **Run redaction tests**
   ```bash
   # Example test command
   npm run test:redact
   # or
   pytest tests/test_redact.py
   ```
   - All redaction tests must pass.
   - No PII or credential material should appear in log output.

3. **Verify no legacy material in current trees or history**
   ```bash
   # Search current tree for legacy secret references
   rg -i "LINE_CHANNEL_SECRET|LINE_CHANNEL_ACCESS_TOKEN|TIKTOK_VERIFY_TOKEN|JWT_SECRET|DATABASE_URL|ADMIN_BOOTSTRAP_KEY|MINIO_ACCESS_KEY|MINIO_SECRET_KEY|GITEA_ACCESS_TOKEN" --type-add 'secret:*.{json,yaml,yml,env,js,ts,py,sh}' -t secret .

   # Search git history for plaintext secrets (example using truffleHog or gitleaks)
   gitleaks detect --source=. --report-path=/tmp/rotation-leaks-report.json
   ```
   - Zero matches for plaintext legacy secrets.
   - Zero matches for legacy secret values in git history.

4. **Functional smoke test**
   - Execute the E2E smoke test suite and confirm all surfaces pass.
   - Confirm monitoring dashboards show no error spikes.

---

## Sign-off

| Role | Name | Signature / Identifier | Date | Time (UTC) |
|------|------|------------------------|------|------------|
| Rotation Operator | | | | |
| Security Reviewer | | | | |
| Engineering Lead | | | | |

**Evidence Log Reference:** `<link or path to evidence JSON files for this rotation>`

**Rollback Status:** [ ] No rollback required  [ ] Rollback executed (see rollback section above)

**Notes:**
