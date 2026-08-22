BEGIN;

CREATE TABLE IF NOT EXISTS creator_contacts (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_creator_id text NOT NULL,
  platform text,
  email text,
  handle text,
  consent boolean NOT NULL DEFAULT false,
  suppressed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR handle IS NOT NULL),
  UNIQUE (tenant_id, external_creator_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS creator_contacts_tenant_email_uq
  ON creator_contacts (tenant_id, lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS outreach_outbox (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_contact_id uuid NOT NULL REFERENCES creator_contacts(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('email','manual_dm')),
  template_version text NOT NULL,
  subject text,
  body text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','cancelled','dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS outreach_outbox_dispatch_idx
  ON outreach_outbox (status, next_attempt_at, created_at)
  WHERE status IN ('pending','failed');

CREATE TABLE IF NOT EXISTS jobs (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_id text NOT NULL,
  idempotency_key text NOT NULL,
  fingerprint text NOT NULL,
  requires_approval boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','waiting_approval','succeeded','failed','cancelled','dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  result jsonb,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS jobs_dispatch_idx
  ON jobs (state, created_at)
  WHERE state IN ('queued','failed');

CREATE TABLE IF NOT EXISTS approvals (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  approver_id text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_id text NOT NULL,
  idempotency_key text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved','rejected','cancelled')),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, job_id, id)
);

CREATE INDEX IF NOT EXISTS approvals_job_idx ON approvals (tenant_id, job_id, decided_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_records (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('in_progress','succeeded','failed')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

ALTER TABLE creator_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE outreach_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS creator_contacts_isolation ON creator_contacts;
CREATE POLICY creator_contacts_isolation ON creator_contacts
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS outreach_outbox_isolation ON outreach_outbox;
CREATE POLICY outreach_outbox_isolation ON outreach_outbox
USING (tenant_id = app_current_tenant_id())
WITH CHECK (
  tenant_id = app_current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM creator_contacts c
    WHERE c.id = outreach_outbox.creator_contact_id
      AND c.tenant_id = app_current_tenant_id()
  )
);

DROP POLICY IF EXISTS jobs_isolation ON jobs;
CREATE POLICY jobs_isolation ON jobs
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS approvals_isolation ON approvals;
CREATE POLICY approvals_isolation ON approvals
USING (tenant_id = app_current_tenant_id())
WITH CHECK (
  tenant_id = app_current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.id = approvals.job_id
      AND j.tenant_id = app_current_tenant_id()
      AND j.actor_id = approvals.actor_id
      AND j.action = approvals.action
      AND j.resource_id = approvals.resource_id
      AND j.idempotency_key = approvals.idempotency_key
  )
);

DROP POLICY IF EXISTS idempotency_records_isolation ON idempotency_records;
CREATE POLICY idempotency_records_isolation ON idempotency_records
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

COMMIT;
