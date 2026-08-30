\set ON_ERROR_STOP on

BEGIN;

INSERT INTO tenants (id, slug, name) VALUES
  ('10000000-0000-4000-8000-000000000001', 'campaign-a', 'Campaign A'),
  ('20000000-0000-4000-8000-000000000002', 'campaign-b', 'Campaign B')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  enabled boolean;
  forced boolean;
BEGIN
  SELECT c.relrowsecurity, c.relforcerowsecurity
    INTO enabled, forced
  FROM pg_class c
  WHERE c.oid = 'campaigns'::regclass;
  IF enabled IS DISTINCT FROM true OR forced IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'campaigns must have ENABLE + FORCE RLS';
  END IF;
END $$;

SET ROLE zaffiliate_app_test;
SELECT set_config('app.tenant_id', '10000000-0000-4000-8000-000000000001', true);

INSERT INTO campaigns (tenant_id, id, name, status, objective, budget_limit)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'Tenant A launch',
  'draft',
  'prove RLS isolation',
  1000.00
);

DO $$
BEGIN
  IF (SELECT count(*) FROM campaigns) <> 1 THEN
    RAISE EXCEPTION 'tenant A should see exactly its own campaign';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO campaigns (tenant_id, id, name)
    VALUES (
      '20000000-0000-4000-8000-000000000002',
      '22222222-2222-4222-8222-222222222222',
      'Cross tenant denied'
    );
    RAISE EXCEPTION 'cross-tenant campaign insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;

INSERT INTO campaigns (tenant_id, id, name, status)
VALUES (
  '20000000-0000-4000-8000-000000000002',
  '22222222-2222-4222-8222-222222222222',
  'Tenant B launch',
  'active'
);

SET ROLE zaffiliate_app_test;
SELECT set_config('app.tenant_id', '10000000-0000-4000-8000-000000000001', true);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM campaigns
    WHERE id = '22222222-2222-4222-8222-222222222222'
  ) THEN
    RAISE EXCEPTION 'tenant B campaign leaked into tenant A context';
  END IF;
END $$;

SELECT set_config('app.tenant_id', '20000000-0000-4000-8000-000000000002', true);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM campaigns
    WHERE id = '22222222-2222-4222-8222-222222222222'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'tenant B cannot read its own campaign';
  END IF;
END $$;

RESET ROLE;
ROLLBACK;
