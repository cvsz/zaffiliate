import http from 'node:http';

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)];
}

export function runLoadTest({ target = 'http://127.0.0.1:8080', concurrency = 10, durationMs = 5000 } = {}) {
  const url = new URL(target);
  const latencies = [];
  let errors = 0;
  let requests = 0;
  const start = Date.now();
  let active = 0;
  let finished = false;
  let timer = null;

  function request() {
    if (finished) return;
    if (Date.now() - start >= durationMs && active === 0) {
      clearTimeout(timer);
      return;
    }
    active++;
    const t0 = Date.now();
    http.get(`${url.origin}/healthz`, (res) => {
      const dt = Date.now() - t0;
      requests++;
      latencies.push(dt);
      if (res.statusCode !== 200) errors++;
      active--;
      if (!finished) request();
    }).on('error', () => {
      requests++;
      errors++;
      active--;
      if (!finished) request();
    });
  }

  for (let i = 0; i < concurrency; i++) request();

  return new Promise((resolve) => {
    timer = setTimeout(() => {
      finished = true;
      const sorted = latencies.slice().sort((a, b) => a - b);
      const p50 = percentile(sorted, 0.5);
      const p95 = percentile(sorted, 0.95);
      const p99 = percentile(sorted, 0.99);
      const min = sorted[0] || 0;
      const max = sorted[sorted.length - 1] || 0;
      const errorRate = requests ? errors / requests : 0;
      resolve(Object.freeze({
        target,
        concurrency,
        durationMs,
        requests,
        errors,
        errorRate,
        p50,
        p95,
        p99,
        min,
        max
      }));
    }, durationMs + 200);
  });
}
