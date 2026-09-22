import { spawn } from 'node:child_process';

const files = [
  'apps/api/src/production-server.js',
  'apps/api/src/production-oauth-api.js',
  'apps/api/src/oauth-runtime-factory.js',
  'apps/api/src/auth-api.js',
  'apps/api/src/auth-service.js',
  'apps/api/src/server.js',
  'apps/api/src/business.js',
  'apps/api/src/business-async.js',
  'apps/api/src/campaign-api.js',
  'apps/api/src/conversion-api.js',
  'apps/api/src/features-api.js',
  'apps/api/src/publication-api.js',
  'apps/api/src/calendar-api.js',
  'apps/api/src/tiktok-api.js',
  'apps/web/server.js',
  'apps/web/public/views.js',
  'packages/contracts/src/index.js',
  'packages/contracts/src/tenancy.js',
  'packages/contracts/src/audit.js',
  'packages/contracts/src/grants.js',
  'packages/contracts/src/schema.js',
  'packages/security/src/passwords.js',
  'packages/security/src/secret-envelope.js',
  'packages/security/src/oauth.js',
  'packages/security/src/jwks.js',
  'packages/security/src/url-validation.js',
  'packages/security/src/rate-limit-api.js',
  'packages/security/src/rate-limit-redis.js',
  'packages/security/src/redaction.js',
  'packages/security/src/secrets.js',
  'packages/security/src/classification.js',
  'packages/security/src/security-events.js',
  'packages/db/src/client.js',
  'packages/db/src/migrator.js',
  'packages/db/src/cli.js',
  'packages/db/src/index.js',
  'packages/db/src/auth-repo.js',
  'packages/db/src/oauth-repo.js',
  'packages/db/src/oauth-login-repo.js',
  'packages/db/src/tiktok-accounts-repo.js',
  'packages/db/src/publication-jobs-repo.js',
  'packages/db/src/affiliate-core-repo.js',
  'packages/db/src/campaign-repo.js',
  'packages/db/src/shopee-th-repo.js',
  'packages/db/src/shopee-th-import-repo.js',
  'packages/db/src/analytics-repo.js',
  'packages/db/src/conversion-reconciliation-repo.js',
  'packages/db/src/outbox-repo.js',
  'packages/db/src/click-identity.js',
  'packages/db/src/automation-repo.js',
  'packages/db/src/calendar-repo.js',
  'packages/adapters/src/capabilities.js',
  'packages/adapters/src/shopee.js',
  'packages/adapters/src/lazada.js',
  'packages/adapters/src/publishing.js',
  'packages/adapters/src/line.js',
  'packages/adapters/src/rate-limit.js',
  'packages/adapters/src/policy-aware-registry.js',
  'packages/adapters/src/policy-registry.js',
  'packages/adapters/src/provider-registry.js',
  'packages/adapters/src/tiktok-publisher.js',
  'packages/adapters/src/transport-boundary.js',
  'packages/adapters/src/shopee-th-feed.js',
  'packages/adapters/src/shopee-th-normalizer.js',
  'packages/adapters/src/moneyprinter.js',
  'packages/adapters/src/social-providers.js',
  'packages/affiliate-core/src/domain.js',
  'packages/affiliate-core/src/runtime.js',
  'packages/affiliate-core/src/commerce.js',
  'packages/outreach/src/domain.js',
  'packages/outreach/src/runtime.js',
  'packages/workflow/src/domain.js',
  'packages/workflow/src/runtime.js',
  'packages/workflow/src/tiktok-publish-worker.js',
  'packages/identity-billing/src/domain.js',
  'packages/identity-billing/src/runtime.js',
  'packages/ai-content/src/domain.js',
  'packages/ai-content/src/runtime.js',
  'packages/ai-content/src/factory.js',
  'packages/ai-content/src/mock-provider.js',
  'packages/ai-content/src/tiktok-showcase.js',
  'packages/ai-content/src/video-factory.js',
  'packages/ai-content/src/youtube-factory.js',
  'packages/analytics/src/domain.js',
  'packages/analytics/src/events.js',
  'packages/analytics/src/runtime.js',
  'packages/analytics/src/warehouse.js',
  'packages/intelligence/src/decision-gate.js',
  'packages/intelligence/src/drift.js',
  'packages/intelligence/src/evaluation.js',
  'packages/intelligence/src/index.js',
  'packages/intelligence/src/monitoring.js',
  'packages/intelligence/src/optimization.js',
  'packages/intelligence/src/pipeline.js',
  'packages/intelligence/src/portfolio.js',
  'packages/intelligence/src/registry.js',
  'packages/intelligence/src/shadow.js',
  'packages/intelligence/src/stores.js',
  'packages/observability/src/index.js',
  'packages/storage/src/content-validation.js',
  'packages/storage/src/index.js',
  'packages/storage/src/s3.js',
  'packages/supabase/src/index.js',
  'packages/tiktok-shop/src/signing.js',
  'packages/tiktok-shop/src/auth.js',
  'packages/tiktok-shop/src/webhook.js',
  'packages/tiktok-shop/src/client.js',
  'packages/tiktok-shop/src/resilience.js',
  'packages/tiktok-shop/src/pagination.js',
  'packages/tiktok-shop/src/event-dedupe.js',
  'packages/tiktok-shop/src/resources.js',
  'packages/tiktok-developer/src/auth.js',
  'packages/tiktok-developer/src/token-service.js',
  'packages/tiktok-developer/src/index.js',
  'packages/events/src/index.js',
  'packages/events/src/node-redis-compat.js',
  'packages/events/src/outbox-dispatcher.js',
  'packages/events/src/redis-streams.js',
  'packages/automation/src/index.js',
  'packages/config/src/index.js',
  'packages/release/src/changelog.js',
  'packages/release/src/manifest.js',
  'packages/release/src/version.js',
  'packages/control-plane/src/navigation.js',
  'packages/trend/src/index.js',
  'scripts/check-syntax.mjs',
];

if (files.length === 0) {
  console.log('Syntax check: 0 files OK');
  process.exit(0);
}

const CONCURRENCY = 4;
const TIMEOUT_MS = 5000;
const failed = [];
let idx = 0;

async function worker() {
  while (idx < files.length) {
    const currentIdx = idx++;
    const f = files[currentIdx];
    try {
      const proc = spawn(process.execPath, ['--check', f], { stdio: 'ignore' });
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          failed.push(f);
          resolve();
        }, TIMEOUT_MS);
        proc.on('exit', (code) => {
          clearTimeout(timer);
          if (code !== 0) failed.push(f);
          resolve();
        });
        proc.on('error', () => {
          clearTimeout(timer);
          failed.push(f);
          resolve();
        });
      });
    } catch {
      failed.push(f);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => worker()));

if (failed.length) {
  console.error('Syntax check failures:\n' + failed.join('\n'));
  process.exit(1);
}
console.log(`Syntax check: ${files.length} files OK`);
