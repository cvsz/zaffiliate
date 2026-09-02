const META_BASE_URL = 'https://graph.facebook.com/v21.0';
const YOUTUBE_BASE_URL = 'https://www.googleapis.com';

const YouTubeQuotaCosts = Object.freeze({ 'videos.insert': 1600, 'channels.list': 1 });

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function normalizeBaseUrl(value, name) {
  const parsed = new URL(required(value, name));
  if (parsed.protocol !== 'https:') throw new TypeError(`${name} must use https`);
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function assertCredentialRef(value) {
  const ref = required(value, 'credentialsRef');
  if (!ref.startsWith('ref:')) throw new TypeError('credentialsRef must use a ref: credential reference');
  return ref;
}

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} function is required`);
  return value;
}

async function providerRequest({ transport, url, init, provider }) {
  const response = await transport(url, init);
  const status = Number(response?.status ?? 0);
  const ok = typeof response?.ok === 'boolean' ? response.ok : status >= 200 && status < 300;
  const payload = response && typeof response.json === 'function' ? await response.json() : response?.payload ?? null;
  if (!ok) {
    const error = new Error(`${provider} request failed (${status})`);
    error.name = `${provider}ProviderError`;
    error.httpStatus = status;
    error.retryable = status === 429 || status >= 500;
    throw error;
  }
  return { response, payload };
}

async function bearer(resolveCredential, credentialsRef) {
  return `Bearer ${required(await resolveCredential(credentialsRef), 'resolved credential')}`;
}

export function createMetaAdapter({ credentialsRef, resolveCredential, transport = fetch, baseUrl = META_BASE_URL } = {}) {
  const ref = assertCredentialRef(credentialsRef);
  const resolve = requireFunction(resolveCredential, 'resolveCredential');
  const send = requireFunction(transport, 'transport');
  const endpoint = normalizeBaseUrl(baseUrl, 'baseUrl');

  async function graph(path, { method = 'GET', body, query } = {}) {
    const url = new URL(`${endpoint}/${required(path, 'path').replace(/^\/+/, '')}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
    return providerRequest({
      provider: 'Meta', transport: send, url: url.toString(),
      init: {
        method,
        headers: { authorization: await bearer(resolve, ref), ...(body == null ? {} : { 'content-type': 'application/json' }) },
        body: body == null ? undefined : JSON.stringify(body)
      }
    });
  }

  return Object.freeze({
    provider: 'meta', credentialsRef: ref,
    async publishPost({ pageId, message, approvalRef, idempotencyKey }) {
      required(approvalRef, 'approvalRef'); required(idempotencyKey, 'idempotencyKey');
      const { payload } = await graph(`${required(pageId, 'pageId')}/feed`, { method: 'POST', body: { message: required(message, 'message') } });
      return Object.freeze({ externalId: required(payload?.id, 'Meta response id') });
    },
    async publishPhoto({ pageId, photoUrl, caption = '', approvalRef, idempotencyKey }) {
      required(approvalRef, 'approvalRef'); required(idempotencyKey, 'idempotencyKey');
      const mediaUrl = new URL(required(photoUrl, 'photoUrl'));
      if (mediaUrl.protocol !== 'https:') throw new TypeError('photoUrl must use https');
      const { payload } = await graph(`${required(pageId, 'pageId')}/photos`, { method: 'POST', body: { url: mediaUrl.toString(), caption: String(caption) } });
      return Object.freeze({ externalId: required(payload?.post_id ?? payload?.id, 'Meta response id') });
    },
    async getInsights({ objectId, metric }) {
      const { payload } = await graph(`${required(objectId, 'objectId')}/insights`, { query: { metric: required(metric, 'metric') } });
      const metrics = {};
      for (const row of payload?.data ?? []) if (typeof row?.name === 'string') metrics[row.name] = Number(row.values?.[0]?.value ?? 0);
      return Object.freeze({ metrics: Object.freeze(metrics) });
    }
  });
}

export function createYouTubeAdapter({ credentialsRef, resolveCredential, transport = fetch, baseUrl = YOUTUBE_BASE_URL, quotaLimit = 10_000 } = {}) {
  const ref = assertCredentialRef(credentialsRef);
  const resolve = requireFunction(resolveCredential, 'resolveCredential');
  const send = requireFunction(transport, 'transport');
  const endpoint = normalizeBaseUrl(baseUrl, 'baseUrl');
  if (!Number.isInteger(quotaLimit) || quotaLimit < 1) throw new TypeError('quotaLimit must be a positive integer');
  let quotaPeriod = null;
  let quotaUsed = 0;

  function consume(operation, periodKey) {
    const period = required(periodKey, 'quotaPeriodKey');
    if (period !== quotaPeriod) { quotaPeriod = period; quotaUsed = 0; }
    const cost = YouTubeQuotaCosts[operation] ?? 1;
    if (quotaUsed + cost > quotaLimit) {
      const error = new Error(`YouTube quota exceeded: ${quotaUsed + cost}/${quotaLimit}`);
      error.name = 'YouTubeQuotaExceededError'; error.cost = cost; error.used = quotaUsed; error.limit = quotaLimit;
      throw error;
    }
    quotaUsed += cost;
  }

  async function request(url, init) {
    return providerRequest({ provider: 'YouTube', transport: send, url, init: { ...init, headers: { ...init.headers, authorization: await bearer(resolve, ref) } } });
  }

  return Object.freeze({
    provider: 'youtube', credentialsRef: ref, quotaConsumed: () => quotaUsed,
    async initiateVideoUpload({ metadata, byteLength, contentType = 'video/mp4', quotaPeriodKey, approvalRef, idempotencyKey }) {
      required(approvalRef, 'approvalRef'); required(idempotencyKey, 'idempotencyKey');
      if (!Number.isSafeInteger(byteLength) || byteLength < 1) throw new TypeError('byteLength must be a positive integer');
      const title = required(metadata?.title, 'metadata.title');
      consume('videos.insert', quotaPeriodKey);
      const url = new URL(`${endpoint}/upload/youtube/v3/videos`);
      url.searchParams.set('uploadType', 'resumable'); url.searchParams.set('part', 'snippet,status');
      const { response } = await request(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(byteLength), 'x-upload-content-type': required(contentType, 'contentType') },
        body: JSON.stringify({ snippet: { title, description: String(metadata?.description ?? ''), tags: Array.isArray(metadata?.tags) ? metadata.tags.map(String) : [] }, status: { privacyStatus: metadata?.privacyStatus ?? 'private' } })
      });
      const uploadUrl = response.headers?.get?.('location') ?? response.headers?.location;
      if (!uploadUrl) throw new Error('YouTube resumable response is missing Location header');
      const parsed = new URL(uploadUrl);
      if (parsed.protocol !== 'https:') throw new Error('YouTube upload URL must use https');
      return Object.freeze({ uploadUrl: parsed.toString() });
    },
    async uploadBytes({ uploadUrl, bytes, contentType = 'video/mp4' }) {
      const parsed = new URL(required(uploadUrl, 'uploadUrl'));
      if (parsed.protocol !== 'https:') throw new TypeError('uploadUrl must use https');
      if (!(bytes instanceof Uint8Array)) throw new TypeError('bytes must be a Uint8Array');
      const { payload } = await request(parsed.toString(), { method: 'PUT', headers: { 'content-type': required(contentType, 'contentType'), 'content-length': String(bytes.byteLength) }, body: bytes });
      return Object.freeze({ externalId: required(payload?.id, 'YouTube response id') });
    },
    async getChannelStatistics({ quotaPeriodKey }) {
      consume('channels.list', quotaPeriodKey);
      const url = new URL(`${endpoint}/youtube/v3/channels`);
      url.searchParams.set('part', 'statistics'); url.searchParams.set('mine', 'true');
      const { payload } = await request(url.toString(), { method: 'GET', headers: {} });
      const item = payload?.items?.[0];
      return Object.freeze({ channelId: String(item?.id ?? ''), subscriberCount: Number(item?.statistics?.subscriberCount ?? 0), viewCount: Number(item?.statistics?.viewCount ?? 0), videoCount: Number(item?.statistics?.videoCount ?? 0) });
    }
  });
}

export { YouTubeQuotaCosts };
