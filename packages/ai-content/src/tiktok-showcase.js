import { createHash } from 'node:crypto';
import { generatePublishingIdempotencyKey } from '../../adapters/src/publishing.js';

export const TIKTOK_SHOWCASE_DISCLOSURES = Object.freeze([
  '#TikTokMadeMeBuyIt',
  '#Ad',
  '#Sponsored',
  '#affiliate',
  '#นายหน้าtiktok'
]);

function required(value, name) {
  const t = String(value ?? '').trim();
  if (!t) throw new TypeError(`${name} is required`);
  return t;
}

function sha256(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

export function createTikTokShowcaseService({
  publicationJobsRepo = null,
  clock = Date.now
} = {}) {
  function generateShowcasePackage({
    tenantId,
    productId,
    productName,
    priceMinorUnits = null,
    currency = 'THB',
    keyFeatures = [],
    affiliateUrl,
    language = 'th'
  }) {
    const tid = required(tenantId, 'tenantId');
    const pid = required(productId, 'productId');
    const name = required(productName, 'productName');
    const affUrl = required(affiliateUrl, 'affiliateUrl');

    const formattedPrice = priceMinorUnits != null
      ? (Number(priceMinorUnits) / 100).toFixed(2)
      : null;

    const featuresList = Array.isArray(keyFeatures) && keyFeatures.length > 0
      ? keyFeatures.join(', ')
      : 'คุณภาพดี คุ้มค่าราคา';

    // Hook generation tailored for TikTok fast-paced swipe behavior
    const hooks = language === 'th' ? [
      { id: 'hook_1', text: `ใครยังไม่มี ${name} พลาดมาก! ใช้แล้วชีวิตเปลี่ยน`, type: 'curiosity', score: 94 },
      { id: 'hook_2', text: `ของมันต้องมี! ${name} ราคาแค่ ${formattedPrice || 'หลักร้อย'} คุ้มเกินราคา`, type: 'value', score: 91 },
      { id: 'hook_3', text: `ลองสั่ง ${name} มาตามรีวิว... สรุปดีจริงไหม?`, type: 'review', score: 88 }
    ] : [
      { id: 'hook_1', text: `Stop scrolling if you need ${name}!`, type: 'pattern_interrupt', score: 93 },
      { id: 'hook_2', text: `I found the best ${name} on TikTok Shop!`, type: 'curiosity', score: 90 },
      { id: 'hook_3', text: `Why is everyone obsessed with this ${name}?`, type: 'social_proof', score: 89 }
    ];

    // Script generation structured for 9:16 short form (30s)
    const script = {
      language,
      durationSeconds: 30,
      aspectRatio: '9:16',
      beats: [
        {
          timestamp: '00:00-00:03',
          section: 'hook',
          audio: hooks[0].text,
          visualCue: 'Close-up product reveal with fast zoom-in'
        },
        {
          timestamp: '00:03-00:15',
          section: 'problem_and_demo',
          audio: language === 'th'
            ? `ตัวนี้มีจุดเด่นคือ ${featuresList} ใช้สะดวกมาก`
            : `Here is why it is amazing: ${featuresList}. Super easy to use!`,
          visualCue: 'Hands-on practical usage demonstration'
        },
        {
          timestamp: '00:15-00:25',
          section: 'proof_and_value',
          audio: language === 'th'
            ? `ราคานี้ได้คุณภาพขนาดนี้คือเกินคุ้ม ${formattedPrice ? `แค่ ${formattedPrice} ${currency}` : ''}`
            : `Unbelievable quality for the price ${formattedPrice ? `at only ${formattedPrice} ${currency}` : ''}`,
          visualCue: 'Detail textures and packaging proof'
        },
        {
          timestamp: '00:25-00:30',
          section: 'call_to_action',
          audio: language === 'th'
            ? 'พิกัดกดที่ตะกร้าเหลืองซ้ายมือเลยครับ รีบกดก่อนของหมด!'
            : 'Check the yellow basket or link in bio to grab yours before it is sold out!',
          visualCue: 'Finger pointing down towards yellow basket sticker / link'
        }
      ]
    };

    // Caption compliant with TikTok hashtag disclosures
    const disclosures = language === 'th'
      ? '#TikTokMadeMeBuyIt #นายหน้าtiktok #รีวิวของดี #ad #sponsored'
      : '#TikTokMadeMeBuyIt #TikTokShop #Affiliate #ad #sponsored';

    const caption = `${name} ${formattedPrice ? `ราคาพิเศษ ${formattedPrice} ${currency}` : ''}\n\n${disclosures}`;

    // Provenance hash for audit trail
    const inputHash = sha256(`${tid}:${pid}:${name}:${language}:${script.durationSeconds}`);
    const provenance = Object.freeze({
      productId: pid,
      productName: name,
      language,
      templateVersion: 'v2_tiktok_showcase',
      inputHash,
      createdAt: new Date(clock()).toISOString()
    });

    return Object.freeze({
      tenantId: tid,
      productId: pid,
      caption,
      hooks: Object.freeze(hooks),
      script: Object.freeze(script),
      videoConstraints: Object.freeze({
        aspectRatio: '9:16',
        targetDurationSec: 30,
        maxDurationSec: 60,
        recommendedCodec: 'h264',
        container: 'mp4'
      }),
      affiliateUrl: affUrl,
      provenance
    });
  }

  async function createShowcasePublicationJob({
    tenantId,
    showcasePackage,
    videoUrl,
    accountId,
    privacyLevel = 'PUBLIC_TO_EVERYONE',
    scheduledFor = null
  }) {
    if (!publicationJobsRepo || typeof publicationJobsRepo.create !== 'function') {
      throw new Error('publicationJobsRepo is required to create publication job');
    }

    const tid = required(tenantId, 'tenantId');
    const pkg = showcasePackage;
    const vUrl = required(videoUrl, 'videoUrl');
    const accId = required(accountId, 'accountId');

    const idempotencyKey = generatePublishingIdempotencyKey({
      tenantId: tid,
      accountId: accId,
      contentId: pkg.productId,
      operation: 'showcase_post',
      salt: pkg.provenance.inputHash.slice(0, 8)
    });

    const job = await publicationJobsRepo.create(tid, {
      platform: 'tiktok',
      status: 'scheduled',
      idempotencyKey,
      scheduledFor,
      contentItemId: null,
      maxAttempts: 3,
      providerResponse: {
        title: pkg.caption,
        videoUrl: vUrl,
        privacyLevel,
        productId: pkg.productId,
        provenance: pkg.provenance
      }
    });

    return job;
  }

  return Object.freeze({
    generateShowcasePackage,
    createShowcasePublicationJob
  });
}
