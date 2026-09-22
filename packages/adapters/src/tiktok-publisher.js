import { createUrlValidator } from '../../security/src/url-validation.js';
import { generatePublishingIdempotencyKey } from './publishing.js';

export const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';
export const CREATOR_INFO_ENDPOINT = `${TIKTOK_API_BASE}/post/publish/creator_info/query/`;
export const VIDEO_INIT_ENDPOINT = `${TIKTOK_API_BASE}/post/publish/video/init/`;
export const STATUS_FETCH_ENDPOINT = `${TIKTOK_API_BASE}/post/publish/status/fetch/`;

export const PRIVACY_LEVELS = Object.freeze([
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY'
]);

export class TikTokPublishError extends Error {
  constructor(message, {
    code = 'TIKTOK_PUBLISH_FAILED',
    category = 'PERMANENT',
    providerCode = null,
    httpStatus = null,
    retryable = false
  } = {}) {
    super(message);
    this.name = 'TikTokPublishError';
    this.code = code;
    this.category = category; // RETRYABLE | PERMANENT | AUTHENTICATION | AUTHORIZATION | RATE_LIMIT | VALIDATION | PROVIDER_UNAVAILABLE
    this.providerCode = providerCode;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

function requiredString(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

export function classifyTikTokError(status, providerCode, message = '') {
  const s = Number(status || 0);
  const code = String(providerCode || '').toLowerCase();
  const msg = String(message || '').toLowerCase();

  if (s === 429 || code.includes('rate_limit') || msg.includes('rate limit')) {
    return { category: 'RATE_LIMIT', retryable: true, code: 'TIKTOK_RATE_LIMITED' };
  }
  if (s === 401 || code.includes('token_invalid') || code.includes('invalid_token') || msg.includes('unauthorized')) {
    return { category: 'AUTHENTICATION', retryable: false, code: 'TIKTOK_AUTH_INVALID' };
  }
  if (s === 403 || code.includes('scope') || msg.includes('permission')) {
    return { category: 'AUTHORIZATION', retryable: false, code: 'TIKTOK_FORBIDDEN' };
  }
  if (s === 400 || code.includes('invalid_param') || code.includes('format')) {
    return { category: 'VALIDATION', retryable: false, code: 'TIKTOK_VALIDATION_FAILED' };
  }
  if (s >= 500 || s === 408 || code.includes('server_error') || code.includes('timeout')) {
    return { category: 'PROVIDER_UNAVAILABLE', retryable: true, code: 'TIKTOK_UNAVAILABLE' };
  }
  return { category: 'PERMANENT', retryable: false, code: 'TIKTOK_PUBLISH_ERROR' };
}

export function createTikTokPublisher({
  transport = fetch,
  urlValidator = createUrlValidator({ allowedSchemes: ['https'], blockPrivateRanges: true })
} = {}) {
  if (typeof transport !== 'function') throw new TypeError('transport must be a function');

  async function callApi(endpoint, { method = 'POST', accessToken, body = null }) {
    const token = requiredString(accessToken, 'accessToken');
    urlValidator.validate(endpoint, 'endpoint');

    let response;
    try {
      response = await transport(endpoint, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=UTF-8',
          'cache-control': 'no-store'
        },
        body: body == null ? undefined : JSON.stringify(body)
      });
    } catch (err) {
      throw new TikTokPublishError('network transport error', {
        category: 'PROVIDER_UNAVAILABLE',
        retryable: true,
        code: 'TRANSPORT_ERROR'
      });
    }

    const status = Number(response?.status ?? 0);
    let payload = null;
    try {
      payload = typeof response.json === 'function' ? await response.json() : JSON.parse(response.text || '{}');
    } catch {
      payload = null;
    }

    const err = payload?.error;
    const hasError = (err && err.code && err.code !== 'ok' && err.code !== '0') || status < 200 || status >= 300;

    if (hasError) {
      const pCode = err?.code || `HTTP_${status}`;
      const pMsg = err?.message || `HTTP ${status}`;
      const classification = classifyTikTokError(status, pCode, pMsg);
      throw new TikTokPublishError(`TikTok publishing API error: ${pMsg}`, {
        code: classification.code,
        category: classification.category,
        providerCode: pCode,
        httpStatus: status,
        retryable: classification.retryable
      });
    }

    return payload?.data || {};
  }

  async function getCreatorInfo({ accessToken }) {
    const data = await callApi(CREATOR_INFO_ENDPOINT, {
      method: 'POST',
      accessToken,
      body: {}
    });

    return Object.freeze({
      avatarUrl: data.creator_avatar_url ? String(data.creator_avatar_url) : null,
      nickname: data.creator_nickname ? String(data.creator_nickname) : null,
      username: data.creator_username ? String(data.creator_username) : null,
      privacyLevelOptions: Object.freeze(Array.isArray(data.privacy_level_options) ? data.privacy_level_options : []),
      commentDisabled: Boolean(data.comment_disabled),
      duetDisabled: Boolean(data.duet_disabled),
      stitchDisabled: Boolean(data.stitch_disabled),
      maxVideoPostDurationSec: Number(data.max_video_post_duration_sec ?? 600)
    });
  }

  async function directPost({
    accessToken,
    videoUrl,
    title,
    privacyLevel = 'PUBLIC_TO_EVERYONE',
    disableDuet = false,
    disableComment = false,
    disableStitch = false,
    coverTimestampMs = 1000
  }) {
    const vUrl = requiredString(videoUrl, 'videoUrl');
    urlValidator.validate(vUrl, 'videoUrl');

    const caption = String(title ?? '').trim();
    if (!caption) throw new TypeError('title/caption is required');
    if (caption.length > 2200) throw new TypeError('title exceeds maximum 2200 characters');

    if (!PRIVACY_LEVELS.includes(privacyLevel)) {
      throw new TypeError(`privacyLevel must be one of: ${PRIVACY_LEVELS.join(', ')}`);
    }

    const payload = {
      post_info: {
        title: caption,
        privacy_level: privacyLevel,
        disable_duet: Boolean(disableDuet),
        disable_comment: Boolean(disableComment),
        disable_stitch: Boolean(disableStitch),
        video_cover_timestamp_ms: Math.max(0, Number(coverTimestampMs) || 1000)
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: vUrl
      }
    };

    const data = await callApi(VIDEO_INIT_ENDPOINT, {
      method: 'POST',
      accessToken,
      body: payload
    });

    const publishId = requiredString(data.publish_id, 'publish_id');
    return Object.freeze({
      publishId,
      status: 'PROCESSING_DOWNLOAD'
    });
  }

  async function initializeFileUpload({
    accessToken,
    videoSize,
    chunkSize = null,
    totalChunkCount = 1,
    title,
    privacyLevel = 'PUBLIC_TO_EVERYONE',
    disableDuet = false,
    disableComment = false,
    disableStitch = false
  }) {
    const size = Number(videoSize);
    if (!Number.isSafeInteger(size) || size <= 0) throw new TypeError('videoSize must be a positive integer');

    const caption = String(title ?? '').trim();
    if (!caption) throw new TypeError('title/caption is required');
    if (!PRIVACY_LEVELS.includes(privacyLevel)) {
      throw new TypeError(`privacyLevel must be one of: ${PRIVACY_LEVELS.join(', ')}`);
    }

    const chunks = Number(totalChunkCount) || 1;
    const chunk = Number(chunkSize) || size;

    const payload = {
      post_info: {
        title: caption,
        privacy_level: privacyLevel,
        disable_duet: Boolean(disableDuet),
        disable_comment: Boolean(disableComment),
        disable_stitch: Boolean(disableStitch)
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: chunk,
        total_chunk_count: chunks
      }
    };

    const data = await callApi(VIDEO_INIT_ENDPOINT, {
      method: 'POST',
      accessToken,
      body: payload
    });

    const publishId = requiredString(data.publish_id, 'publish_id');
    const uploadUrl = requiredString(data.upload_url, 'upload_url');
    urlValidator.validate(uploadUrl, 'upload_url');

    return Object.freeze({
      publishId,
      uploadUrl,
      status: 'PROCESSING_UPLOAD'
    });
  }

  async function uploadChunkBytes({
    uploadUrl,
    chunkBytes,
    startByte = 0,
    endByte = null,
    totalBytes = null,
    contentType = 'video/mp4'
  }) {
    const uUrl = requiredString(uploadUrl, 'uploadUrl');
    urlValidator.validate(uUrl, 'uploadUrl');

    if (!Buffer.isBuffer(chunkBytes) && !(chunkBytes instanceof Uint8Array)) {
      throw new TypeError('chunkBytes must be a Buffer or Uint8Array');
    }

    const chunkLen = chunkBytes.length;
    const start = Number(startByte) || 0;
    const end = endByte == null ? start + chunkLen - 1 : Number(endByte);
    const total = totalBytes == null ? chunkLen : Number(totalBytes);

    let res;
    try {
      res = await transport(uUrl, {
        method: 'PUT',
        headers: {
          'content-type': String(contentType),
          'content-range': `bytes ${start}-${end}/${total}`,
          'content-length': String(chunkLen)
        },
        body: chunkBytes
      });
    } catch {
      throw new TikTokPublishError('network error uploading video chunk', {
        category: 'PROVIDER_UNAVAILABLE',
        retryable: true,
        code: 'CHUNK_UPLOAD_TRANSPORT_ERROR'
      });
    }

    const status = Number(res?.status ?? 0);
    if (status < 200 || status >= 300) {
      throw new TikTokPublishError(`chunk upload failed with status ${status}`, {
        category: 'PROVIDER_UNAVAILABLE',
        retryable: true,
        httpStatus: status
      });
    }

    return Object.freeze({ uploaded: true, bytesSent: chunkLen });
  }

  async function fetchPublishStatus({ accessToken, publishId }) {
    const pubId = requiredString(publishId, 'publishId');
    const data = await callApi(STATUS_FETCH_ENDPOINT, {
      method: 'POST',
      accessToken,
      body: { publish_id: pubId }
    });

    const status = String(data.status || 'UNKNOWN').toUpperCase();
    return Object.freeze({
      publishId: pubId,
      status, // SUCCESS | PROCESSING_DOWNLOAD | PROCESSING_UPLOAD | FAILED
      failReason: data.fail_reason ? String(data.fail_reason) : null,
      isCompleted: status === 'SUCCESS',
      isFailed: status === 'FAILED',
      isProcessing: status === 'PROCESSING_DOWNLOAD' || status === 'PROCESSING_UPLOAD'
    });
  }

  return Object.freeze({
    getCreatorInfo,
    directPost,
    initializeFileUpload,
    uploadChunkBytes,
    fetchPublishStatus
  });
}

export { generatePublishingIdempotencyKey };
