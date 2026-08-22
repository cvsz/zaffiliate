import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function parseCliArgs(args) {
  const parsed = {
    commit: false,
    key: null,
    push: false
  };
  for (const arg of args) {
    if (arg === '--commit') {
      parsed.commit = true;
    } else if (arg.startsWith('--key=')) {
      parsed.key = required(arg.slice(6), '--key');
    } else if (arg === '--push') {
      parsed.push = true;
    }
  }
  return Object.freeze(parsed);
}

function run(args) {
  try {
    return execFileSync(args[0], args.slice(1), { encoding: 'utf8' }).trim();
  } catch (error) {
    const stderr = String(error.stderr || error.message || '').trim();
    if (stderr) throw new Error(stderr);
    throw error;
  }
}

function assertGpgAvailable() {
  run(['gpg', '--version']);
}

function resolveKeyId(args) {
  if (args.key) return args.key;
  try {
    return run(['git', 'config', 'user.signingkey']).trim();
  } catch {
    return null;
  }
}

function readSigningKey(key) {
  const output = run(['git', 'config', 'user.signingkey']);
  if (output) return output.trim();
  if (key) return key;
  return null;
}

function gpgAttest(args) {
  assertGpgAvailable();
  run(['git', 'config', 'commit.gpgsign', 'true']);
  const keyId = resolveKeyId(args);
  if (!keyId) throw new Error('signing key is required');
  const message = 'chore: GPG attest zaffiliate baseline';
  run(['git', 'commit', '--allow-empty', '-S', '-m', message]);
  const logOutput = run(['git', 'log', '-1', '--show-signature']);
  const signatureVerified = /Good signature from/.test(logOutput);
  if (!signatureVerified) {
    console.error('GPG signature verification failed');
    process.exitCode = 2;
    return;
  }
  const commitSha = run(['git', 'rev-parse', 'HEAD']);
  let pushed = false;
  if (args.push) {
    run(['git', 'push', 'origin', 'main']);
    pushed = true;
  }
  const evidence = Object.freeze({
    keyId,
    commitSha,
    verified: signatureVerified,
    pushed
  });
  console.log(JSON.stringify(evidence));
}

const args = parseCliArgs(process.argv.slice(2));
if (!args.commit) {
  console.error('usage: node scripts/gpg-attest.mjs --commit --key=<KEY_ID> [--push]');
  process.exitCode = 1;
} else {
  try {
    gpgAttest(args);
  } catch (error) {
    const message = String(error.message || error);
    if (message.includes('gpg') || message.includes('GnuPG')) {
      console.error('GnuPG not available');
      process.exitCode = 2;
    } else {
      console.error(message);
      process.exitCode = 2;
    }
  }
}

export function buildEvidence({ keyId, commitSha, verified, pushed }) {
  return Object.freeze({ keyId, commitSha, verified, pushed });
}
