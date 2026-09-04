const PILLARS = Object.freeze(['ai-automation', 'software-developer', 'technology-business']);

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function scoreYouTubeTopic(input = {}) {
  const weights = Object.freeze({
    relevance: 0.25,
    authority: 0.20,
    freshness: 0.15,
    utility: 0.15,
    visualPotential: 0.10,
    conversionRelevance: 0.10,
    productionEfficiency: 0.05
  });
  const dimensions = {};
  let score = 0;
  for (const [key, weight] of Object.entries(weights)) {
    dimensions[key] = clamp(input[key]);
    score += dimensions[key] * weight;
  }
  return Object.freeze({ score: Math.round(score), dimensions: Object.freeze(dimensions) });
}

export function buildYouTubeContentPlan({
  topic,
  pillar,
  language = 'th',
  sources = [],
  scores = {},
  longFormPerDay = 1,
  shortsPerLongForm = 3
} = {}) {
  if (!String(topic ?? '').trim()) throw new Error('topic is required');
  if (!PILLARS.includes(pillar)) throw new Error('unsupported YouTube content pillar');
  if (!['th', 'en'].includes(language)) throw new Error('language must be th or en');
  if (!Array.isArray(sources) || sources.length === 0) throw new Error('at least one research source is required');
  const normalizedSources = sources.map((source) => {
    const ref = String(source?.ref ?? source?.url ?? '').trim();
    const note = String(source?.note ?? '').trim();
    if (!ref || !note) throw new Error('each source requires ref/url and evidence note');
    return Object.freeze({ ref, note });
  });
  const topicScore = scoreYouTubeTopic(scores);
  return Object.freeze({
    topic: String(topic).trim(),
    pillar,
    language,
    topicScore,
    sources: Object.freeze(normalizedSources),
    cadence: Object.freeze({
      longFormPerDay: Math.max(0, Math.min(2, Number(longFormPerDay) || 0)),
      shortsPerLongForm: Math.max(0, Math.min(5, Number(shortsPerLongForm) || 0))
    }),
    status: 'draft',
    requiresHumanApproval: true
  });
}

export function evaluateYouTubePublishGate(candidate = {}) {
  const blockers = [];
  if (!candidate.approvalRef) blockers.push('human_approval_missing');
  if (!candidate.originalityEvidence) blockers.push('originality_evidence_missing');
  if (!Array.isArray(candidate.rightsEvidence) || candidate.rightsEvidence.length === 0) blockers.push('rights_evidence_missing');
  if (!Array.isArray(candidate.sources) || candidate.sources.length === 0) blockers.push('research_sources_missing');
  if (candidate.hasUnsupportedClaims === true) blockers.push('unsupported_claims');
  if (candidate.hasSecrets === true) blockers.push('secret_material_detected');
  if (candidate.reusedOrNearDuplicate === true) blockers.push('reused_or_near_duplicate_content');
  if (candidate.misleadingMetadata === true) blockers.push('misleading_metadata');
  if (candidate.providerVerified !== true) blockers.push('youtube_provider_unverified');
  if (candidate.killSwitch === true) blockers.push('publishing_kill_switch_active');
  return Object.freeze({
    decision: blockers.length === 0 ? 'APPROVED_FOR_PROVIDER_QUEUE' : 'DRAFT_ONLY',
    blockers: Object.freeze(blockers)
  });
}

export const YouTubeFactoryPillars = PILLARS;
