-- Commerce Source Separation (SLICE 3).
--
-- Establishes the boundary between commerce sources and Affiliate Core.
-- Canonical products are source-neutral. Source relationships are tracked
-- separately via product_sources. Provider-specific metadata is stored
-- in product_source_metadata, never embedded in canonical entities.
--
-- This migration is additive and safe to run on existing data. Existing
-- Shopee-specific columns on products/offers remain for backward compatibility
-- and will be migrated to product_source_metadata by a future migration.

BEGIN;

CREATE TABLE IF NOT EXISTS product_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_product_id text NOT NULL,
  external_offer_id text,
  sync_cursor text,
  sync_status text NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  last_synced_at timestamptz,
  last_sync_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id, provider)
);

CREATE INDEX IF NOT EXISTS product_sources_provider_idx
  ON product_sources (provider, external_product_id);

CREATE INDEX IF NOT EXISTS product_sources_sync_idx
  ON product_sources (sync_status, last_synced_at);

CREATE TABLE IF NOT EXISTS product_source_metadata (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_source_id uuid NOT NULL REFERENCES product_sources(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_source_id, key)
);

CREATE TABLE IF NOT EXISTS sync_jobs (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  job_type text NOT NULL CHECK (job_type IN ('product_sync', 'offer_sync', 'inventory_sync', 'price_sync', 'order_sync')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  cursor text,
  items_processed integer NOT NULL DEFAULT 0 CHECK (items_processed >= 0),
  items_created integer NOT NULL DEFAULT 0 CHECK (items_created >= 0),
  items_updated integer NOT NULL DEFAULT 0 CHECK (items_updated >= 0),
  items_skipped integer NOT NULL DEFAULT 0 CHECK (items_skipped >= 0),
  items_failed integer NOT NULL DEFAULT 0 CHECK (items_failed >= 0),
  attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  next_retry_at timestamptz,
  last_error text,
  correlation_id text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, job_type, cursor)
);

CREATE INDEX IF NOT EXISTS sync_jobs_status_idx
  ON sync_jobs (status, next_retry_at);

CREATE INDEX IF NOT EXISTS sync_jobs_provider_idx
  ON sync_jobs (provider, status);

ALTER TABLE product_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE product_source_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_source_metadata FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_sources_isolation ON product_sources;
CREATE POLICY product_sources_isolation ON product_sources
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS product_source_metadata_isolation ON product_source_metadata;
CREATE POLICY product_source_metadata_isolation ON product_source_metadata
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS sync_jobs_isolation ON sync_jobs;
CREATE POLICY sync_jobs_isolation ON sync_jobs
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

COMMIT;
