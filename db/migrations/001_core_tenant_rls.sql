BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','admin','operator','affiliate','viewer','service')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS products (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  external_product_id text NOT NULL,
  title text NOT NULL,
  currency text NOT NULL DEFAULT 'THB',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, platform, external_product_id)
);

CREATE TABLE IF NOT EXISTS offers (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sale_price numeric(20,6) NOT NULL CHECK (sale_price >= 0),
  commission_rate numeric(9,8) NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 1),
  cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS affiliate_links (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  url text NOT NULL CHECK (url ~ '^https://'),
  sub_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  request_id text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('allowed','denied')),
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION app_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers FORCE ROW LEVEL SECURITY;
ALTER TABLE affiliate_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_links FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_memberships_isolation ON tenant_memberships;
CREATE POLICY tenant_memberships_isolation ON tenant_memberships
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS products_isolation ON products;
CREATE POLICY products_isolation ON products
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS offers_isolation ON offers;
CREATE POLICY offers_isolation ON offers
USING (tenant_id = app_current_tenant_id())
WITH CHECK (
  tenant_id = app_current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM products p
    WHERE p.id = product_id AND p.tenant_id = app_current_tenant_id()
  )
);

DROP POLICY IF EXISTS affiliate_links_isolation ON affiliate_links;
CREATE POLICY affiliate_links_isolation ON affiliate_links
USING (tenant_id = app_current_tenant_id())
WITH CHECK (
  tenant_id = app_current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM offers o
    WHERE o.id = offer_id AND o.tenant_id = app_current_tenant_id()
  )
);

DROP POLICY IF EXISTS audit_events_isolation ON audit_events;
CREATE POLICY audit_events_isolation ON audit_events
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

REVOKE UPDATE, DELETE ON audit_events FROM PUBLIC;

COMMIT;
