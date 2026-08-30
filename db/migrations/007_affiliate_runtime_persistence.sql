BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS runtime_id text;
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_runtime_id_uq
  ON products (tenant_id, runtime_id) WHERE runtime_id IS NOT NULL;

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS runtime_id text,
  ADD COLUMN IF NOT EXISTS price_minor_units bigint CHECK (price_minor_units IS NULL OR price_minor_units >= 0),
  ADD COLUMN IF NOT EXISTS captured_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS offers_tenant_runtime_id_uq
  ON offers (tenant_id, runtime_id) WHERE runtime_id IS NOT NULL;

ALTER TABLE affiliate_links
  ADD COLUMN IF NOT EXISTS runtime_id text,
  ADD COLUMN IF NOT EXISTS destination_url text,
  ADD COLUMN IF NOT EXISTS deep_link_url text,
  ADD COLUMN IF NOT EXISTS sub_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_links_tenant_runtime_id_uq
  ON affiliate_links (tenant_id, runtime_id) WHERE runtime_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_links_tenant_slug_uq
  ON affiliate_links (tenant_id, slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS affiliate_links_sub_ids_gin
  ON affiliate_links USING gin (sub_ids);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_id text NOT NULL,
  affiliate_link_id uuid NOT NULL REFERENCES affiliate_links(id) ON DELETE RESTRICT,
  touchpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, runtime_id)
);
CREATE INDEX IF NOT EXISTS affiliate_clicks_link_time_idx
  ON affiliate_clicks (tenant_id, affiliate_link_id, recorded_at DESC);

ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS runtime_id text,
  ADD COLUMN IF NOT EXISTS revenue_minor_units bigint CHECK (revenue_minor_units IS NULL OR revenue_minor_units >= 0),
  ADD COLUMN IF NOT EXISTS gross_commission_minor_units bigint CHECK (gross_commission_minor_units IS NULL OR gross_commission_minor_units >= 0),
  ADD COLUMN IF NOT EXISTS commission_rate numeric(9,8) CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 1));
CREATE UNIQUE INDEX IF NOT EXISTS conversions_tenant_runtime_id_uq
  ON conversions (tenant_id, runtime_id) WHERE runtime_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS affiliate_margins (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_id text NOT NULL,
  conversion_id uuid NOT NULL REFERENCES conversions(id) ON DELETE RESTRICT,
  gross_commission_minor_units bigint NOT NULL CHECK (gross_commission_minor_units >= 0),
  cost_minor_units bigint NOT NULL CHECK (cost_minor_units >= 0),
  net_margin_minor_units bigint NOT NULL,
  currency text NOT NULL,
  computed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, runtime_id)
);
CREATE INDEX IF NOT EXISTS affiliate_margins_conversion_idx
  ON affiliate_margins (tenant_id, conversion_id, computed_at DESC);

CREATE TABLE IF NOT EXISTS affiliate_domain_outbox (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  dispatched_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_id)
);
CREATE INDEX IF NOT EXISTS affiliate_domain_outbox_dispatch_idx
  ON affiliate_domain_outbox (available_at, created_at)
  WHERE dispatched_at IS NULL;

ALTER TABLE affiliate_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_clicks FORCE ROW LEVEL SECURITY;
ALTER TABLE affiliate_margins ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_margins FORCE ROW LEVEL SECURITY;
ALTER TABLE affiliate_domain_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_domain_outbox FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS affiliate_clicks_isolation ON affiliate_clicks;
CREATE POLICY affiliate_clicks_isolation ON affiliate_clicks
USING (tenant_id = app_current_tenant_id())
WITH CHECK (
  tenant_id = app_current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM affiliate_links l
    WHERE l.id = affiliate_clicks.affiliate_link_id
      AND l.tenant_id = app_current_tenant_id()
  )
);

DROP POLICY IF EXISTS affiliate_margins_isolation ON affiliate_margins;
CREATE POLICY affiliate_margins_isolation ON affiliate_margins
USING (tenant_id = app_current_tenant_id())
WITH CHECK (
  tenant_id = app_current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM conversions c
    WHERE c.id = affiliate_margins.conversion_id
      AND c.tenant_id = app_current_tenant_id()
  )
);

DROP POLICY IF EXISTS affiliate_domain_outbox_isolation ON affiliate_domain_outbox;
CREATE POLICY affiliate_domain_outbox_isolation ON affiliate_domain_outbox
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

COMMIT;
