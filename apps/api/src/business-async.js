import { createHmac, timingSafeEqual } from 'node:crypto';
import { verifyTikTokWebhook } from '../../../packages/tiktok-shop/src/webhook.js';
import { resolveSecret } from '../../../packages/security/src/secrets.js';
import { platformAcceptsWebhooks } from './business.js';

const HTTPS = 'https:';

function fail(status, code, message, extra = {}) {
  return { status, error: { code: String(code || message).toUpperCase(), message, ...extra } };
}

function safeUrl(value) {
  try { return new URL(String(value)); } catch { return null; }
}

function redirectable(link) {
  const target = link?.deepLinkUrl || link?.destinationUrl;
  const parsed = safeUrl(target);
  return parsed && parsed.protocol === HTTPS && parsed.hostname ? target : null;
}

export async function resolveRedirectAsync({ runtime, tenantId, slug, now = Date.now(), visitorHash = null }) {
  if (!runtime || typeof runtime.resolveLinkBySlug !== 'function' || typeof runtime.recordClick !== 'function') {
    throw new TypeError('runtime with link lookup and click recording is required');
  }
  const normalizedSlug = String(slug ?? '').trim().toLowerCase();
  if (!normalizedSlug) return fail(404, 'not_found', 'not found');
  let link;
  try { link = await runtime.resolveLinkBySlug(tenantId, normalizedSlug); }
  catch { return fail(404, 'not_found', 'not found'); }
  if (!link) return fail(404, 'not_found', 'not found');
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now) return fail(410, 'link_expired', 'link expired');
  const location = redirectable(link);
  if (!location) return fail(404, 'not_found', 'not found');
  const click = await runtime.recordClick(tenantId, {
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

function parsePayload(rawBody) {
  try {
    const payload = JSON.parse(String(rawBody));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch { return null; }
}

export async function ingestWebhookAsync({ runtime, guard, secrets, platform, tenantId, rawBody, signature, timestamp, eventId, now = Date.now() }) {
  if (!runtime || typeof runtime.recordConversion !== 'function') throw new TypeError('affiliate runtime is required');
  if (!platformAcceptsWebhooks(platform)) return fail(404, 'unknown_platform', 'unknown platform');
  if (!rawBody || !signature || !timestamp || !eventId) return fail(400, 'missing_webhook_parameters', 'missing webhook parameters');

  const normalizedPlatform = String(platform).trim().toLowerCase();
  if (normalizedPlatform === 'tiktok') {
    let appKey;
    let appSecret;
    try {
      appKey = resolveSecret(secrets, 'ref:webhooks/tiktok/appKey').value;
      appSecret = resolveSecret(secrets, 'ref:webhooks/tiktok/appSecret').value;
    } catch { return fail(404, 'unknown_platform', 'unknown platform'); }
    let verdict;
    try { verdict = verifyTikTokWebhook({ appKey, appSecret, rawBody, signature, timestamp, nowMs: now }); }
    catch { return fail(401, 'invalid_signature', 'invalid signature'); }
    if (!verdict.valid) return fail(401, 'invalid_signature', `webhook signature verification failed (${verdict.reason})`, { reason: verdict.reason });
  } else {
    let secretValue;
    try { secretValue = resolveSecret(secrets, `ref:webhooks/${normalizedPlatform}`).value; }
    catch { return fail(404, 'unknown_platform', 'unknown platform'); }
    if (!verifyGenericSignature({ secretValue, rawBody, signature, timestamp })) return fail(401, 'invalid_signature', 'invalid signature');
  }

  let replay;
  try { replay = guard.decide({ eventId, timestamp, nowMs: now, tenantId }); }
  catch { return fail(400, 'missing_webhook_parameters', 'missing webhook parameters'); }
  if (!replay.accepted) {
    if (replay.reason === 'duplicate_event') return { status: 200, body: { accepted: false, duplicate: true, reason: replay.reason } };
    return fail(400, replay.reason.replace(/_/g, ' ').toLowerCase(), replay.reason.replaceAll('_', ' ').toLowerCase(), { reason: replay.reason });
  }

  const payload = parsePayload(rawBody);
  if (!payload) return fail(400, 'malformed_payload', 'malformed payload');
  const orderRef = String(payload.orderRef ?? payload.order_id ?? '').trim();
  const revenueMinorUnits = Number(payload.revenueMinorUnits ?? payload.revenue);
  const currency = String(payload.currency ?? '').trim().toUpperCase();
  if (!orderRef || !Number.isSafeInteger(revenueMinorUnits) || revenueMinorUnits < 0 || !/^[A-Z]{3}$/.test(currency)) {
    return fail(400, 'malformed_payload', 'malformed payload');
  }

  let link = null;
  const subId = String(payload.subId ?? '').trim();
  const linkId = String(payload.linkId ?? '').trim();
  try {
    if (subId && typeof runtime.findLinkBySubId === 'function') link = await runtime.findLinkBySubId(tenantId, subId);
    else if (linkId && typeof runtime.resolveLinkById === 'function') link = await runtime.resolveLinkById(tenantId, linkId);
  } catch { link = null; }
  if (!link) return fail(422, 'unresolvable_link', 'unresolvable link');

  const conversion = await runtime.recordConversion(tenantId, { linkId: link.linkId, orderRef, revenueMinorUnits, currency });
  return { status: 202, body: { accepted: true, conversionId: conversion.conversionId, duplicateConversion: false } };
}
