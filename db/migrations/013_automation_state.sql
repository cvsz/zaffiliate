BEGIN;

CREATE TABLE IF NOT EXISTS automation_policies (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  policy_version text NOT NULL DEFAULT 'v1',
  mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual','assisted','draft_only','approval_required','auto_safe','autonomous')),
  allow_auto_publish boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id)
);

CREATE TABLE IF NOT EXISTS automation_kill_switches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('global','org','provider','account','campaign','workflow')),
  target_id text,
  active boolean NOT NULL DEFAULT true,
  reason text NOT NULL DEFAULT '',
  actor_id text,
  set_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz
);
CREATE INDEX IF NOT EXISTS automation_kill_switches_tenant_active_idx
  ON automation_kill_switches (tenant_id, active) WHERE active = true;

ALTER TABLE automation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE automation_kill_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_kill_switches FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_policies_isolation ON automation_policies;
CREATE POLICY automation_policies_isolation ON automation_policies
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS automation_kill_switches_isolation ON automation_kill_switches;
CREATE POLICY automation_kill_switches_isolation ON automation_kill_switches
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

COMMIT;
