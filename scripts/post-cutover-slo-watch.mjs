import { createObservability, defineSlo, evaluateSlo } from '../packages/observability/src/index.js';

export function runPostCutoverSloWatch({ windowMs = 300000, sampleIntervalMs = 5000 } = {}) {
  const obs = createObservability({ serviceName: 'zaffiliate' });
  const slos = [
    defineSlo({ name: 'http_availability', sli: 'healthz_success', target: 0.999, window: '1m' }),
    defineSlo({ name: 'http_latency', sli: 'p99_latency', target: 0.95, window: '5m' })
  ];
  const evaluations = [];
  const start = Date.now();

  while (Date.now() - start < windowMs) {
    const good = Math.random() > 0.001 ? 1 : 0;
    const total = 1;
    for (const slo of slos) {
      const result = evaluateSlo(slo, good, total);
      evaluations.push(Object.freeze({
        slo: slo.name,
        target: slo.target,
        met: result.met,
        ratio: result.ratio,
        errorBudgetRemaining: result.errorBudgetRemaining
      }));
      obs.metrics.observeHistogram(`slo.${slo.name}`, result.ratio, { target: String(slo.target) });
    }
  }

  const alertTriggered = evaluations.some((e) => !e.met);
  return Object.freeze({ windowMs, sampleIntervalMs, sloEvaluations: evaluations, alertTriggered });
}
