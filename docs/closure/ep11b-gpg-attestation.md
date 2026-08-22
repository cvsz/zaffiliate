# EP-11B GPG Attestation Runbook

Maintainer-facing step-by-step runbook for GPG attestation of the `zaffiliate` baseline.

## Prerequisites

- GPG 2.x installed (`gpg --version`).
- Existing GPG key pair (or generate a new one with `gpg --full-generate-key`).
- Public key exported to local keyring.
- Git configured with `user.name` and `user.email` matching the key identity.

## Step 1: Verify GPG installation

```bash
gpg --version
gpg --list-keys
```

Confirm GPG 2.x is installed and at least one key is listed.

## Step 2: Configure git signing

```bash
git config commit.gpgsign true
git config user.signingkey <KEY_ID>
```

Replace `<KEY_ID>` with the actual key ID or fingerprint.

## Step 3: Create attestation commit

```bash
git commit --allow-empty -S -m "chore: GPG attest zaffiliate baseline"
```

This creates a signed empty commit to attest the baseline state.

## Step 4: Verify signature locally

```bash
git log -1 --show-signature
```

Expected output contains:

```
Good signature from ...
```

## Step 5: Push signed commit

```bash
git push origin main
```

## Step 6: Verify on GitHub

Navigate to:

- Settings -> Commits -> Verify signature

Confirm the commit is marked as verified.

## Step 7: Create signed tag

```bash
git tag -s v0.1.0 -m "release v0.1.0"
git push origin v0.1.0
```

## Step 8: Verify tag signature

```bash
git tag -v v0.1.0
```

## Evidence Recording

Save the following artifacts:

- `git log --show-signature -1` output
- GitHub verification screenshot
- Tag verification output

## Troubleshooting

### pinentry issues

Ensure `pinentry` or `pinentry-tty` is installed and `GPG_TTY` is set:

```bash
export GPG_TTY=$(tty)
```

### Expired key

Renew the key expiration with:

```bash
gpg --edit-key <KEY_ID>
# Then: expire
```

### Missing subkey

Ensure a subkey capable of signing (`S`) exists under the primary key.

### Passphrase prompts

Use `gpg-agent` caching to reduce prompts. Configure `~/.gnupg/gpg-agent.conf` with a reasonable `default-cache-ttl`.

## Security Notes

- Never export or share the private key.
- Use a hardware token (e.g., YubiKey) if available.
- Revoke the key immediately if compromised.
