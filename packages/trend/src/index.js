const ALLOWED_SOURCES = new Set(['tiktok','shopee','lazada','youtube','tiktok-shop','manual']);
const ALLOWED_CATEGORIES = new Set(['fashion','beauty','electronics','home','food','health','general']);

function required(value, name) {
  const t = String(value ?? '').trim();
  if (!t) throw new Error(`${name} is required`);
  return t;
}
function normalizeCategory(value) {
  const t = String(value ?? 'general').trim().toLowerCase();
  return ALLOWED_CATEGORIES.has(t) ? t : 'general';
}

export function createTrendStore({ now = () => Date.now() } = {}) {
  const byTenant = new Map();

  function tenantBucket(tenantId) {
    const id = required(tenantId, 'tenantId').toLowerCase();
    if (!byTenant.has(id)) byTenant.set(id, []);
    return byTenant.get(id);
  }

  function ingest({ tenantId, keyword, category = 'general', source = 'tiktok', score = 50, volume = 0, evidenceRef = null } = {}) {
    const tid = required(tenantId, 'tenantId').toLowerCase();
    const kw = required(keyword, 'keyword').toLowerCase();
    if (kw.length > 120) throw new Error('keyword must be at most 120 characters');
    const normalizedCategory = normalizeCategory(category);
    const normalizedSource = String(source ?? 'tiktok').trim().toLowerCase();
    if (!ALLOWED_SOURCES.has(normalizedSource)) throw new Error(`unsupported trend source: ${source}`);
    const normalizedScore = Number(score);
    if (!Number.isFinite(normalizedScore) || normalizedScore < 0 || normalizedScore > 100) throw new Error('score must be 0..100');
    const normalizedVolume = Math.max(0, Number(volume) || 0);
    const ts = new Date(now()).toISOString();
    const entry = Object.freeze({
      tenantId: tid,
      keyword: kw,
      category: normalizedCategory,
      source: normalizedSource,
      score: normalizedScore,
      volume: normalizedVolume,
      evidenceRef: evidenceRef ? String(evidenceRef) : null,
      ingestedAt: ts
    });
    const bucket = tenantBucket(tid);
    const existingIdx = bucket.findIndex((e) => e.keyword === kw && e.source === normalizedSource);
    if (existingIdx >= 0) bucket[existingIdx] = entry; else bucket.push(entry);
    return entry;
  }

  function listRecent({ tenantId, category = null, limit = 50 } = {}) {
    const bucket = tenantBucket(tenantId);
    let filtered = bucket;
    if (category) filtered = bucket.filter((e) => e.category === category.toLowerCase());
    return Object.freeze([...filtered].sort((a, b) => b.score - a.score || b.volume - a.volume).slice(0, Math.min(Math.max(Number(limit) || 50, 1), 200)));
  }

  function scoreOpportunity({ tenantId, productId, trendKeyword, baseScore = 50 } = {}) {
    const tid = required(tenantId, 'tenantId').toLowerCase();
    const pid = required(productId, 'productId');
    const kw = required(trendKeyword, 'trendKeyword').toLowerCase();
    const bucket = tenantBucket(tid);
    const trend = bucket.find((e) => e.keyword === kw);
    if (!trend) return Object.freeze({ tenantId: tid, productId: pid, trendKeyword: kw, score: Math.max(0, Math.min(100, Number(baseScore) || 50)), confidence: 'LOW', reasons: ['no matching trend found — base score only'] });
    // Simple deterministic scoring: 60% trend score + 30% baseScore + 10% volume normalized, capped
    const volumeNorm = Math.min(10, Math.log10(trend.volume + 1) * 2);
    const composite = Math.round(trend.score * 0.6 + (Number(baseScore) || 50) * 0.3 + volumeNorm);
    const capped = Math.max(0, Math.min(100, composite));
    let confidence = 'LOW';
    if (capped >= 80 && trend.volume >= 1000) confidence = 'HIGH';
    else if (capped >= 60) confidence = 'MEDIUM';
    const reasons = Object.freeze([
      `trend ${trend.keyword} score ${trend.score} source ${trend.source}`,
      `volume ${trend.volume}`,
      `baseScore ${baseScore}`
    ]);
    return Object.freeze({ tenantId: tid, productId: pid, trendKeyword: kw, score: capped, confidence, reasons, trend, scoredAt: new Date(now()).toISOString() });
  }

  return Object.freeze({ ingest, listRecent, scoreOpportunity });
}
