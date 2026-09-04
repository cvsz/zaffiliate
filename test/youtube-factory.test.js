import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildYouTubeContentPlan,
  evaluateYouTubePublishGate,
  scoreYouTubeTopic
} from '../packages/ai-content/src/youtube-factory.js';

test('topic scoring is deterministic and weighted', () => {
  const result = scoreYouTubeTopic({
    relevance: 100, authority: 80, freshness: 60, utility: 100,
    visualPotential: 50, conversionRelevance: 40, productionEfficiency: 100
  });
  assert.equal(result.score, 79);
});

test('content plan fails closed without evidence sources', () => {
  assert.throws(() => buildYouTubeContentPlan({
    topic: 'Build a local AI agent',
    pillar: 'ai-automation',
    sources: []
  }), /research source/);
});

test('content plan defaults to Thai and human approval', () => {
  const plan = buildYouTubeContentPlan({
    topic: 'Build a local AI agent',
    pillar: 'ai-automation',
    sources: [{ ref: 'internal-demo:agent-v1', note: 'Original ZEAZDEV build/demo evidence' }]
  });
  assert.equal(plan.language, 'th');
  assert.equal(plan.requiresHumanApproval, true);
  assert.equal(plan.cadence.longFormPerDay, 1);
  assert.equal(plan.cadence.shortsPerLongForm, 3);
});

test('publish gate blocks unverified or low-evidence content', () => {
  const result = evaluateYouTubePublishGate({
    sources: [{ ref: 'x' }],
    rightsEvidence: []
  });
  assert.equal(result.decision, 'DRAFT_ONLY');
  assert.ok(result.blockers.includes('human_approval_missing'));
  assert.ok(result.blockers.includes('youtube_provider_unverified'));
});

test('publish gate allows queue only after all gates pass', () => {
  const result = evaluateYouTubePublishGate({
    approvalRef: 'approval:123',
    originalityEvidence: 'original ZEAZDEV narration + screen recording',
    rightsEvidence: ['rights:original-screen-recording'],
    sources: [{ ref: 'internal-demo:123' }],
    providerVerified: true
  });
  assert.deepEqual(result, { decision: 'APPROVED_FOR_PROVIDER_QUEUE', blockers: [] });
});
