import test from 'node:test';
import assert from 'node:assert/strict';
import { createTikTokPublishWorker } from '../packages/workflow/src/tiktok-publish-worker.js';
import { TikTokPublishError } from '../packages/adapters/src/tiktok-publisher.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function createMockRepos({
  claimedJobs = [],
  accounts = [{ id: 'acc_1', status: 'connected' }],
  validToken = 'act_mock_valid_123'
} = {}) {
  const transitioned = [];

  const publicationJobsRepo = {
    transitioned,
    async claimDue(tenant, nowIso, limit) {
      return claimedJobs;
    },
    async transition(tenant, jobId, toStatus, patch = {}) {
      transitioned.push({ tenant, jobId, toStatus, patch });
      return { transitioned: true };
    }
  };

  const tiktokAccountsRepo = {
    async listAccounts(tenant, filters = {}) {
      return accounts;
    }
  };

  const tokenService = {
    async getValidAccessToken({ tenantId, accountId }) {
      if (validToken instanceof Error) throw validToken;
      return { accessToken: validToken, account: accounts[0] };
    }
  };

  return { publicationJobsRepo, tiktokAccountsRepo, tokenService };
}

test('worker skips jobs for other platforms', async () => {
  const { publicationJobsRepo, tiktokAccountsRepo, tokenService } = createMockRepos();
  const worker = createTikTokPublishWorker({
    publicationJobsRepo,
    tiktokAccountsRepo,
    tokenService,
    publisher: { directPost: async () => ({}) }
  });

  const res = await worker.processSingleJob(TENANT_ID, { platform: 'youtube', id: 'job_yt_1' });
  assert.equal(res.skipped, true);
  assert.equal(publicationJobsRepo.transitioned.length, 0);
});

test('worker fails job when no connected account is available', async () => {
  const { publicationJobsRepo, tiktokAccountsRepo, tokenService } = createMockRepos({ accounts: [] });
  const worker = createTikTokPublishWorker({
    publicationJobsRepo,
    tiktokAccountsRepo,
    tokenService,
    publisher: { directPost: async () => ({}) }
  });

  const res = await worker.processSingleJob(TENANT_ID, { platform: 'tiktok', id: 'job_1' });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'NO_CONNECTED_ACCOUNT');
  const tx = publicationJobsRepo.transitioned[0];
  assert.equal(tx.toStatus, 'failed');
  assert.equal(tx.patch.failureCode, 'NO_CONNECTED_ACCOUNT');
  assert.equal(tx.patch.nextRetryAt, null);
});

test('worker fails job when token service throws REAUTH_REQUIRED', async () => {
  const reauthErr = new Error('Refresh token revoked');
  reauthErr.code = 'REAUTH_REQUIRED';

  const { publicationJobsRepo, tiktokAccountsRepo, tokenService } = createMockRepos({ validToken: reauthErr });
  const worker = createTikTokPublishWorker({
    publicationJobsRepo,
    tiktokAccountsRepo,
    tokenService,
    publisher: { directPost: async () => ({}) }
  });

  const res = await worker.processSingleJob(TENANT_ID, { platform: 'tiktok', id: 'job_2' });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'TIKTOK_REAUTH_REQUIRED');
  const tx = publicationJobsRepo.transitioned[0];
  assert.equal(tx.toStatus, 'failed');
  assert.equal(tx.patch.failureCode, 'TIKTOK_REAUTH_REQUIRED');
});

test('worker publishes direct post successfully and records creator attribution', async () => {
  const { publicationJobsRepo, tiktokAccountsRepo, tokenService } = createMockRepos();
  let directPostCalledWith = null;

  const publisher = {
    async getCreatorInfo({ accessToken }) {
      return {
        username: 'affiliate_pro',
        nickname: 'Affiliate Pro',
        privacyLevelOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
        commentDisabled: false,
        duetDisabled: false,
        stitchDisabled: false
      };
    },
    async directPost(payload) {
      directPostCalledWith = payload;
      return {
        publishId: 'v_pub_tiktok_777',
        status: 'PROCESSING_DOWNLOAD'
      };
    }
  };

  const worker = createTikTokPublishWorker({
    publicationJobsRepo,
    tiktokAccountsRepo,
    tokenService,
    publisher
  });

  const job = {
    id: 'job_publish_success',
    platform: 'tiktok',
    providerResponse: {
      content: {
        videoUrl: 'https://cdn.zaffiliate.com/test_video.mp4',
        title: 'Amazing Deal! #ad',
        privacyLevel: 'PUBLIC_TO_EVERYONE'
      }
    }
  };

  const res = await worker.processSingleJob(TENANT_ID, job);
  assert.equal(res.success, true);
  assert.equal(res.publishId, 'v_pub_tiktok_777');
  assert.equal(directPostCalledWith.title, 'Amazing Deal! #ad');

  const tx = publicationJobsRepo.transitioned[0];
  assert.equal(tx.toStatus, 'published');
  assert.equal(tx.patch.externalContentId, 'v_pub_tiktok_777');
  assert.equal(tx.patch.providerResponse.creator.username, 'affiliate_pro');
});

test('worker computes exponential backoff retry on retryable failure and dead-letters on max attempts', async () => {
  const { publicationJobsRepo, tiktokAccountsRepo, tokenService } = createMockRepos();

  const publisher = {
    async getCreatorInfo() {
      return { privacyLevelOptions: ['PUBLIC_TO_EVERYONE'] };
    },
    async directPost() {
      throw new TikTokPublishError('Rate limit exceeded', {
        code: 'TIKTOK_RATE_LIMITED',
        category: 'RATE_LIMIT',
        retryable: true,
        httpStatus: 429
      });
    }
  };

  const worker = createTikTokPublishWorker({
    publicationJobsRepo,
    tiktokAccountsRepo,
    tokenService,
    publisher,
    baseRetryDelayMs: 200,
    maxRetryDelayMs: 5000
  });

  const jobAttempt1 = {
    id: 'job_retry_1',
    platform: 'tiktok',
    attempt: 0,
    maxAttempts: 3,
    providerResponse: { content: { videoUrl: 'https://cdn.zaffiliate.com/video.mp4' } }
  };

  const res1 = await worker.processSingleJob(TENANT_ID, jobAttempt1);
  assert.equal(res1.success, false);
  assert.equal(res1.retryable, true);
  assert.ok(res1.nextRetry != null);
  const tx1 = publicationJobsRepo.transitioned[0];
  assert.equal(tx1.toStatus, 'failed');
  assert.ok(tx1.patch.nextRetryAt != null);

  // When attempt is at maxAttempts (e.g. attempt 2 of max 3), it should NOT retry anymore
  const jobExhausted = {
    id: 'job_retry_exhausted',
    platform: 'tiktok',
    attempt: 2, // will become attempt 3
    maxAttempts: 3,
    providerResponse: { content: { videoUrl: 'https://cdn.zaffiliate.com/video.mp4' } }
  };

  const res2 = await worker.processSingleJob(TENANT_ID, jobExhausted);
  assert.equal(res2.success, false);
  assert.equal(res2.nextRetry, null);
  const tx2 = publicationJobsRepo.transitioned[1];
  assert.equal(tx2.patch.nextRetryAt, null);
});

test('runTick claims due jobs and processes them', async () => {
  const dueJob = {
    id: 'job_due_1',
    platform: 'tiktok',
    attempt: 0,
    maxAttempts: 3,
    providerResponse: { content: { videoUrl: 'https://cdn.zaffiliate.com/video.mp4', title: 'Viral video' } }
  };

  const { publicationJobsRepo, tiktokAccountsRepo, tokenService } = createMockRepos({
    claimedJobs: [dueJob]
  });

  const publisher = {
    async getCreatorInfo() { return { privacyLevelOptions: ['PUBLIC_TO_EVERYONE'] }; },
    async directPost() { return { publishId: 'pub_due_ok', status: 'PROCESSING_DOWNLOAD' }; }
  };

  const worker = createTikTokPublishWorker({
    publicationJobsRepo,
    tiktokAccountsRepo,
    tokenService,
    publisher
  });

  const tickResult = await worker.runTick(TENANT_ID);
  assert.equal(tickResult.claimedCount, 1);
  assert.equal(tickResult.processedCount, 1);
  assert.equal(tickResult.results[0].success, true);
  assert.equal(tickResult.results[0].publishId, 'pub_due_ok');
});
