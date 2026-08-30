BEGIN;

CREATE TABLE IF NOT EXISTS campaigns (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','paused','completed','cancelled')),
  objective text,
  budget_limit numeric(20,6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_name_present CHECK (length(btrim(name)) BETWEEN 1 AND 255),
  CONSTRAINT campaigns_objective_size CHECK (objective IS NULL OR length(objective) <= 500),
  CONSTRAINT campaigns_budget_nonnegative CHECK (budget_limit IS NULL OR budget_limit >= 0),
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS campaigns_tenant_status_created_idx
  ON campaigns (tenant_id, status, created_at DESC);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaigns_isolation ON campaigns;
CREATE POLICY campaigns_isolation ON campaigns
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE affiliate_links
  ADD COLUMN IF NOT EXISTS campaign_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_links_campaign_tenant_fk'
      AND conrelid = 'affiliate_links'::regclass
  ) THEN
    ALTER TABLE affiliate_links
      ADD CONSTRAINT affiliate_links_campaign_tenant_fk
      FOREIGN KEY (tenant_id, campaign_id)
      REFERENCES campaigns(tenant_id, id)
      ON DELETE SET NULL (campaign_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS affiliate_links_campaign_idx
  ON affiliate_links (tenant_id, campaign_id, created_at DESC)
  WHERE campaign_id IS NOT NULL;

-- Preserve the existing offer ownership check and additionally require any
-- campaign association to resolve inside the active tenant.
DROP POLICY IF EXISTS affiliate_links_isolation ON affiliate_links;
CREATE POLICY affiliate_links_isolation ON affiliate_links
USING (tenant_id = app_current_tenant_id())
WITH CHECK (
  tenant_id = app_current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM offers o
    WHERE o.id = offer_id
      AND o.tenant_id = app_current_tenant_id()
  )
  AND (
    campaign_id IS NULL
    OR EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = campaign_id
        AND c.tenant_id = app_current_tenant_id()
    )
  )
);

COMMIT;
