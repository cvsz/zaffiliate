import { createHmac, timingSafeEqual } from 'node:crypto';
import { AdapterPlatforms, CanonicalAdapterManifests } from '../../../packages/adapters/src/capabilities.js';
import { verifyTikTokWebhook } from '../../../packages/tiktok-shop/src/webhook.js';
import { resolveSecret } from '../../../packages/security/src/secrets.js';

const HTTPS = 'https:';

const ERROR_CODES = Object.freeze({
  unknown_platform: 'UNKNOWN_PLATFORM',
  missing_webhook_parameters: 'MISSING_WEBHOOK_PARAMETERS',
  invalid_signature: 'INVALID_SIGNATURE',
  malformed_payload: 'MALFORMED_PAYLOAD',
  unresolvable_link: 'UNRESOLVABLE_LINK'
});

function fail(status, code, message, extra = {}) {
  return { status, error: { code: String(code || message).toUpperCase(), message, ...extra } };
}

function safeUrl(value) {
  try {
    return new URL(String(value));
  } catch {
    return null;
  }
}

function redirectable(link) {
  const target = link.deepLinkUrl || link.destinationUrl;
  const parsed = safeUrl(target);
  return parsed && parsed.protocol === HTTPS && parsed.hostname ? target : null;
}

export function resolveRedirect({ runtime, tenantId, slug, now = Date.now(), visitorHash = null }) {
  if (!runtime || typeof runtime.resolveLinkBySlug !== 'function') throw new TypeError('runtime with resolveLinkBySlug is required');
  const normalizedSlug = String(slug ?? '').trim().toLowerCase();
  if (!normalizedSlug) return fail(404, 'not_found', 'not_found'.replaceAll('_', ' ').toLowerCase());
  let link;
  try {
    link = runtime.resolveLinkBySlug(tenantId, normalizedSlug);
  } catch {
    return fail(404, 'not_found', 'not_found'.replaceAll('_', ' ').toLowerCase());
  }
  if (!link) return fail(404, 'not_found', 'not_found'.replaceAll('_', ' ').toLowerCase());
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now) return fail(410, 'link_expired', 'link_expired'.replaceAll('_', ' ').toLowerCase());
  const location = redirectable(link);
  if (!location) return fail(404, 'not_found', 'not_found'.replaceAll('_', ' ').toLowerCase());
  const click = runtime.recordClick(tenantId, {
    linkId: link.linkId,
    touchpoint: {
      source: 'go',
      medium: 'redirect',
      occurredAt: new Date(now).toISOString(),
      ...(visitorHash ? { visitorHash } : {})
    }
  });
  return { status: 302, location, clickId: click.clickId };
}

function timingSafeHexEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifyGenericSignature({ secretValue, rawBody, signature, timestamp }) {
  const expected = createHmac('sha256', secretValue).update(`${timestamp}.${String(rawBody ?? '')}`).digest('hex');
  const provided = String(signature ?? '').replace(/^sha256=/, '');
  return provided.length > 0 && timingSafeHexEqual(expected, provided);
}

export function platformAcceptsWebhooks(platform) {
  const normalized = String(platform ?? '').trim().toLowerCase();
  return AdapterPlatforms.includes(normalized) && (CanonicalAdapterManifests[normalized]?.capabilities ?? []).includes('webhooks.receive');
}

function parsePayload(rawBody) {
  try {
    const payload = JSON.parse(String(rawBody));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function ingestWebhook({ runtime, guard, secrets, platform, tenantId, rawBody, signature, timestamp, eventId, now = Date.now() }) {
  if (!platformAcceptsWebhooks(platform)) {
    return fail(404, 'unknown_platform', 'unknown_platform'.replaceAll('_', ' ').toLowerCase());
  }
  if (!rawBody || !signature || !timestamp || !eventId) {
    return fail(400, 'missing_webhook_parameters', 'missing_webhook_parameters'.replaceAll('_', ' ').toLowerCase());
  }

  const normalizedPlatform = String(platform).trim().toLowerCase();
  if (normalizedPlatform === 'tiktok') {
    let appKey;
    let appSecret;
    try {
      appKey = resolveSecret(secrets, 'ref:webhooks/tiktok/appKey').value;
      appSecret = resolveSecret(secrets, 'ref:webhooks/tiktok/appSecret').value;
    } catch {
      return fail(404, 'unknown_platform', 'unknown_platform'.replaceAll('_', ' ').toLowerCase());
    }
    let verdict;
    try {
      verdict = verifyTikTokWebhook({ appKey, appSecret, rawBody, signature, timestamp, nowMs: now });
    } catch {
      return fail(401, 'invalid_signature', 'invalid_signature'.replaceAll('_', ' ').toLowerCase());
    }
    if (!verdict.valid) return fail(401, 'invalid_signature', `webhook signature verification failed (${verdict.reason})`, { reason: verdict.reason });
  } else {
    let secretValue;
    try {
      secretValue = resolveSecret(secrets, `ref:webhooks/${normalizedPlatform}`).value;
    } catch {
      return fail(404, 'unknown_platform', 'unknown_platform'.replaceAll('_', ' ').toLowerCase());
    }
    if (!verifyGenericSignature({ secretValue, rawBody, signature, timestamp })) {
      return fail(401, 'invalid_signature', 'invalid_signature'.replaceAll('_', ' ').toLowerCase());
    }
  }

  let replay;
  try {
    replay = guard.decide({ eventId, timestamp, nowMs: now, tenantId });
  } catch {
    return fail(400, 'missing_webhook_parameters', 'missing_webhook_parameters'.replaceAll('_', ' ').toLowerCase());
  }
  if (!replay.accepted) {
    if (replay.reason === 'duplicate_event') return { status: 200, body: { accepted: false, duplicate: true, reason: replay.reason } };
    return fail(400, replay.reason.replace(/_/g, ' ').toLowerCase(), replay.reason.replaceAll('_', ' ').toLowerCase(), { reason: replay.reason });
  }

  const payload = parsePayload(rawBody);
  if (!payload) return fail(400, 'malformed_payload', 'malformed_payload'.replaceAll('_', ' ').toLowerCase());

  const orderRef = String(payload.orderRef ?? payload.order_id ?? '').trim();
  const revenueMinorUnits = Number(payload.revenueMinorUnits ?? payload.revenue);
  const currency = String(payload.currency ?? '').trim().toUpperCase();
  if (!orderRef || !Number.isSafeInteger(revenueMinorUnits) || revenueMinorUnits < 0 || !/^[A-Z]{3}$/.test(currency)) {
    return fail(400, 'malformed_payload', 'malformed_payload'.replaceAll('_', ' ').toLowerCase());
  }

  let link = null;
  const subId = String(payload.subId ?? '').trim();
  const linkId = String(payload.linkId ?? '').trim();
  try {
    if (subId) link = runtime.findLinkBySubId(tenantId, subId);
    else if (linkId) link = runtime.resolveLinkById(tenantId, linkId);
  } catch {
    link = null;
  }
  if (!link) return fail(422, 'unresolvable_link', 'unresolvable_link'.replaceAll('_', ' ').toLowerCase());

  const conversion = runtime.recordConversion(tenantId, {
    linkId: link.linkId,
    orderRef,
    revenueMinorUnits,
    currency
  });
  return {
    status: 202,
    body: { accepted: true, conversionId: conversion.conversionId, duplicateConversion: false }
  };
}
