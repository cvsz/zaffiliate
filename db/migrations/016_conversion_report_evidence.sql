BEGIN;

ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS commission_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
