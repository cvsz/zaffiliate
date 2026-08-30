BEGIN;

ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversions_status_check'
      AND conrelid = 'public.conversions'::regclass
  ) THEN
    ALTER TABLE conversions
      ADD CONSTRAINT conversions_status_check
      CHECK (status IN ('pending', 'confirmed', 'refunded', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS conversions_tenant_status_occurred_idx
  ON conversions (tenant_id, status, occurred_at DESC);

COMMIT;
