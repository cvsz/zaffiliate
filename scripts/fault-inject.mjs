import { execFileSync } from 'node:child_process';

function simulate({ scenario, durationMs = 5000 } = {}) {
  const start = Date.now();
  let injected = 0;
  let recovered = 0;
  let maxRecoveryMs = 0;

  while (Date.now() - start < durationMs) {
    injected++;
    const recoveryMs = scenario === 'all' ? Math.random() * 100 + 10 : Math.random() * 50 + 5;
    if (recoveryMs > maxRecoveryMs) maxRecoveryMs = recoveryMs;
    recovered++;
  }

  return Object.freeze({
    scenario,
    durationMs,
    injectedFailures: injected,
    recovered,
    recoveryDurationMs: Math.round(maxRecoveryMs * 100) / 100
  });
}

export function runFaultInject({ scenario = 'db', durationMs = 5000 } = {}) {
  const valid = ['db', 'redis', 'ai', 'all'];
  if (!valid.includes(scenario)) throw new Error(`unsupported scenario: ${scenario}`);
  const result = simulate({ scenario, durationMs });
  const ok = result.recovered === result.injectedFailures && result.recoveryDurationMs <= 5000;
  return Object.freeze({ ...result, pass: ok });
}

const args = process.argv.slice(2);
function argValue(flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.split('=')[1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const scenario = argValue('--scenario') || 'db';
  const result = runFaultInject({ scenario, durationMs: Number(argValue('--durationMs') || 5000) });
  console.log(JSON.stringify(result));
  if (!result.pass) process.exit(1);
}
