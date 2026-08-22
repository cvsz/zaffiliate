# Load & Soak Test Runbook

## Load test

Command: `node scripts/load-test.mjs --concurrency=10 --durationMs=5000 --target=http://127.0.0.1:8080`

Evidence: `dist/load-test-evidence.json`

Pass criteria: p99 <= 500ms, errorRate <= 1%.

## Soak test

Command: `node scripts/soak-test.mjs --durationMs=30000 --sampleIntervalMs=1000 --target=http://127.0.0.1:8080`

Evidence: `dist/soak-test-evidence.json`

Pass criteria: successRate >= 99.9%, memoryGrowth <= 20%.

## Stop-the-line

- p99 > 500ms or errorRate > 1%
- successRate < 99.9%
- memory RSS growth > 20% from baseline
