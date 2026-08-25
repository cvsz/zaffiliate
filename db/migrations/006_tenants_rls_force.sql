BEGIN;

-- GM-B5 rehearsal finding: tenants carried ENABLE but neither FORCE nor an
-- isolation policy, so any non-bypassrls owner session could read every row.
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_isolation ON tenants;
CREATE POLICY tenants_isolation ON tenants
USING (id = app_current_tenant_id())
WITH CHECK (id = app_current_tenant_id());

COMMIT;
