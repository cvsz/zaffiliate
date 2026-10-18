BEGIN;

-- P0 forward hardening: migration 006 created the tenants isolation policy and
-- FORCE flag but relied on an ENABLE state that was not established by 001.
-- FORCE does not imply ENABLE in PostgreSQL, so explicitly enable both here.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_isolation ON tenants;
CREATE POLICY tenants_isolation ON tenants
USING (id = app_current_tenant_id())
WITH CHECK (id = app_current_tenant_id());

COMMIT;
