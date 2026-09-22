import { TikTokPublishError } from '../../adapters/src/tiktok-publisher.js';

function computeBackoff(attempt, baseDelayMs, maxDelayMs) {
  const exp = Math.min(6, Math.max(0, attempt));
  const raw = baseDelayMs * (2 ** exp);
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(maxDelayMs, raw + jitter);
}

export function createTikTokPublishWorker({
  publicationJobsRepo,
  tiktokAccountsRepo,
  tokenService,
  publisher,
  clock = Date.now,
  logger = null,
  baseRetryDelayMs = 1000,
  maxRetryDelayMs = 60_000
} = {}) {
  if (!publicationJobsRepo || typeof publicationJobsRepo.transition !== 'function') {
    throw new TypeError('publicationJobsRepo is required');
  }
  if (!tiktokAccountsRepo || typeof tiktokAccountsRepo.listAccounts !== 'function') {
    throw new TypeError('tiktokAccountsRepo is required');
  }
  if (!tokenService || typeof tokenService.getValidAccessToken !== 'function') {
    throw new TypeError('tokenService is required');
  }
  if (!publisher || typeof publisher.directPost !== 'function') {
    throw new TypeError('publisher is required');
  }

  function log(level, event, data) {
    if (logger && typeof logger[level] === 'function') {
      logger[level](event, data);
    }
  }

  async function processSingleJob(tenantId, job) {
    if (job.platform !== 'tiktok') {
      return { skipped: true, reason: 'not_tiktok' };
    }

    const now = clock();
    const jobId = job.jobId || job.id;

    // 1. Resolve connected TikTok account for tenant
    const accounts = await tiktokAccountsRepo.listAccounts(tenantId, { status: 'connected', limit: 1 });
    const account = accounts[0];
    if (!account) {
      const failReason = 'No connected TikTok account available for publishing';
      await publicationJobsRepo.transition(tenantId, jobId, 'failed', {
        failureCode: 'NO_CONNECTED_ACCOUNT',
        failureReason: failReason,
        nextRetryAt: null // permanent fail until account connected
      });
      log('warn', 'tiktok_publish_no_account', { tenantId, jobId });
      return { success: false, reason: 'NO_CONNECTED_ACCOUNT' };
    }

    // 2. Retrieve valid, unexpired access token with race condition protection
    let tokenResult;
    try {
      tokenResult = await tokenService.getValidAccessToken({
        tenantId,
        accountId: account.id
      });
    } catch (err) {
      const isReauth = err?.code === 'REAUTH_REQUIRED' || err?.code?.includes('REAUTH');
      const failCode = isReauth ? 'TIKTOK_REAUTH_REQUIRED' : 'TIKTOK_AUTH_ERROR';
      await publicationJobsRepo.transition(tenantId, jobId, 'failed', {
        failureCode: failCode,
        failureReason: String(err?.message ?? 'Failed to obtain TikTok access token'),
        nextRetryAt: null
      });
      log('error', 'tiktok_publish_auth_failed', { tenantId, jobId, code: failCode });
      return { success: false, reason: failCode };
    }

    const { accessToken } = tokenResult;

    // 3. Query creator info to validate permissions and options
    let creatorInfo;
    try {
      creatorInfo = await publisher.getCreatorInfo({ accessToken });
    } catch (err) {
      const isRetryable = err?.retryable ?? false;
      const attempt = job.attempt || 1;
      const maxAttempts = job.maxAttempts || 3;
      const delay = isRetryable && attempt < maxAttempts ? computeBackoff(attempt, baseRetryDelayMs, maxRetryDelayMs) : null;
      const nextRetry = delay ? new Date(now + delay).toISOString() : null;

      await publicationJobsRepo.transition(tenantId, jobId, 'failed', {
        failureCode: err?.code || 'CREATOR_INFO_FAILED',
        failureReason: String(err?.message ?? 'Failed to retrieve TikTok creator info'),
        nextRetryAt: nextRetry
      });
      return { success: false, reason: 'CREATOR_INFO_FAILED' };
    }

    // 4. Validate content metadata
    const providerResp = job.providerResponse || {};
    const content = providerResp.content || {};
    const videoUrl = content.videoUrl || providerResp.videoUrl || null;
    const caption = content.title || content.caption || providerResp.title || 'TikTok Affiliate Video';
    const requestedPrivacy = content.privacyLevel || 'PUBLIC_TO_EVERYONE';

    if (creatorInfo.privacyLevelOptions.length > 0 && !creatorInfo.privacyLevelOptions.includes(requestedPrivacy)) {
      const failReason = `Requested privacy ${requestedPrivacy} not supported by creator (allowed: ${creatorInfo.privacyLevelOptions.join(',')})`;
      await publicationJobsRepo.transition(tenantId, jobId, 'failed', {
        failureCode: 'PRIVACY_NOT_ALLOWED',
        failureReason: failReason,
        nextRetryAt: null
      });
      return { success: false, reason: 'PRIVACY_NOT_ALLOWED' };
    }

    if (!videoUrl) {
      await publicationJobsRepo.transition(tenantId, jobId, 'failed', {
        failureCode: 'MISSING_VIDEO_URL',
        failureReason: 'Publication job lacks videoUrl in payload',
        nextRetryAt: null
      });
      return { success: false, reason: 'MISSING_VIDEO_URL' };
    }

    // 5. Post video to TikTok
    try {
      const postResult = await publisher.directPost({
        accessToken,
        videoUrl,
        title: caption,
        privacyLevel: requestedPrivacy,
        disableComment: Boolean(content.disableComment || creatorInfo.commentDisabled),
        disableDuet: Boolean(content.disableDuet || creatorInfo.duetDisabled),
        disableStitch: Boolean(content.disableStitch || creatorInfo.stitchDisabled)
      });

      // 6. Transition job to published on success
      await publicationJobsRepo.transition(tenantId, jobId, 'published', {
        externalContentId: postResult.publishId,
        providerResponse: {
          ...providerResp,
          publishId: postResult.publishId,
          publishedAt: new Date(now).toISOString(),
          status: postResult.status,
          creator: {
            username: creatorInfo.username,
            nickname: creatorInfo.nickname
          }
        }
      });

      log('info', 'tiktok_publish_succeeded', { tenantId, jobId, publishId: postResult.publishId });
      return { success: true, publishId: postResult.publishId };
    } catch (err) {
      const isRetryable = err?.retryable ?? false;
      const attempt = (job.attempt ?? 0) + 1;
      const maxAttempts = job.maxAttempts || 3;
      const hasRetriesLeft = attempt < maxAttempts;
      const delay = isRetryable && hasRetriesLeft ? computeBackoff(attempt, baseRetryDelayMs, maxRetryDelayMs) : null;
      const nextRetry = delay ? new Date(now + delay).toISOString() : null;

      await publicationJobsRepo.transition(tenantId, jobId, 'failed', {
        failureCode: err?.code || 'DIRECT_POST_FAILED',
        failureReason: String(err?.message ?? 'Direct post request failed'),
        nextRetryAt: nextRetry
      });

      log('error', 'tiktok_publish_failed', {
        tenantId,
        jobId,
        error: err?.message,
        retryable: isRetryable,
        nextRetry
      });
      return { success: false, retryable: isRetryable, nextRetry };
    }
  }

  async function runTick(tenantId, { limit = 10 } = {}) {
    const nowIso = new Date(clock()).toISOString();
    // Claim scheduled or failed jobs due for retry
    const claimed = await publicationJobsRepo.claimDue(tenantId, nowIso, limit);
    const results = [];
    for (const job of claimed) {
      if (job.platform === 'tiktok') {
        const res = await processSingleJob(tenantId, job);
        results.push({ jobId: job.jobId || job.id, ...res });
      }
    }
    return Object.freeze({
      claimedCount: claimed.length,
      processedCount: results.length,
      results: Object.freeze(results)
    });
  }

  return Object.freeze({
    processSingleJob,
    runTick
  });
}
