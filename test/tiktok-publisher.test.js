import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTikTokPublisher,
  generatePublishingIdempotencyKey,
  classifyTikTokError,
  TikTokPublishError,
  PRIVACY_LEVELS
} from '../packages/adapters/src/tiktok-publisher.js';

const ACCESS_TOKEN = 'act_creator_token_123';
const VALID_VIDEO_URL = 'https://cdn.zaffiliate.com/assets/video_123.mp4';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

test('generatePublishingIdempotencyKey produces deterministic unique hash', () => {
  const key1 = generatePublishingIdempotencyKey({
    tenantId: TENANT_ID,
    accountId: 'acc_1',
    contentId: 'vid_1'
  });
  const key2 = generatePublishingIdempotencyKey({
    tenantId: TENANT_ID,
    accountId: 'acc_1',
    contentId: 'vid_1'
  });
  const keyDifferent = generatePublishingIdempotencyKey({
    tenantId: TENANT_ID,
    accountId: 'acc_1',
    contentId: 'vid_2'
  });

  assert.equal(key1, key2);
  assert.notEqual(key1, keyDifferent);
  assert.ok(key1.startsWith('ttpub_'));
});

test('classifyTikTokError categorizes errors into retryable and permanent', () => {
  const rateLimit = classifyTikTokError(429, 'rate_limit_exceeded');
  assert.equal(rateLimit.category, 'RATE_LIMIT');
  assert.equal(rateLimit.retryable, true);

  const authInvalid = classifyTikTokError(401, 'access_token_invalid');
  assert.equal(authInvalid.category, 'AUTHENTICATION');
  assert.equal(authInvalid.retryable, false);

  const scopeForbidden = classifyTikTokError(403, 'scope_not_authorized');
  assert.equal(scopeForbidden.category, 'AUTHORIZATION');
  assert.equal(scopeForbidden.retryable, false);

  const validation = classifyTikTokError(400, 'invalid_param');
  assert.equal(validation.category, 'VALIDATION');
  assert.equal(validation.retryable, false);

  const serverError = classifyTikTokError(500, 'server_error');
  assert.equal(serverError.category, 'PROVIDER_UNAVAILABLE');
  assert.equal(serverError.retryable, true);
});

test('getCreatorInfo queries creator information and returns privacy options', async () => {
  let capturedHeaders = null;
  const transport = async (url, init) => {
    capturedHeaders = init.headers;
    return {
      status: 200,
      json: async () => ({
        data: {
          creator_avatar_url: 'https://p16.tiktokcdn.com/avatar.jpeg',
          creator_nickname: 'Cool Affiliate',
          creator_username: 'cool_affiliate',
          privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
          comment_disabled: false,
          duet_disabled: false,
          stitch_disabled: true,
          max_video_post_duration_sec: 600
        },
        error: { code: 'ok' }
      })
    };
  };

  const publisher = createTikTokPublisher({ transport });
  const info = await publisher.getCreatorInfo({ accessToken: ACCESS_TOKEN });

  assert.equal(capturedHeaders.authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.equal(info.nickname, 'Cool Affiliate');
  assert.equal(info.username, 'cool_affiliate');
  assert.deepEqual(info.privacyLevelOptions, ['PUBLIC_TO_EVERYONE', 'SELF_ONLY']);
  assert.equal(info.stitchDisabled, true);
  assert.equal(info.maxVideoPostDurationSec, 600);
});

test('directPost validates inputs and initializes PULL_FROM_URL posting', async () => {
  let capturedBody = null;
  const transport = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      status: 200,
      json: async () => ({
        data: {
          publish_id: 'v_pub_pull_12345'
        },
        error: { code: 'ok' }
      })
    };
  };

  const publisher = createTikTokPublisher({ transport });
  const res = await publisher.directPost({
    accessToken: ACCESS_TOKEN,
    videoUrl: VALID_VIDEO_URL,
    title: 'Check out this awesome product! #TikTokMadeMeBuyIt #ad',
    privacyLevel: 'PUBLIC_TO_EVERYONE'
  });

  assert.equal(res.publishId, 'v_pub_pull_12345');
  assert.equal(res.status, 'PROCESSING_DOWNLOAD');
  assert.equal(capturedBody.source_info.source, 'PULL_FROM_URL');
  assert.equal(capturedBody.source_info.video_url, VALID_VIDEO_URL);
  assert.equal(capturedBody.post_info.privacy_level, 'PUBLIC_TO_EVERYONE');
});

test('directPost rejects private or insecure video URLs fail-closed', async () => {
  const publisher = createTikTokPublisher({ transport: async () => ({}) });

  await assert.rejects(
    async () => publisher.directPost({
      accessToken: ACCESS_TOKEN,
      videoUrl: 'http://insecure.example.com/video.mp4',
      title: 'Insecure Video'
    }),
    /scheme "http" is not allowed/
  );

  await assert.rejects(
    async () => publisher.directPost({
      accessToken: ACCESS_TOKEN,
      videoUrl: 'https://127.0.0.1/video.mp4',
      title: 'Local Video'
    }),
    /private host blocked/
  );
});

test('directPost rejects empty title or title exceeding 2200 chars', async () => {
  const publisher = createTikTokPublisher({ transport: async () => ({}) });

  await assert.rejects(
    async () => publisher.directPost({
      accessToken: ACCESS_TOKEN,
      videoUrl: VALID_VIDEO_URL,
      title: ''
    }),
    /title\/caption is required/
  );

  await assert.rejects(
    async () => publisher.directPost({
      accessToken: ACCESS_TOKEN,
      videoUrl: VALID_VIDEO_URL,
      title: 'a'.repeat(2201)
    }),
    /title exceeds maximum 2200 characters/
  );
});

test('initializeFileUpload and uploadChunkBytes upload video chunks with Range header', async () => {
  let initPayload = null;
  let chunkHeaders = null;

  const transport = async (url, init) => {
    if (url.includes('/video/init/')) {
      initPayload = JSON.parse(init.body);
      return {
        status: 200,
        json: async () => ({
          data: {
            publish_id: 'v_pub_upload_999',
            upload_url: 'https://open-upload.tiktokapis.com/video/upload/chunk'
          },
          error: { code: 'ok' }
        })
      };
    }
    if (url.includes('/video/upload/chunk')) {
      chunkHeaders = init.headers;
      return {
        status: 200,
        text: 'ok'
      };
    }
    return { status: 404 };
  };

  const publisher = createTikTokPublisher({ transport });
  const initResult = await publisher.initializeFileUpload({
    accessToken: ACCESS_TOKEN,
    videoSize: 1024,
    title: 'Manual Upload Video #ad'
  });

  assert.equal(initResult.publishId, 'v_pub_upload_999');
  assert.equal(initPayload.source_info.source, 'FILE_UPLOAD');
  assert.equal(initPayload.source_info.video_size, 1024);

  const fakeBytes = Buffer.alloc(1024, 0x42);
  const uploadResult = await publisher.uploadChunkBytes({
    uploadUrl: initResult.uploadUrl,
    chunkBytes: fakeBytes,
    startByte: 0,
    endByte: 1023,
    totalBytes: 1024
  });

  assert.equal(uploadResult.uploaded, true);
  assert.equal(uploadResult.bytesSent, 1024);
  assert.equal(chunkHeaders['content-range'], 'bytes 0-1023/1024');
});

test('fetchPublishStatus queries status and maps success/failure booleans', async () => {
  const successTransport = async () => ({
    status: 200,
    json: async () => ({
      data: { status: 'SUCCESS' },
      error: { code: 'ok' }
    })
  });

  const publisherSuccess = createTikTokPublisher({ transport: successTransport });
  const successStatus = await publisherSuccess.fetchPublishStatus({
    accessToken: ACCESS_TOKEN,
    publishId: 'pub_1'
  });
  assert.equal(successStatus.status, 'SUCCESS');
  assert.equal(successStatus.isCompleted, true);
  assert.equal(successStatus.isFailed, false);
  assert.equal(successStatus.isProcessing, false);

  const failTransport = async () => ({
    status: 200,
    json: async () => ({
      data: { status: 'FAILED', fail_reason: 'Video aspect ratio not supported' },
      error: { code: 'ok' }
    })
  });

  const publisherFail = createTikTokPublisher({ transport: failTransport });
  const failStatus = await publisherFail.fetchPublishStatus({
    accessToken: ACCESS_TOKEN,
    publishId: 'pub_2'
  });
  assert.equal(failStatus.status, 'FAILED');
  assert.equal(failStatus.isCompleted, false);
  assert.equal(failStatus.isFailed, true);
  assert.equal(failStatus.failReason, 'Video aspect ratio not supported');
});

test('callApi normalizes provider errors and throws TikTokPublishError', async () => {
  const errTransport = async () => ({
    status: 400,
    json: async () => ({
      error: {
        code: 'invalid_param',
        message: 'The parameter title contains forbidden words'
      }
    })
  });

  const publisher = createTikTokPublisher({ transport: errTransport });
  await assert.rejects(
    async () => publisher.directPost({
      accessToken: ACCESS_TOKEN,
      videoUrl: VALID_VIDEO_URL,
      title: 'Bad word'
    }),
    (err) => {
      assert.ok(err instanceof TikTokPublishError);
      assert.equal(err.category, 'VALIDATION');
      assert.equal(err.retryable, false);
      assert.equal(err.httpStatus, 400);
      return true;
    }
  );
});
