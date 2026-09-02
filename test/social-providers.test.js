import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetaAdapter, createYouTubeAdapter } from '../packages/adapters/src/social-providers.js';

test('Meta resolves server-side credentials and keeps tokens out of URLs and bodies', async () => {
  const seen = [];
  const adapter = createMetaAdapter({
    credentialsRef: 'ref:meta/page-main',
    resolveCredential: async (ref) => { assert.equal(ref, 'ref:meta/page-main'); return 'meta-token-secret'; },
    transport: async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, payload: { id: 'page_1_post_2' } }; }
  });
  assert.deepEqual(await adapter.publishPost({ pageId: 'page_1', message: 'launch', approvalRef: 'apr-1', idempotencyKey: 'idem-1' }), { externalId: 'page_1_post_2' });
  assert.equal(seen[0].url, 'https://graph.facebook.com/v21.0/page_1/feed');
  assert.equal(seen[0].url.includes('meta-token-secret'), false);
  assert.equal(seen[0].init.headers.authorization, 'Bearer meta-token-secret');
  assert.deepEqual(JSON.parse(seen[0].init.body), { message: 'launch' });
  await assert.rejects(() => adapter.publishPost({ pageId: 'p', message: 'm', idempotencyKey: 'i' }), /approvalRef/);
  assert.throws(() => createMetaAdapter({ credentialsRef: 'inline-token', resolveCredential: async () => 'x' }), /ref:/);
});

test('Meta normalizes insights and classifies retryable errors', async () => {
  const adapter = createMetaAdapter({ credentialsRef: 'ref:meta/page', resolveCredential: async () => 'token', transport: async () => ({ status: 200, payload: { data: [{ name: 'impressions', values: [{ value: 42 }] }] } }) });
  assert.deepEqual(await adapter.getInsights({ objectId: 'post_1', metric: 'impressions' }), { metrics: { impressions: 42 } });
  const failing = createMetaAdapter({ credentialsRef: 'ref:meta/page', resolveCredential: async () => 'token', transport: async () => ({ status: 429, payload: { error: 'rate limited' } }) });
  await assert.rejects(() => failing.getInsights({ objectId: 'post_1', metric: 'impressions' }), (error) => error.name === 'MetaProviderError' && error.retryable === true);
});

test('YouTube supports resumable upload and deterministic quota periods', async () => {
  const seen = [];
  const adapter = createYouTubeAdapter({
    credentialsRef: 'ref:youtube/channel-main', quotaLimit: 1601,
    resolveCredential: async () => 'youtube-secret',
    transport: async (url, init) => {
      seen.push({ url, init });
      if (init.method === 'POST') return { ok: true, status: 200, headers: new Headers({ location: 'https://upload.youtube.com/session/abc' }), payload: null };
      if (init.method === 'PUT') return { ok: true, status: 200, payload: { id: 'video_9' } };
      return { ok: true, status: 200, payload: { items: [{ id: 'channel_1', statistics: { subscriberCount: '12', viewCount: '34', videoCount: '5' } }] } };
    }
  });
  const session = await adapter.initiateVideoUpload({ metadata: { title: 'Demo', description: 'Affiliate demo', privacyStatus: 'unlisted' }, byteLength: 3, quotaPeriodKey: '2026-09-02', approvalRef: 'apr-9', idempotencyKey: 'idem-9' });
  assert.equal(session.uploadUrl, 'https://upload.youtube.com/session/abc');
  assert.equal(adapter.quotaConsumed(), 1600);
  assert.deepEqual(await adapter.uploadBytes({ uploadUrl: session.uploadUrl, bytes: new Uint8Array([1, 2, 3]) }), { externalId: 'video_9' });
  assert.equal(seen[0].url.includes('youtube-secret'), false);
  assert.equal(seen[0].init.headers.authorization, 'Bearer youtube-secret');
  assert.deepEqual(await adapter.getChannelStatistics({ quotaPeriodKey: '2026-09-02' }), { channelId: 'channel_1', subscriberCount: 12, viewCount: 34, videoCount: 5 });
  await assert.rejects(() => adapter.getChannelStatistics({ quotaPeriodKey: '2026-09-02' }), (error) => error.name === 'YouTubeQuotaExceededError');
  assert.deepEqual(await adapter.getChannelStatistics({ quotaPeriodKey: '2026-09-03' }), { channelId: 'channel_1', subscriberCount: 12, viewCount: 34, videoCount: 5 });
});

test('YouTube rejects unsafe upload URLs and malformed inputs', async () => {
  const adapter = createYouTubeAdapter({ credentialsRef: 'ref:yt/x', resolveCredential: async () => 'token', transport: async () => ({ status: 200, payload: { id: 'x' } }) });
  await assert.rejects(() => adapter.uploadBytes({ uploadUrl: 'http://upload.example/x', bytes: new Uint8Array() }), /https/);
  await assert.rejects(() => adapter.initiateVideoUpload({ metadata: { title: 'x' }, byteLength: 0, quotaPeriodKey: 'day', approvalRef: 'a', idempotencyKey: 'i' }), /byteLength/);
});
