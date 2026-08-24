function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function createDriftDetector({ warnRatio = 0.1, alertRatio = 0.25, minSamples = 5 } = {}) {
  const baselines = new Map();

  function recordBaseline(featureName, values) {
    if (!Array.isArray(values) || values.length === 0) throw new Error('baseline values must be a non-empty array');
    const numeric = values.map(Number);
    if (numeric.some((value) => !Number.isFinite(value))) throw new Error('baseline values must be finite numbers');
    baselines.set(String(featureName).trim(), { mean: mean(numeric), sampleSize: numeric.length });
  }

  function compare(featureName, currentValues) {
    const name = String(featureName).trim();
    const baseline = baselines.get(name);
    if (!baseline) throw new Error(`no baseline registered for feature: ${featureName}`);
    const numeric = (currentValues ?? []).map(Number);
    const usable = numeric.filter((value) => Number.isFinite(value));
    const currentMean = mean(usable);

    if (usable.length < minSamples || baseline.mean === null || currentMean === null) {
      return frozen({
        featureName: name,
        driftScore: null,
        severity: 'INSUFFICIENT_DATA',
        baselineMean: baseline.mean,
        currentMean,
        sampleSize: { baseline: baseline.sampleSize, current: usable.length },
        reason: `requires at least ${minSamples} finite current samples`
      });
    }

    const driftScore = baseline.mean === 0
      ? (currentMean === 0 ? 0 : 1)
      : Math.round((Math.abs(currentMean - baseline.mean) / Math.abs(baseline.mean)) * 10000) / 10000;
    const severity = driftScore >= alertRatio ? 'ALERT' : driftScore >= warnRatio ? 'WARN' : 'NONE';

    return frozen({
      featureName: name,
      driftScore,
      severity,
      baselineMean: baseline.mean,
      currentMean,
      sampleSize: { baseline: baseline.sampleSize, current: usable.length }
    });
  }

  function frozen(payload) {
    return Object.freeze({
      ...payload,
      sampleSize: Object.freeze({ ...payload.sampleSize })
    });
  }

  return Object.freeze({ recordBaseline, compare });
}
