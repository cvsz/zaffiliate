import { AdapterPlatforms, CanonicalAdapterManifests } from './capabilities.js';

const PublishingPlatforms = Object.freeze(['facebook', 'instagram', 'youtube']);
const PublishingCapabilities = Object.freeze(['analytics.read', 'content.publish', 'webhooks.receive']);

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

function validateContent(content) {
  if (content == null || typeof content !== 'object' || Array.isArray(content)) throw new Error('content must be an object');
  if (typeof content.text !== 'string') throw new Error('content.text must be a string');
  if (!Array.isArray(content.mediaUrls)) throw new Error('content.mediaUrls must be an array of https URLs');
  const mediaUrls = Object.freeze(
    content.mediaUrls.map((url) => {
      if (typeof url !== 'string' || !/^https:\/\/\S+/i.test(url)) throw new Error('content.mediaUrls entries must be https URLs');
      return url;
    })
  );
  if (!content.text.trim() && mediaUrls.length === 0) throw new Error('content requires non-empty text or at least one media URL');
  let scheduledAt = null;
  if (content.scheduledAt != null) {
    const parsed = Date.parse(String(content.scheduledAt));
    if (Number.isNaN(parsed)) throw new Error('content.scheduledAt must be an ISO-8601 timestamp');
    scheduledAt = new Date(parsed).toISOString();
  }
  return Object.freeze({ text: content.text, mediaUrls, scheduledAt });
}

export function createPublishingAdapter({ platform, credentialsRef, transport } = {}) {
  const normalizedPlatform = requiredString(platform, 'platform').toLowerCase();
  if (!AdapterPlatforms.includes(normalizedPlatform) || !PublishingPlatforms.includes(normalizedPlatform)) {
    throw new Error(`unsupported publishing platform: ${normalizedPlatform}`);
  }
  const ref = assertCredentialReference(credentialsRef, 'credentialsRef');
  if (typeof transport !== 'function') throw new Error('transport function is required');
  const manifest = CanonicalAdapterManifests[normalizedPlatform];
  for (const capability of manifest.capabilities) {
    if (!PublishingCapabilities.includes(capability)) throw new Error(`capability ${capability} is outside the publishing boundary`);
  }

  async function publish(content, { approvalRef, idempotencyKey } = {}) {
    const approval = requiredString(approvalRef, 'approvalRef');
    const idempotency = requiredString(idempotencyKey, 'idempotencyKey');
    const prepared = validateContent(content);
    const request = Object.freeze({
      platform: normalizedPlatform,
      capability: 'content.publish',
      credentialsRef: ref,
      content: prepared,
      approvalRef: approval,
      idempotencyKey: idempotency
    });
    const response = await transport(request);
    const status = Number(response?.status ?? 0);
    if (status < 200 || status >= 300) {
      const error = new Error(`publishing request failed (${status})`);
      error.name = 'PublishingProviderError';
      error.platform = normalizedPlatform;
      error.httpStatus = status;
      throw error;
    }
    const payload = response?.payload ?? {};
    const externalId = payload.externalId ?? payload.external_id ?? payload.id ?? null;
    if (externalId == null || String(externalId).trim() === '') throw new Error('provider response is missing externalId');
    return Object.freeze({
      platform: normalizedPlatform,
      externalId: String(externalId),
      status: 'queued',
      provenance: Object.freeze({ credentialsRef: ref, idempotencyKey: idempotency })
    });
  }

  return Object.freeze({
    platform: normalizedPlatform,
    credentialsRef: ref,
    capabilities: manifest.capabilities,
    publish
  });
}
