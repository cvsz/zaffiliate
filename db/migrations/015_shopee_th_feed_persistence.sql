BEGIN;

-- Shopee Thailand Affiliate durable persistence (SLICE 2).
--
-- Extends the canonical products/offers tables with Shopee TH import
-- provenance and adds an idempotent import-batch ledger. All additions are
-- additive and IF NOT EXISTS so the migration is safe to rerun.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_filename text,
  ADD COLUMN IF NOT EXISTS source_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS source_row_key text,
  ADD COLUMN IF NOT EXISTS shop_id text,
  ADD COLUMN IF NOT EXISTS shop_name text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS affiliate_url text,
  ADD COLUMN IF NOT EXISTS evidence_hash text,
  ADD COLUMN IF NOT EXISTS parser_version text,
  ADD COLUMN IF NOT EXISTS import_batch_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_filename text,
  ADD COLUMN IF NOT EXISTS source_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS source_row_key text,
  ADD COLUMN IF NOT EXISTS shop_id text,
  ADD COLUMN IF NOT EXISTS shop_name text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS affiliate_url text,
  ADD COLUMN IF NOT EXISTS evidence_hash text,
  ADD COLUMN IF NOT EXISTS parser_version text,
  ADD COLUMN IF NOT EXISTS import_batch_id text,
  ADD COLUMN IF NOT EXISTS commission_amount_minor_units bigint CHECK (commission_amount_minor_units IS NULL OR commission_amount_minor_units >= 0),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS products_tenant_batch_idx
  ON products (tenant_id, import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_tenant_source_row_idx
  ON products (tenant_id, source_row_key) WHERE source_row_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS offers_tenant_batch_idx
  ON offers (tenant_id, import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS offers_tenant_source_row_idx
  ON offers (tenant_id, source_row_key) WHERE source_row_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS shopee_th_import_batches (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id text NOT NULL,
  source_filename text,
  source_type text NOT NULL DEFAULT 'product_feed',
  parser_version text NOT NULL,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  evidence_hash text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('started','completed','failed','rolled_back')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, batch_id)
);
CREATE INDEX IF NOT EXISTS shopee_th_import_batches_tenant_started_idx
  ON shopee_th_import_batches (tenant_id, started_at DESC);

ALTER TABLE shopee_th_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopee_th_import_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopee_th_import_batches_isolation ON shopee_th_import_batches;
CREATE POLICY shopee_th_import_batches_isolation ON shopee_th_import_batches
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

COMMIT;