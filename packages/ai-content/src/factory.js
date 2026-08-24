import { randomUUID } from 'node:crypto';

const BANNED_CLAIM_PATTERNS = [
  /\bguarantee(d|s)?\b/i,
  /\bmiracle\b/i,
  /\brisk-free\b/i,
  /\bcures?\b/i,
  /\bheals?\b/i,
  /\bearn(ing)?s? (money|income|cash)\b/i,
  /\bpassive income\b/i,
  /\bget rich\b/i,
  /\bno side effects\b/i,
  /\bbest ever\b/i
];

const SCARCITY_PATTERNS = [/\blimited time\b/i, /\bhurry\b/i, /\bonly today\b/i, /\bwhile stocks last\b/i];

export const PERSONAS = Object.freeze([
  { id: 'budget-shopper', name: 'Budget Shopper', painPoints: ['overpaying for basics'], motivations: ['value per baht', 'deals'], objections: ['cheap quality'], contentStyle: 'price-comparison', ctaPreference: 'check-price' },
  { id: 'beauty-enthusiast', name: 'Beauty Enthusiast', painPoints: ['product overload'], motivations: ['trendworthy looks', 'skin safety'], objections: ['unverified ingredients'], contentStyle: 'close-up-demo', ctaPreference: 'shop-the-look' },
  { id: 'fitness-beginner', name: 'Fitness Beginner', painPoints: ['gym intimidation'], motivations: ['small wins'], objections: ['complex routines'], contentStyle: 'step-by-step', ctaPreference: 'start-today' },
  { id: 'busy-professional', name: 'Busy Professional', painPoints: ['no time'], motivations: ['convenience', 'efficiency'], objections: ['learning curves'], contentStyle: 'fast-cuts', ctaPreference: 'one-tap-buy' },
  { id: 'student', name: 'Student', painPoints: ['tight budget'], motivations: ['study comfort'], objections: ['price'], contentStyle: 'relatable-humor', ctaPreference: 'student-deal' },
  { id: 'parent', name: 'Parent', painPoints: ['safety concerns'], motivations: ['family wellbeing'], objections: ['durability doubts'], contentStyle: 'real-life-use', ctaPreference: 'see-details' },
  { id: 'tech-lover', name: 'Tech Lover', painPoints: ['spec fatigue'], motivations: ['new gadgets'], objections: ['gimmicky features'], contentStyle: 'hands-on-review', ctaPreference: 'spec-sheet' },
  { id: 'home-improver', name: 'Home Improver', painPoints: ['clutter'], motivations: ['cozy spaces'], objections: ['installation effort'], contentStyle: 'before-after', ctaPreference: 'transform-space' },
  { id: 'luxury-buyer', name: 'Luxury Buyer', painPoints: ['counterfeit risk'], motivations: ['craftsmanship'], objections: ['mass-market feel'], contentStyle: 'premium-aesthetic', ctaPreference: 'exclusive-access' },
  { id: 'creator', name: 'Creator', painPoints: ['content burnout'], motivations: ['audience growth'], objections: ['steep tools'], contentStyle: 'behind-the-scenes', ctaPreference: 'creator-kit' }
].map((persona) => Object.freeze(persona)));

export function getPersona(id) {
  return PERSONAS.find((persona) => persona.id === String(id ?? '').trim().toLowerCase()) ?? null;
}

function mint(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

const PLATFORMS = Object.freeze(['tiktok', 'shopee', 'facebook', 'instagram', 'youtube', 'line']);

export const PROMPT_REGISTRY = Object.freeze([
  Object.freeze({
    name: 'creative-brief',
    version: 'v1',
    owner: 'content-factory',
    model: 'provider-neutral',
    status: 'active',
    inputSchema: Object.freeze(['tenantId', 'product', 'personaId', 'platform', 'objective', 'tone', 'cta']),
    outputSchema: Object.freeze(['briefId', 'persona', 'problem', 'desiredOutcome', 'keyBenefits', 'evidence', 'differentiators', 'primaryCta', 'disclosure'])
  }),
  Object.freeze({
    name: 'viral-hooks',
    version: 'v1',
    owner: 'content-factory',
    model: 'provider-neutral',
    status: 'active',
    inputSchema: Object.freeze(['brief']),
    outputSchema: Object.freeze(['hooks', 'rejected'])
  }),
  Object.freeze({
    name: 'content-quality',
    version: 'v1',
    owner: 'content-factory',
    model: 'provider-neutral',
    status: 'active',
    inputSchema: Object.freeze(['text', 'disclosure', 'platform']),
    outputSchema: Object.freeze(['total', 'scores', 'issues', 'verdict'])
  }),
  Object.freeze({
    name: 'script-generator',
    version: 'v1',
    owner: 'content-factory',
    model: 'provider-neutral',
    status: 'active',
    inputSchema: Object.freeze(['brief', 'format']),
    outputSchema: Object.freeze(['scriptId', 'scenes', 'omittedSections'])
  }),
  Object.freeze({
    name: 'storyboard',
    version: 'v1',
    owner: 'content-factory',
    model: 'provider-neutral',
    status: 'active',
    inputSchema: Object.freeze(['script', 'aspect']),
    outputSchema: Object.freeze(['storyboardId', 'scriptId', 'aspect', 'scenes'])
  })
]);

export function getPrompt(name, version = null) {
  const entry = PROMPT_REGISTRY.find(
    (prompt) => prompt.name === String(name ?? '').trim() && (version == null || prompt.version === version)
  );
  if (!entry) throw new Error(`unknown prompt: ${name}@${version ?? 'latest'}`);
  return entry;
}

const DISCLOSURE_TEXT = 'This post uses affiliate links; a commission may be earned at no extra cost to you.';

export function createCreativeBrief({ tenantId, product, personaId, platform, objective, tone, cta }) {
  const persona = getPersona(personaId);
  if (!persona) throw new Error('unknown persona');
  if (!PLATFORMS.includes(String(platform ?? '').trim().toLowerCase())) throw new Error('unsupported platform');
  requireText(tenantId, 'tenantId');
  requireText(objective, 'objective');
  requireText(cta, 'primary CTA');

  const title = requireText(product?.title, 'product.title');
  const benefits = Array.isArray(product.benefits) ? product.benefits : [];
  if (benefits.length === 0) throw new Error('at least one benefit is required');
  const evidence = Array.isArray(product.evidence) ? product.evidence : [];
  const evidenceIds = new Set(evidence.map((entry) => entry.id));
  for (const benefit of benefits) {
    if (!benefit.evidenceRef || !evidenceIds.has(benefit.evidenceRef)) {
      throw new Error(`benefit "${benefit.text ?? benefit.id}" is missing an evidence reference; claims must be traceable`);
    }
  }
  const socialProof = Array.isArray(product.socialProof) ? product.socialProof : [];
  for (const entry of socialProof) {
    if (!entry.text || !entry.evidenceRef || !evidenceIds.has(entry.evidenceRef)) {
      throw new Error('social proof entries require text and a valid evidence reference');
    }
  }

  const occurredAt = new Date().toISOString();
  return Object.freeze({
    briefId: mint('brf'),
    createdAt: occurredAt,
    tenantId: String(tenantId).trim(),
    product: Object.freeze({
      title,
      brand: requireText(product.brand, 'product.brand'),
      category: requireText(product.category, 'product.category'),
      priceMinorUnits: Number(product.priceMinorUnits ?? 0),
      currency: String(product.currency ?? 'THB').toUpperCase(),
      problem: requireText(product.problem, 'product.problem'),
      desiredOutcome: requireText(product.outcome, 'product.outcome'),
      benefits: Object.freeze(benefits.map((benefit) => Object.freeze({ ...benefit }))),
      evidence: Object.freeze(evidence.map((entry) => Object.freeze({ ...entry }))),
      socialProof: Object.freeze(socialProof.map((entry) => Object.freeze({ ...entry }))),
      differentiators: Object.freeze(Array.isArray(product.differentiators) ? [...product.differentiators] : [])
    }),
    persona,
    platform: String(platform).trim().toLowerCase(),
    objective: String(objective).trim(),
    tone: String(tone ?? 'friendly').trim().toLowerCase(),
    primaryCta: String(cta).trim(),
    disclosure: Object.freeze({ required: true, text: DISCLOSURE_TEXT }),
    prompt: getPrompt('creative-brief')
  });
}

const HOOK_TEMPLATES = Object.freeze([
  { category: 'curiosity', build: (c) => `Nobody talks about this ${c.title} detail` },
  { category: 'curiosity', build: (c) => `Wait until you see what this ${c.category} pick actually does` },
  { category: 'problem', build: (c) => `${c.problem}? This fixes it` },
  { category: 'problem', build: (c) => `If ${c.problem.toLowerCase()}, watch this before buying anything` },
  { category: 'transformation', build: (c) => `From ${c.problem.toLowerCase()} to ${c.desiredOutcome}` },
  { category: 'transformation', build: (c) => `${c.primaryBenefit} — here is how it feels in use` },
  { category: 'comparison', build: (c) => `${c.title} vs the generic one — here is the difference` },
  { category: 'mistake', build: (c) => `The mistake everyone makes buying a ${c.category} product` },
  { category: 'secret', build: (c) => `The feature ${c.brand} does not put on the box: ${c.secondaryBenefit}` },
  { category: 'checklist', build: (c) => `3 things to check before any ${c.category} purchase` },
  { category: 'challenge', build: (c) => `I used the ${c.title} for one week — honest result` },
  { category: 'story', build: (c) => `How a ${c.title} saved my next trip` },
  { category: 'before-after', build: (c) => `Before and after: ${c.desiredOutcome}` }
]);

function scoreHook(text, brief) {
  const lower = text.toLowerCase();
  let clarity = 100 - Math.max(0, text.length - 60);
  const mentionsBenefitOrOutcome = brief.product.benefits.some((benefit) =>
    lower.includes(benefit.text.split(' ').slice(0, 2).join(' ').toLowerCase())
  ) || lower.includes(brief.product.desiredOutcome.toLowerCase());
  const emotionalPull = /(nobody|wait|mistake|secret|before|hurry)/.test(lower) ? 85 : 65;
  const scrollPotential = text.length <= 48 ? 90 : text.length <= 70 ? 75 : 55;
  const brandFit = mentionsBenefitOrOutcome ? 90 : 70;
  let complianceRisk = 20;
  for (const pattern of BANNED_CLAIM_PATTERNS) if (pattern.test(text)) complianceRisk += 60;
  for (const pattern of SCARCITY_PATTERNS) if (pattern.test(text)) complianceRisk += 25;
  complianceRisk = Math.min(complianceRisk, 100);
  const overall = Math.max(0, Math.round(scrollPotential * 0.25 + clarity * 0.25 + emotionalPull * 0.15 + brandFit * 0.15 + (100 - complianceRisk) * 0.2));
  return Object.freeze({
    scrollPotential,
    clarity: Math.max(0, Math.min(100, clarity)),
    emotionalPull,
    brandFit,
    complianceRisk,
    overall
  });
}

export function generateHooks({ brief, count = 20 } = {}) {
  if (!brief || typeof brief !== 'object') throw new TypeError('brief is required');
  const hooks = [];
  const rejected = [];
  const ctx = {
    title: brief.product.title,
    brand: brief.product.brand,
    category: brief.product.category,
    problem: brief.product.problem,
    desiredOutcome: brief.product.desiredOutcome,
    primaryBenefit: brief.product.benefits[0]?.text ?? '',
    secondaryBenefit: brief.product.benefits[1]?.text ?? ''
  };
  const seen = new Set();
  let index = 0;
  while (hooks.length < count && index < HOOK_TEMPLATES.length * 6) {
    const template = HOOK_TEMPLATES[index % HOOK_TEMPLATES.length];
    const variantSuffix = Math.floor(index / HOOK_TEMPLATES.length);
    const base = template.build(ctx);
    const text = variantSuffix === 0 ? base : `${base} (${variantSuffix + 1})`;
    index += 1;
    if (seen.has(text)) continue;
    seen.add(text);
    const unsafe = BANNED_CLAIM_PATTERNS.some((pattern) => pattern.test(text)) || SCARCITY_PATTERNS.some((pattern) => pattern.test(text));
    if (unsafe) {
      rejected.push(Object.freeze({ text, reason: 'unsubstantiated or pressure language' }));
      continue;
    }
    hooks.push(Object.freeze({ id: mint('hook'), category: template.category, text, scores: scoreHook(text, brief), overall: scoreHook(text, brief).overall }));
  }
  if (hooks.length < count) throw new Error(`only produced ${hooks.length} compliant hooks`);
  return Object.freeze({ hooks: Object.freeze(hooks), rejected: Object.freeze(rejected), prompt: getPrompt('viral-hooks') });
}

const QUALITY_THRESHOLD_DEFAULT = 70;

export function scoreContentQuality({ text, disclosure, platform, threshold = QUALITY_THRESHOLD_DEFAULT } = {}) {
  const body = String(text ?? '');
  const issues = [];
  const words = body.split(/\s+/).filter(Boolean);
  const sentences = body.split(/[.!?]+/).filter((sentence) => sentence.trim());

  const readability = Math.max(0, Math.min(100, 100 - Math.abs(words.length - 35)));
  const spamHits = (body.match(/!/g) ?? []).length >= 3
    || body.replace(/[^A-Z]/g, '').length > body.length * 0.4
    || (body.match(/#/g) ?? []).length >= 5;
  const spamLikelihood = spamHits ? 20 : 95;
  if (spamHits) issues.push('spam-shaped formatting (excessive caps/exclamation/hashtags)');

  const hasDisclosure = String(disclosure ?? '').trim().length > 0;
  const socialPlatform = ['tiktok', 'instagram', 'facebook', 'youtube'].includes(String(platform ?? '').toLowerCase());
  const disclosureScore = !socialPlatform ? 100 : hasDisclosure ? 100 : 0;
  if (socialPlatform && !hasDisclosure) issues.push('missing affiliate/sponsored disclosure');

  let claimsSafety = 100;
  const claimHits = [];
  for (const pattern of BANNED_CLAIM_PATTERNS) {
    if (pattern.test(body)) {
      claimsSafety -= 40;
      claimHits.push(body.match(pattern)?.[0] ?? '');
    }
  }
  for (const pattern of SCARCITY_PATTERNS) {
    if (pattern.test(body)) {
      claimsSafety -= 25;
      claimHits.push(body.match(pattern)?.[0] ?? '');
    }
  }
  if (/\bbest\b[\w\s-]{0,24}\bever\b/i.test(body)) {
    claimsSafety -= 25;
    claimHits.push('unverifiable superlative');
  }
  claimsSafety = Math.max(0, claimsSafety);
  if (claimHits.length > 0) {
    issues.push(`unsupported or pressure claim detected (${claimHits.join(', ')}) — claims must trace to product evidence`);
  }

  const brandConsistency = /[!]{3,}/.test(body) ? 50 : 90;
  const total = Math.round(readability * 0.2 + spamLikelihood * 0.2 + disclosureScore * 0.3 + claimsSafety * 0.2 + brandConsistency * 0.1);
  const failClosed = disclosureScore < 100 || claimsSafety < 100;
  return Object.freeze({
    total,
    scores: Object.freeze({
      readability,
      spamLikelihood,
      disclosure: disclosureScore,
      claimsSafety,
      brandConsistency
    }),
    issues: Object.freeze(issues),
    verdict: !failClosed && total >= threshold ? 'approved' : 'revision_required',
    prompt: getPrompt('content-quality')
  });
}

const SCRIPT_FORMATS = Object.freeze({
  '15s-short': 15,
  '30s-short': 30,
  '60s-short': 60,
  tutorial: 90,
  comparison: 45,
  'review-style': 60,
  'ugc-style': 30,
  storytelling: 45,
  educational: 60
});

const SCENE_WEIGHTS = Object.freeze({
  hook: 0.12,
  problem: 0.18,
  insight: 0.15,
  solution: 0.2,
  demo: 0.2,
  'social-proof': 0.08,
  cta: 0.05,
  disclosure: 0.02
});

const SCENE_CAPTIONS = Object.freeze({
  hook: 'WAIT FOR IT',
  problem: 'THE DAILY STRUGGLE',
  insight: 'THE DETAIL THAT MATTERS',
  solution: 'MEET THE FIX',
  demo: 'SEE IT IN USE',
  'social-proof': 'RATED BY REAL BUYERS',
  cta: 'TAP TO CHECK PRICE',
  disclosure: 'AFFILIATE DISCLOSURE'
});

export function generateScript({ brief, format } = {}) {
  if (!brief || typeof brief !== 'object') throw new TypeError('brief is required');
  const normalizedFormat = String(format ?? '').trim().toLowerCase();
  const budget = SCRIPT_FORMATS[normalizedFormat];
  if (!budget) throw new Error(`unsupported script format: ${format}. supported: ${Object.keys(SCRIPT_FORMATS).join(', ')}`);

  const product = brief.product;
  const primaryBenefit = product.benefits[0];
  const evidenceFor = (entry) => product.evidence.find((item) => item.id === entry.evidenceRef);

  const hooks = generateHooks({ brief, count: 20 });
  const topHook = [...hooks.hooks].sort((a, b) => b.overall - a.overall)[0];

  const sections = [
    { label: 'hook', voiceover: topHook.text },
    { label: 'problem', voiceover: `Here is the frustrating part: ${product.problem.toLowerCase()}.` },
    {
      label: 'insight',
      voiceover: `The design detail that matters: ${primaryBenefit.text.toLowerCase()} — ${evidenceFor(primaryBenefit).statement.toLowerCase()} (${evidenceFor(primaryBenefit).source}).`
    },
    { label: 'solution', voiceover: `That is why the ${product.title} works for ${product.desiredOutcome}.` },
    { label: 'demo', voiceover: `A quick look at real use: ${product.benefits[1] ? product.benefits[1].text.toLowerCase() : product.desiredOutcome}.` }
  ];

  const omittedSections = [];
  if (product.socialProof.length > 0) {
    sections.push({ label: 'social-proof', voiceover: `${product.socialProof[0].text}.` });
  } else {
    omittedSections.push('social-proof omitted: not substantiated by supplied evidence');
  }

  sections.push(
    { label: 'cta', voiceover: brief.primaryCta },
    { label: 'disclosure', voiceover: brief.disclosure.text }
  );

  const weightTotal = sections.reduce((sum, section) => sum + SCENE_WEIGHTS[section.label], 0);
  let cursor = 0;
  const scenes = sections.map((section, index) => {
    let duration = index === sections.length - 1
      ? budget - cursor
      : Math.max(1, Math.floor((SCENE_WEIGHTS[section.label] / weightTotal) * budget));
    if (index !== sections.length - 1 && cursor + duration > budget - (sections.length - index - 1)) {
      duration = budget - cursor - (sections.length - index - 1);
    }
    const scene = Object.freeze({
      index,
      label: section.label,
      startSeconds: cursor,
      endSeconds: cursor + duration,
      voiceover: section.voiceover,
      caption: SCENE_CAPTIONS[section.label]
    });
    cursor += duration;
    return scene;
  });

  return Object.freeze({
    scriptId: mint('scr'),
    briefId: brief.briefId,
    format: normalizedFormat,
    durationSeconds: budget,
    scenes: Object.freeze(scenes),
    omittedSections: Object.freeze(omittedSections),
    prompt: getPrompt('script-generator')
  });
}

const ASPECTS = Object.freeze(['9:16', '1:1', '4:5', '16:9']);

const VISUAL_BY_LABEL = Object.freeze({
  hook: 'product close-up with bold headline overlay',
  problem: 'problem reenactment shot',
  insight: 'feature macro shot',
  solution: 'solution demonstration',
  demo: 'hands-on demo b-roll',
  'social-proof': 'rating overlay card',
  cta: 'CTA end card',
  disclosure: 'disclosure lower-third banner'
});

export function createStoryboard({ script, aspect }) {
  if (!script || !Array.isArray(script.scenes)) throw new TypeError('script with scenes is required');
  const normalizedAspect = String(aspect ?? '9:16').trim();
  if (!ASPECTS.includes(normalizedAspect)) throw new Error(`unsupported aspect: ${aspect}`);

  let expectedStart = 0;
  for (const scene of script.scenes) {
    if (scene.startSeconds !== expectedStart || scene.endSeconds <= scene.startSeconds) {
      throw new Error(`invalid scene timestamps at "${scene.label ?? scene.index}": expected start ${expectedStart}`);
    }
    expectedStart = scene.endSeconds;
  }

  const scenes = script.scenes.map((scene) => Object.freeze({
    scene: scene.index + 1,
    durationLabel: `${scene.startSeconds}-${scene.endSeconds}s`,
    durationSeconds: scene.endSeconds - scene.startSeconds,
    visual: VISUAL_BY_LABEL[scene.label],
    voice: scene.voiceover,
    caption: scene.caption
  }));

  return Object.freeze({
    storyboardId: mint('sbd'),
    scriptId: script.scriptId,
    aspect: normalizedAspect,
    scenes: Object.freeze(scenes),
    editable: true,
    prompt: getPrompt('storyboard')
  });
}
