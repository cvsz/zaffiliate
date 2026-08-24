import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSONAS,
  getPersona,
  createCreativeBrief,
  generateHooks,
  scoreContentQuality,
  PROMPT_REGISTRY,
  getPrompt
} from '../packages/ai-content/src/factory.js';

const PRODUCT = {
  title: 'Silk Sleep Mask',
  brand: 'Dreamline',
  category: 'sleep-accessories',
  priceMinorUnits: 59000,
  currency: 'THB',
  outcome: 'falls asleep faster on flights',
  problem: 'cabin light ruins sleep',
  benefits: [
    { id: 'b1', text: 'blocks 100% of ambient light', evidenceRef: 'ev1' },
    { id: 'b2', text: 'zero pressure on eyes', evidenceRef: 'ev2' }
  ],
  evidence: [
    { id: 'ev1', source: 'manufacturer spec sheet', statement: 'opaque triple-layer front panel' },
    { id: 'ev2', source: 'product design doc', statement: 'contoured eye cups' }
  ]
};

const BASE_BRIEF_INPUT = {
  tenantId: 't1',
  product: PRODUCT,
  personaId: 'budget-shopper',
  platform: 'tiktok',
  objective: 'drive affiliate clicks',
  tone: 'friendly',
  cta: 'Tap the link to check today\'s price'
};

test('persona library is complete and frozen', () => {
  assert.equal(PERSONAS.length, 10);
  const requiredFields = ['id', 'name', 'painPoints', 'motivations', 'objections', 'contentStyle', 'ctaPreference'];
  for (const persona of PERSONAS) {
    for (const field of requiredFields) assert.ok(persona[field] != null, `${persona.id} missing ${field}`);
    assert.ok(Object.isFrozen(persona));
  }
});

test('unknown persona lookup fails closed', () => {
  assert.equal(getPersona('crypto-bro'), null);
});

test('benefits without evidence references are rejected at brief creation', () => {
  const error = capture(() => createCreativeBrief({
    ...BASE_BRIEF_INPUT,
    product: { ...PRODUCT, benefits: [{ id: 'b1', text: 'cures insomnia permanently', evidenceRef: null }] }
  }));
  assert.ok(error instanceof Error);
  assert.match(error.message, /evidence/i);
});

function capture(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

test('creative brief is a frozen source of truth with provenance and disclosure', () => {
  const brief = createCreativeBrief(BASE_BRIEF_INPUT);
  assert.ok(Object.isFrozen(brief));
  assert.ok(brief.briefId.startsWith('brf_'));
  assert.equal(brief.persona.id, 'budget-shopper');
  assert.equal(brief.disclosure.required, true);
  assert.match(brief.disclosure.text, /affiliate|commission/i);
  assert.equal(brief.product.benefits.length, 2);
  assert.ok(brief.prompt.name, 'creative-brief');
});

test('hook engine produces at least 20 scored hooks spanning every category', () => {
  const brief = createCreativeBrief(BASE_BRIEF_INPUT);
  const { hooks, rejected } = generateHooks({ brief });
  assert.ok(hooks.length >= 20, `expected >=20 hooks, got ${hooks.length}`);
  const categories = new Set(hooks.map((hook) => hook.category));
  for (const category of ['curiosity', 'problem', 'transformation', 'comparison', 'mistake', 'secret', 'checklist', 'challenge', 'story', 'before-after']) {
    assert.ok(categories.has(category), `missing category ${category}`);
  }
  for (const hook of hooks) {
    for (const value of Object.values(hook.scores)) {
      assert.ok(value >= 0 && value <= 100, `${hook.id} score out of range`);
    }
    assert.ok(hook.overall >= 0 && hook.overall <= 100);
    assert.doesNotMatch(hook.text, /guaranteed|miracle|risk-free/i, 'fabricated-claim language must never appear');
  }
  assert.deepEqual(rejected.map((entry) => entry.reason), []);
});

test('hooks grounded in unsubstantiated miracle claims are dropped and reported', () => {
  const brief = createCreativeBrief({
    ...BASE_BRIEF_INPUT,
    product: {
      ...PRODUCT,
      benefits: [{ id: 'b1', text: 'miracle cure that guarantees sleep', evidenceRef: 'ev1' }]
    }
  });
  const { hooks, rejected } = generateHooks({ brief });
  assert.ok(rejected.length > 0);
  assert.ok(rejected.every((entry) => /unsubstantiated/.test(entry.reason)));
  assert.ok(hooks.every((hook) => !/guarantees sleep/i.test(hook.text)));
});

test('quality gate approves compliant, disclosed content', () => {
  const result = scoreContentQuality({
    text: 'This contoured sleep mask blocks cabin light so you can rest on long flights. Contoured eye cups mean zero pressure on your eyes.',
    disclosure: 'As an affiliate, I may earn a commission from this link.',
    platform: 'tiktok'
  });
  assert.equal(result.verdict, 'approved');
  assert.ok(result.total >= 70);
  assert.ok(result.scores.disclosure === 100);
});

test('quality gate fails closed when social content lacks disclosure', () => {
  const result = scoreContentQuality({
    text: 'Great sleep mask for flights, blocks all the light.',
    disclosure: '',
    platform: 'tiktok'
  });
  assert.equal(result.verdict, 'revision_required');
  assert.equal(result.scores.disclosure, 0);
});

test('quality gate flags medical and earnings fabrication', () => {
  for (const text of ['This mask cures chronic insomnia forever.', 'Earn 50000 baht passive income overnight with this mask.']) {
    const result = scoreContentQuality({ text, disclosure: 'Affiliate link.', platform: 'tiktok' });
    assert.equal(result.verdict, 'revision_required');
    assert.ok(result.issues.some((issue) => /claim/i.test(issue)));
  }
});

test('spam-shaped content scores below the revision threshold', () => {
  const result = scoreContentQuality({
    text: 'BUY NOW!!! BEST SLEEP MASK EVER!!! LIMITED TIME!!! HURRY HURRY HURRY!!! #ad #sale #deal #buy #cheap',
    disclosure: 'Affiliate link.',
    platform: 'tiktok'
  });
  assert.equal(result.verdict, 'revision_required');
  assert.ok(result.issues.some((issue) => /spam/i.test(issue)));
});

test('prompt registry serves versioned definitions and refuses unknowns', () => {
  const brief = getPrompt('creative-brief', 'v1');
  assert.equal(brief.status, 'active');
  assert.ok(brief.inputSchema.includes('product'));
  assert.throws(() => getPrompt('viral-hack-machine', 'v9'), /unknown prompt/i);
});

import { generateScript, createStoryboard } from '../packages/ai-content/src/factory.js';

const SUBSTANTIATED_BRIEF = createCreativeBrief({
  ...BASE_BRIEF_INPUT,
  product: {
    ...PRODUCT,
    socialProof: [{ id: 'sp1', text: '4.8 stars from verified marketplace buyers', evidenceRef: 'ev1' }]
  }
});

test('prompt registry exposes versioned script and storyboard definitions', () => {
  assert.equal(getPrompt('script-generator', 'v1').status, 'active');
  assert.equal(getPrompt('storyboard', 'v1').owner, 'content-factory');
});

test('unknown script formats fail closed', () => {
  const brief = createCreativeBrief(BASE_BRIEF_INPUT);
  assert.throws(() => generateScript({ brief, format: 'cinematic-epic' }), /unsupported script format/i);
});

test('short-form scripts produce timestamped scenes inside the exact duration budget', () => {
  const brief = createCreativeBrief(BASE_BRIEF_INPUT);
  const script = generateScript({ brief, format: '15s-short' });
  assert.ok(script.scriptId.startsWith('scr_'));
  assert.equal(script.format, '15s-short');
  const last = script.scenes[script.scenes.length - 1];
  assert.equal(last.endSeconds, 15);
  assert.equal(script.scenes[0].startSeconds, 0);
  const labels = script.scenes.map((scene) => scene.label);
  assert.deepEqual(labels.slice(0, 2), ['hook', 'problem']);
  assert.equal(labels[labels.length - 1], 'disclosure');
});

test('canonical structure omits social proof unless substantiated, and records why', () => {
  const brief = createCreativeBrief(BASE_BRIEF_INPUT);
  const script = generateScript({ brief, format: '30s-short' });
  assert.equal(script.scenes.some((scene) => scene.label === 'social-proof'), false);
  assert.match(script.omittedSections[0], /social[- ]proof.*not substantiated/i);

  const proven = generateScript({ brief: SUBSTANTIATED_BRIEF, format: '30s-short' });
  const proofScene = proven.scenes.find((scene) => scene.label === 'social-proof');
  assert.ok(proofScene, 'substantiated social proof must appear');
  assert.match(proofScene.voiceover, /4\.8 stars/);
});

test('disclosure scene always carries the brief disclosure verbatim', () => {
  const brief = createCreativeBrief(BASE_BRIEF_INPUT);
  const script = generateScript({ brief, format: 'tutorial', toneOverride: undefined });
  const closing = script.scenes.find((scene) => scene.label === 'disclosure');
  assert.equal(closing.voiceover, brief.disclosure.text);
});

test('every voiced scene has a caption ready for subtitles', () => {
  const brief = SUBSTANTIATED_BRIEF;
  const script = generateScript({ brief, format: '60s-short' });
  for (const scene of script.scenes) {
    if (scene.voiceover) assert.ok(scene.caption.length > 0, `${scene.label} missing caption`);
  }
});

test('storyboards derive from scripts with visuals, timings and lineage', () => {
  const script = generateScript({ brief: SUBSTANTIATED_BRIEF, format: '15s-short' });
  const board = createStoryboard({ script, aspect: '9:16' });
  assert.equal(board.storyboardId.startsWith('sbd_'), true);
  assert.equal(board.scriptId, script.scriptId);
  assert.equal(board.aspect, '9:16');
  const totalDuration = board.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  assert.equal(totalDuration, 15);
  const closeUp = board.scenes.find((scene) => scene.visual.includes('close-up'));
  assert.ok(closeUp, 'expected a product close-up shot');
});

test('storyboards refuse scripts with broken timestamps', () => {
  const script = generateScript({ brief: SUBSTANTIATED_BRIEF, format: '15s-short' });
  const corrupted = { ...script, scenes: [{ ...script.scenes[1], startSeconds: 99, endSeconds: 3 }] };
  assert.throws(() => createStoryboard({ script: corrupted }), /timestamp/i);
});
