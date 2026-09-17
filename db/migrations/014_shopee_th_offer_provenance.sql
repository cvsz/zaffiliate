BEGIN;

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS source_filename text,
  ADD COLUMN IF NOT EXISTS source_row_number integer,
  ADD COLUMN IF NOT EXISTS source_evidence_sha256 text,
  ADD COLUMN IF NOT EXISTS observed_commission_minor_units bigint,
  ADD COLUMN IF NOT EXISTS product_url text,
  ADD COLUMN IF NOT EXISTS affiliate_url text;

ALTER TABLE offers
  DROP CONSTRAINT IF EXISTS offers_source_evidence_sha256_format,
  ADD CONSTRAINT offers_source_evidence_sha256_format
    CHECK (source_evidence_sha256 IS NULL OR source_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  DROP CONSTRAINT IF EXISTS offers_observed_commission_nonnegative,
  ADD CONSTRAINT offers_observed_commission_nonnegative
    CHECK (observed_commission_minor_units IS NULL OR observed_commission_minor_units >= 0),
  DROP CONSTRAINT IF EXISTS offers_product_url_https,
  ADD CONSTRAINT offers_product_url_https
    CHECK (product_url IS NULL OR product_url ~ '^https://'),
  DROP CONSTRAINT IF EXISTS offers_affiliate_url_https,
  ADD CONSTRAINT offers_affiliate_url_https
    CHECK (affiliate_url IS NULL OR affiliate_url ~ '^https://');

CREATE UNIQUE INDEX IF NOT EXISTS offers_tenant_source_evidence_uidx
  ON offers (tenant_id, source_evidence_sha256)
  WHERE source_evidence_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS offers_tenant_source_timestamp_idx
  ON offers (tenant_id, source_timestamp DESC)
  WHERE source_timestamp IS NOT NULL;

COMMIT;
