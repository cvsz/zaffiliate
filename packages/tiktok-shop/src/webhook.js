import { createHmac, timingSafeEqual } from 'node:crypto';

function requireValue(value, name) {
  const normalized = String(value || '');
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function computeTikTokWebhookSignature({ appKey, appSecret, rawBody }) {
  const key = requireValue(appKey, 'appKey');
  const secret = requireValue(appSecret, 'appSecret');
  const body = String(rawBody ?? '');
  return createHmac('sha256', secret).update(`${key}${body}`).digest('hex');
}

export function verifyTikTokWebhook({ appKey, appSecret, rawBody, signature, timestamp, nowMs = Date.now(), maxSkewMs = 5 * 60 * 1000 }) {
  const expected = computeTikTokWebhookSignature({ appKey, appSecret, rawBody });
  const provided = requireValue(signature, 'signature');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  const signatureValid = a.length === b.length && timingSafeEqual(a, b);

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new Error('timestamp is required');
  const timestampMs = ts < 10_000_000_000 ? ts * 1000 : ts;
  const skewMs = Math.abs(nowMs - timestampMs);
  const fresh = skewMs <= maxSkewMs;

  return Object.freeze({
    valid: signatureValid && fresh,
    signatureValid,
    fresh,
    skewMs,
    reason: !signatureValid ? 'signature_mismatch' : !fresh ? 'replay_window_exceeded' : 'verified'
  });
}

export function requireVerifiedTikTokWebhook(input) {
  const result = verifyTikTokWebhook(input);
  if (!result.valid) {
    const error = new Error(`TikTok webhook rejected: ${result.reason}`);
    error.code = result.reason === 'replay_window_exceeded' ? 'TIKTOK_WEBHOOK_REPLAY' : 'TIKTOK_WEBHOOK_SIGNATURE';
    error.verification = result;
    throw error;
  }
  return result;
}
