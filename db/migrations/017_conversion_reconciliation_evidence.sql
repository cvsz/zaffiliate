ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS reconciliation_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN conversions.reconciliation_evidence IS
  'Source-observed reconciliation provenance supplied by affiliate reports; never inferred from current offer state.';
