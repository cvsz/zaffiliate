\set ON_ERROR_STOP on

BEGIN;

INSERT INTO tenants (id, slug, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'tenant-a', 'Tenant A'),
  ('00000000-0000-0000-0000-000000000002', 'tenant-b', 'Tenant B');

SET LOCAL ROLE zaffiliate_app_test;
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001';

INSERT INTO products (tenant_id, id, platform, external_product_id, title, currency)
VALUES ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'tiktok', 'ext-a', 'A', 'THB');

DO $$
BEGIN
  BEGIN
    INSERT INTO products (tenant_id, id, platform, external_product_id, title, currency)
    VALUES ('00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'tiktok', 'ext-b', 'B', 'THB');
    RAISE EXCEPTION 'expected cross-tenant insert to be rejected';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

DO $$
DECLARE
  visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM products;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected 1 visible product, got %', visible_count;
  END IF;
END $$;

SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000002';

DO $$
DECLARE
  visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM products;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'tenant B must not see tenant A product, got % rows', visible_count;
  END IF;
END $$;

RESET ROLE;
ROLLBACK;
