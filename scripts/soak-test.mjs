import http from 'node:http';

export function runSoakTest({ target = 'http://127.0.0.1:8080', durationMs = 30000, sampleIntervalMs = 1000 } = {}) {
  const url = new URL(target);
  const samples = [];
  const start = Date.now();
  let baselineRss = 0;
  let peakRss = 0;
  let timer = null;
  let interval = null;

  function sample() {
    return new Promise((resolve) => {
      const t0 = Date.now();
      http.get(`${url.origin}/healthz`, (res) => {
        const lag = Date.now() - t0;
        const mem = process.memoryUsage().rss;
        if (mem > peakRss) peakRss = mem;
        samples.push({ at: Date.now() - start, status: res.statusCode, latencyMs: lag, rss: mem });
        resolve();
      }).on('error', () => {
        samples.push({ at: Date.now() - start, status: 0, latencyMs: 0, rss: process.memoryUsage().rss });
        resolve();
      });
    });
  }

  baselineRss = process.memoryUsage().rss;

  return new Promise((resolve) => {
    interval = setInterval(async () => {
      await sample();
      if (Date.now() - start >= durationMs) {
        clearInterval(interval);
        clearTimeout(timer);
        const successes = samples.filter((s) => s.status === 200).length;
        const successRate = samples.length ? successes / samples.length : 0;
        const memoryGrowth = baselineRss > 0 ? (peakRss - baselineRss) / baselineRss : 0;
        const lags = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
        const p95 = lags.length ? lags[Math.ceil(lags.length * 0.95) - 1] || 0 : 0;
        resolve(Object.freeze({
          target,
          durationMs,
          sampleIntervalMs,
          samples: samples.length,
          successRate,
          memoryGrowth,
          eventLoopLagP95: p95,
          baselineRss,
          peakRss
        }));
      }
    }, sampleIntervalMs);

    timer = setTimeout(() => {
      clearInterval(interval);
      const successes = samples.filter((s) => s.status === 200).length;
      const successRate = samples.length ? successes / samples.length : 0;
      const memoryGrowth = baselineRss > 0 ? (peakRss - baselineRss) / baselineRss : 0;
      const lags = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
      const p95 = lags.length ? lags[Math.ceil(lags.length * 0.95) - 1] || 0 : 0;
      resolve(Object.freeze({
        target,
        durationMs,
        sampleIntervalMs,
        samples: samples.length,
        successRate,
        memoryGrowth,
        eventLoopLagP95: p95,
        baselineRss,
        peakRss
      }));
    }, durationMs + sampleIntervalMs);
  });
}
