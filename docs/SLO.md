# Service Level Objectives

These are initial release-candidate targets. They become contractual production SLOs only after load/soak evidence validates that the platform can sustain them under the intended capacity model.

## API

- Availability target: 99.9% monthly for tenant API requests excluding declared maintenance.
- Latency target: 95% of synchronous non-provider API requests under 500 ms; 99% under 1.5 s.
- Error target: server-side 5xx rate below 0.5% over rolling 30 minutes under normal provider availability.

## Workflow engine

- Accepted-job durability: 99.99% of acknowledged jobs recoverable after worker restart.
- Duplicate external mutation target: zero; any duplicate is a stop-the-line incident.
- Approval bypass target: zero; any bypass is a critical incident.
- Queue age: 95% of non-scheduled jobs start within 60 seconds under normal capacity.

## Webhooks

- Verified webhook ingestion availability: 99.9% monthly.
- Replay/signature acceptance target: zero invalid/replayed webhook accepted.
- Processing: 95% of verified webhooks reach terminal durable processing state within 60 seconds, excluding provider downstream outage.

## Attribution and billing

- Financial/commission reconciliation: no unresolved material mismatch at release/cutover gates.
- Event deduplication: duplicate event side effects target zero.
- Late events remain processable and retain occurred-at/received-at provenance.

## AI plane

- AI provider failures must not expose provider credentials or cross tenants.
- Spend must not exceed per-request approved budget; budget bypass target zero.
- Mutating high-risk tool calls without required approval target zero.

## Error budgets

A monthly 99.9% availability target permits roughly 43 minutes of unavailability in a 30-day month. Release acceleration stops when the rolling error budget is exhausted or a zero-tolerance invariant is violated.

## Zero-tolerance invariants

Regardless of aggregate availability, the following trigger immediate stop-the-line handling:

- cross-tenant data exposure;
- authorization or approval bypass;
- active secret exposure;
- duplicate/lost financial or external provider mutation;
- irrecoverable backup failure;
- silent billing/commission corruption.
