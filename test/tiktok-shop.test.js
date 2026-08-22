import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTikTokSigningPayload, signTikTokRequest } from '../packages/tiktok-shop/src/signing.js';
import { buildTikTokAuthorizationUrl, buildAuthorizationCodeExchange, buildRefreshTokenRequest, normalizeTokenResponse } from '../packages/tiktok-shop/src/auth.js';
import { computeTikTokWebhookSignature, verifyTikTokWebhook, requireVerifiedTikTokWebhook } from '../packages/tiktok-shop/src/webhook.js';

test('signing payload is deterministic and excludes signature/access token fields', () => {
  const input = {
    path: '/product/202309/products/search',
    query: { timestamp: 1700000000, app_key: 'app', sign: 'old', 'x-tts-access-token': 'secret', z: 'last', a: 'first' },
    method: 'POST',
    contentType: 'application/json',
    body: '{"page_size":20}',
    appSecret: 'topsecret'
  };
  const payload = buildTikTokSigningPayload(input);
  assert.equal(payload, 'topsecret/product/202309/products/searchafirstapp_keyapptimestamp1700000000zlast{"page_size":20}topsecret');
  assert.match(signTikTokRequest(input), /^[a-f0-9]{64}$/);
});

test('authorization URL requires caller-provided CSRF state', () => {
  const url = new URL(buildTikTokAuthorizationUrl({ appKey: 'app', state: 'csrf-123' }));
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('app_key'), 'app');
  assert.equal(url.searchParams.get('state'), 'csrf-123');
  assert.throws(() => buildTikTokAuthorizationUrl({ appKey: 'app', state: '' }), /state is required/);
});

test('token exchange and refresh requests normalize required parameters', () => {
  const exchange = new URL(buildAuthorizationCodeExchange({ appKey: 'a', appSecret: 's', authCode: 'c' }).url);
  assert.equal(exchange.pathname, '/api/v2/token/get');
  assert.equal(exchange.searchParams.get('grant_type'), 'authorized_code');
  const refresh = new URL(buildRefreshTokenRequest({ appKey: 'a', appSecret: 's', refreshToken: 'r' }).url);
  assert.equal(refresh.pathname, '/api/v2/token/refresh');
  assert.equal(refresh.searchParams.get('grant_type'), 'refresh_token');
});

test('token responses fail closed on provider error', () => {
  assert.throws(() => normalizeTokenResponse({ code: 1001, message: 'bad token' }), (error) => error.code === 'TIKTOK_AUTH_ERROR');
  const token = normalizeTokenResponse({ code: 0, data: { access_token: 'a', refresh_token: 'r', access_token_expire_in: 100 } });
  assert.equal(token.accessToken, 'a');
  assert.equal(token.refreshToken, 'r');
});

test('webhook verification accepts valid fresh signatures', () => {
  const rawBody = '{"type":1,"timestamp":1700000000}';
  const signature = computeTikTokWebhookSignature({ appKey: 'app', appSecret: 'secret', rawBody });
  const result = verifyTikTokWebhook({ appKey: 'app', appSecret: 'secret', rawBody, signature, timestamp: 1700000000, nowMs: 1700000000 * 1000 });
  assert.equal(result.valid, true);
  assert.equal(result.reason, 'verified');
});

test('webhook verification rejects stale replay even with a valid signature', () => {
  const rawBody = '{"type":1,"timestamp":1700000000}';
  const signature = computeTikTokWebhookSignature({ appKey: 'app', appSecret: 'secret', rawBody });
  const result = verifyTikTokWebhook({ appKey: 'app', appSecret: 'secret', rawBody, signature, timestamp: 1700000000, nowMs: (1700000000 + 3600) * 1000 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'replay_window_exceeded');
  assert.throws(() => requireVerifiedTikTokWebhook({ appKey: 'app', appSecret: 'secret', rawBody, signature, timestamp: 1700000000, nowMs: (1700000000 + 3600) * 1000 }), (error) => error.code === 'TIKTOK_WEBHOOK_REPLAY');
});
