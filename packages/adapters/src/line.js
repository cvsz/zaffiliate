import { createHmac, timingSafeEqual } from 'node:crypto';

function requiredString(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function isInlineSecretCandidate(value) {
  const candidate = String(value ?? '');
  return candidate.length > 20 && !candidate.startsWith('ref:');
}

function assertCredentialReference(value, name) {
  const normalized = requiredString(value, name);
  if (isInlineSecretCandidate(normalized)) throw new Error(`${name} must be a credential reference (ref:) rather than an inline secret`);
  return normalized;
}

function requireHttpsUrl(value, name) {
  const url = requiredString(value, name);
  if (!/^https:\/\/\S+/i.test(url)) throw new Error(`${name} must be an https URL`);
  return url;
}

export const LineMessageTypes = Object.freeze(['text', 'image', 'sticker', 'flex']);

function validateMessage(message) {
  if (message == null || typeof message !== 'object' || Array.isArray(message)) throw new Error('message must be an object');
  const type = requiredString(message.type, 'message.type');
  if (!LineMessageTypes.includes(type)) throw new Error(`unsupported message type: ${type}`);
  if (type === 'text') {
    const text = typeof message.text === 'string' ? message.text : '';
    if (!text.trim()) throw new Error('message.text is required for text messages');
    if (text.length > 5000) throw new Error('message.text exceeds 5000 characters');
    return Object.freeze({ type, text });
  }
  if (type === 'sticker') {
    return Object.freeze({
      type,
      packageId: requiredString(message.packageId, 'message.packageId'),
      stickerId: requiredString(message.stickerId, 'message.stickerId')
    });
  }
  if (type === 'image') {
    return Object.freeze({
      type,
      originalContentUrl: requireHttpsUrl(message.originalContentUrl, 'message.originalContentUrl'),
      previewImageUrl: requireHttpsUrl(message.previewImageUrl, 'message.previewImageUrl')
    });
  }
  if (message.contents == null || typeof message.contents !== 'object' || Array.isArray(message.contents)) {
    throw new Error('message.contents object is required for flex messages');
  }
  return Object.freeze({ type, contents: Object.freeze({ ...message.contents }) });
}

export function verifyLineWebhookSignature({ channelSecret, rawBody, signature } = {}) {
  const secret = requiredString(channelSecret, 'channelSecret');
  if (typeof rawBody !== 'string') throw new Error('rawBody must be a string');
  const provided = requiredString(signature, 'signature');
  const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function consentSuppressionError(consentState) {
  const error = new Error(`line message suppressed: consent state '${consentState}' is not granted`);
  error.name = 'LineConsentSuppressedError';
  error.code = 'CONSENT_SUPPRESSED';
  error.consentState = String(consentState);
  return error;
}

export function createLineAdapter({ channelRef, transport } = {}) {
  const ref = assertCredentialReference(channelRef, 'channelRef');
  if (typeof transport !== 'function') throw new Error('transport function is required');

  async function pushMessage({ consent, message, idempotencyKey } = {}) {
    if (consent == null || typeof consent !== 'object' || Array.isArray(consent)) throw new Error('consent evidence object is required');
    const userId = requiredString(consent.userId, 'consent.userId');
    const consentState = requiredString(consent.consentState, 'consent.consentState');
    if (consentState !== 'granted') throw consentSuppressionError(consentState);
    const idempotency = requiredString(idempotencyKey, 'idempotencyKey');
    const prepared = validateMessage(message);
    const request = Object.freeze({
      platform: 'line',
      capability: 'messages.send',
      channelRef: ref,
      targetUserId: userId,
      consentState,
      message: prepared,
      idempotencyKey: idempotency
    });
    const response = await transport(request);
    const status = Number(response?.status ?? 0);
    if (status < 200 || status >= 300) {
      const error = new Error(`line request failed (${status})`);
      error.name = 'LineProviderError';
      error.httpStatus = status;
      throw error;
    }
    const payload = response?.payload ?? {};
    const externalId = payload.externalId ?? payload.messageId ?? payload.id ?? null;
    if (externalId == null || String(externalId).trim() === '') throw new Error('provider response is missing externalId');
    return Object.freeze({
      platform: 'line',
      externalId: String(externalId),
      status: 'queued',
      provenance: Object.freeze({ channelRef: ref, idempotencyKey: idempotency })
    });
  }

  function verifyWebhookSignature({ channelSecret, rawBody, signature } = {}) {
    return verifyLineWebhookSignature({ channelSecret, rawBody, signature });
  }

  return Object.freeze({
    platform: 'line',
    channelRef: ref,
    messageTypes: LineMessageTypes,
    pushMessage,
    verifyWebhookSignature
  });
}
