# Fault Injection Runbook

## Scenarios

- db: simulate database outage
- redis: simulate cache outage
- ai: simulate AI provider outage
- all: all scenarios sequentially

Command: `node scripts/fault-inject.mjs --scenario=db --durationMs=5000`

Evidence: stdout JSON with recovery stats.

Pass criteria: recovered == injectedFailures, recoveryDurationMs <= 5000.

## Stop-the-line

- recovery rate < 100%
- recovery time > 5s
- any unhandled exception during injection
