export function createModelMonitor({ metrics } = {}) {
  if (!metrics || typeof metrics.inc !== 'function' || typeof metrics.render !== 'function') {
    throw new TypeError('metrics registry with inc() and render() is required');
  }

  function recordPrediction({ model, ok, latencyMs = 0 }) {
    const name = requireText(model, 'model');
    metrics.inc('model_predictions_total', { model: name });
    if (ok === false) {
      metrics.inc('model_prediction_errors', { model: name });
    }
    if (Number.isFinite(Number(latencyMs)) && Number(latencyMs) > 0) {
      metrics.set('model_inference_latency_ms', { model: name }, Number(latencyMs));
    }
  }

  function recordFeatureStale(featureName) {
    metrics.inc('feature_stale_total', { feature: requireText(featureName, 'featureName') });
  }

  function recordFeatureMissing(featureName) {
    metrics.inc('feature_missing_total', { feature: requireText(featureName, 'featureName') });
  }

  return Object.freeze({ recordPrediction, recordFeatureStale, recordFeatureMissing });
}

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}
