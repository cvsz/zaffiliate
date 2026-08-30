BEGIN;

CREATE TABLE IF NOT EXISTS auth_user_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id text NOT NULL,
  issuer text NOT NULL,
  issuer_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_user_identities_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES local_auth_users(tenant_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT auth_user_identities_issuer_present CHECK (length(btrim(issuer)) BETWEEN 1 AND 2048),
  CONSTRAINT auth_user_identities_subject_present CHECK (length(btrim(issuer_subject)) BETWEEN 1 AND 1024),
  UNIQUE (issuer, issuer_subject),
  UNIQUE (tenant_id, user_id, issuer, issuer_subject)
);

CREATE INDEX IF NOT EXISTS auth_user_identities_user_idx
  ON auth_user_identities (tenant_id, user_id, created_at DESC);

ALTER TABLE auth_user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_user_identities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_user_identities_isolation ON auth_user_identities;
CREATE POLICY auth_user_identities_isolation ON auth_user_identities
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

COMMIT;
