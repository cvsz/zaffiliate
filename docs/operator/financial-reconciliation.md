# Operator Handbook — Financial Reconciliation

Principle: ledger truth is append-oriented; corrections are new entries, never mutations. Original provider currency and minor units are preserved end to end.

## Sources of financial truth

1. **Webhook ingress** (`/webhooks/:platform`) — idempotent by event id + orderRef; duplicate deliveries collapse to a single effect (contract-tested).
2. **Canonical analytics envelopes** — `commission_reported` events with `payload.status` (`pending` excluded from net) and `amountMinorUnits`; refunds via `refund_reported`, reversals via `commission_reversed`.
3. **Runtime outbox** — `conversion.recorded` per accepted webhook delivery.

Golden invariant (master-spec §27, contract-tested): 1000 impressions / 100 clicks / 10 conversions / approved commission − reversal ⇒ CTR 10%, CVR 10%, Net = approved − reversal, EPC = Net/100.

## Reconciliation procedure

```sh
# commissions dataset: compares recorded vs attributed totals
node scripts/reconcile.mjs --dataset commissions   # exits non-zero on imbalance
```

- Balanced → record evidence (script output) and close.
- Imbalance → the delta is reported in minor units. Investigate in this order:
  1. Duplicate or missing webhook deliveries (check security events + provider dashboard).
  2. Out-of-order arrival (refund before order enrichment) — the system converges after the late event arrives; re-run reconcile after the next ingest window.
  3. Currency mixing — THB/USD source amounts must never be converted at rest; if you see mixed-currency totals, stop and escalate (that is a defect, not an ops task).

## Emergency correction

Direct SQL mutation is emergency-only: take a backup first (`scripts/backup.sh` path), perform the minimal append-style fix, then run the full restore rehearsal within the week. Document actor, reason, and diff in the audit log trail.
