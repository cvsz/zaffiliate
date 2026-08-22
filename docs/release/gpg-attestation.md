# GPG Attestation Runbook

## Overview

This runbook documents the process for GPG-signing the zaffiliate baseline and verifying attestation on GitHub.

## Prerequisites

- GnuPG installed and available in PATH
- A GPG key pair generated or imported
- The key ID configured for git signing

## Generate or reload a GPG key

```sh
gpg --full-generate-key
```

Select `ECC and ECC` and `Curve 25519` for modern elliptic-curve keys, or `RSA and RSA` with at least 4096 bits.

After generation, list the key:

```sh
gpg --list-secret-keys --keyid-format long
```

## Configure git signing key

```sh
git config --global user.signingkey <KEY_ID>
git config --global commit.gpgsign true
```

Verify:

```sh
git config user.signingkey
```

## Run attestation

```sh
node scripts/gpg-attest.mjs --commit --key=<KEY_ID>
```

Add `--push` to push the signed commit to origin main:

```sh
node scripts/gpg-attest.mjs --commit --key=<KEY_ID> --push
```

Output evidence JSON:

```json
{
  "keyId": "0xDEADBEEF",
  "commitSha": "abc123...",
  "verified": true,
  "pushed": false
}
```

## Verify on GitHub

1. Navigate to the commit on GitHub.
2. Look for the **Verified** badge next to the commit message.
3. If the badge is absent, ensure the public key is uploaded to your GitHub profile under **Settings > SSH and GPG keys**.

## Signed push certificate notes

When `--push` is used, the workflow pushes the signed commit to origin main. GitHub records the GPG signature in the commit object. For branch protection with signed commits, enable **Require signed commits** in the repository branch protection rules.

## Troubleshooting

- `GnuPG not available`: Install GnuPG or add it to PATH.
- `signing key is required`: Set `--key` or configure `user.signingkey` in git config.
- `GPG signature verification failed`: Check `git log -1 --show-signature` for details. The key may not be trusted or may not match the configured signing key.
