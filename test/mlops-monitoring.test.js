import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriftDetector } from '../packages/intelligence/src/drift.js';
import { createModelMonitor } from '../packages/intelligence/src/monitoring.js';
import { MetricsRegistry } from '../packages/observability/src/index.js';

function baselineValues() {
  return [100, 102, 98, 101, 99, 100, 103, 97];
}

test('identical distributions report no drift', () => {
  const detector = createDriftDetector();
  detector.recordBaseline('historical_cvr', baselineValues());
  const report = detector.compare('historical_cvr', baselineValues());
  assert.equal(report.featureName, 'historical_cvr');
  assert.equal(report.driftScore, 0);
  assert.equal(report.severity, 'NONE');
  assert.equal(report.sampleSize.current, baselineValues().length);
});

test('large mean shifts escalate to ALERT above the alert ratio', () => {
  const detector = createDriftDetector({ warnRatio: 0.1, alertRatio: 0.25 });
  detector.recordBaseline('price_minor', baselineValues());
  const shifted = baselineValues().map((value) => value * 1.4);
  const report = detector.compare('price_minor', shifted);
  assert.equal(report.severity, 'ALERT');
  assert.ok(report.driftScore >= 0.25);
});

test('moderate shifts land in the WARN band', () => {
  const detector = createDriftDetector({ warnRatio: 0.1, alertRatio: 0.25 });
  detector.recordBaseline('price_minor', baselineValues());
  const shifted = baselineValues().map((value) => value * 1.15);
  assert.equal(detector.compare('price_minor', shifted).severity, 'WARN');
});

test('tiny current samples refuse to declare drift — insufficient evidence wins', () => {
  const detector = createDriftDetector({ minSamples: 5 });
  detector.recordBaseline('cvr', baselineValues());
  const report = detector.compare('cvr', [999]);
  assert.equal(report.severity, 'INSUFFICIENT_DATA');
  assert.equal(report.sampleSize.current, 1);
});

test('comparing an unregistered feature fails closed', () => {
  const detector = createDriftDetector();
  assert.throws(() => detector.compare('ghost_feature', [1, 2, 3]), /no baseline registered/i);
});

test('reports are frozen', () => {
  const detector = createDriftDetector();
  detector.recordBaseline('f', baselineValues());
  const report = detector.compare('f', baselineValues());
  assert.ok(Object.isFrozen(report));
  void 0;
});

function monitorHarness() {
  const metrics = new MetricsRegistry();
  const monitor = createModelMonitor({ metrics });
  return { metrics, monitor };
}

test('prediction outcomes increment observable counters', () => {
  const { metrics, monitor } = monitorHarness();
  monitor.recordPrediction({ model: 'opportunity-ranker', ok: true, latencyMs: 12 });
  monitor.recordPrediction({ model: 'opportunity-ranker', ok: true, latencyMs: 20 });
  monitor.recordPrediction({ model: 'opportunity-ranker', ok: false, latencyMs: 0 });
  const rendered = metrics.render();
  assert.match(rendered, /model_predictions_total\{.*model="opportunity-ranker".*\} 3/); // _total counts all attempts; errors tracked separately
  assert.match(rendered, /model_prediction_errors\{model="opportunity-ranker"\} 1/);
});

test('feature staleness and missingness are separately countable', () => {
  const { metrics, monitor } = monitorHarness();
  monitor.recordFeatureStale('product_cvr_7d');
  monitor.recordFeatureMissing('trend_score');
  monitor.recordFeatureStale('product_cvr_7d');
  const rendered = metrics.render();
  assert.match(rendered, /feature_stale_total\{feature="product_cvr_7d"\} 2/);
  assert.match(rendered, /feature_missing_total\{feature="trend_score"\} 1/);
});
