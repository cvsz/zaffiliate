BEGIN;

CREATE TABLE IF NOT EXISTS publication_jobs (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid,
  platform text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','waiting_approval','approved','scheduled','processing','published','partial','failed','cancelled')),
  idempotency_key text NOT NULL,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  next_retry_at timestamptz,
  provider_response jsonb,
  external_content_id text,
  failure_code text,
  failure_reason text,
  scheduled_for timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS publication_jobs_dispatch_idx
  ON publication_jobs (tenant_id, COALESCE(next_retry_at, scheduled_for, created_at))
  WHERE status IN ('scheduled','failed','partial');

ALTER TABLE publication_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE publication_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS publication_jobs_isolation ON publication_jobs;
CREATE POLICY publication_jobs_isolation ON publication_jobs
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

COMMIT;
