# MoneyPrinterTurbo integration

MoneyPrinterTurbo is an internal video-generation provider for affiliate content. `zaffiliate` remains the control plane for tenant scope, approval, idempotency, offers, claims, publication jobs, analytics, and audit. MoneyPrinterTurbo receives only the approved creative payload and returns a task identifier.

## Runtime contract

Set server-only variables (never expose them to the browser):

```dotenv
MONEYPRINTER_URL=http://moneyprinter:8080
MONEYPRINTER_API_KEY=replace-with-generated-secret
```

Create the adapter:

```js
import { createMoneyPrinterAdapter } from '../packages/adapters/src/moneyprinter.js';

const video = createMoneyPrinterAdapter({
  baseUrl: process.env.MONEYPRINTER_URL,
  apiKey: process.env.MONEYPRINTER_API_KEY
});
```

Every generation requires `tenantId`, `approvalRef`, and `idempotencyKey`. The provider key is sent only as `x-api-key`; it is never included in the returned object or logs.

## VMware Ubuntu 26.04 deployment

Run MoneyPrinterTurbo on the same private Compose network as the API. Do not publish its port 8080, Redis, or PostgreSQL. Expose only the zaffiliate API through Cloudflare Tunnel. Recommended CPU-only baseline: one concurrent video task, 20 queued tasks, Whisper `small` with `int8`, and 720x1280 output for initial capacity testing.

Use the separately versioned `zeaz-video-stack-ubuntu26.04` deployment pack for the worker configuration. In a consolidated deployment, point `MONEYPRINTER_URL` at the internal service name and retain zaffiliate's existing Postgres/RLS and publication job tables as the system of record.

## Workflow

1. Content factory creates a product brief and hooks.
2. Compliance/decision gate verifies claims, offer freshness, and automation policy.
3. An operator approval produces `approvalRef`.
4. The adapter submits the generation task with an idempotency key.
5. A worker polls `getTask`, copies completed media to managed object storage, and associates it with `publication_jobs`.
6. Existing publishing adapters distribute the approved asset and analytics records its performance.

Generation does not imply approval to publish. Social publication remains behind the existing publication approval and provider boundaries.
