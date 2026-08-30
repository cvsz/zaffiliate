BEGIN;

CREATE TABLE IF NOT EXISTS local_auth_users (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  UNIQUE (tenant_id, email),
  CONSTRAINT local_auth_users_membership_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES tenant_memberships(tenant_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT local_auth_users_email_normalized
    CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 320),
  CONSTRAINT local_auth_users_password_hash_present
    CHECK (length(password_hash) >= 32)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_sessions_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES local_auth_users(tenant_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT auth_sessions_expiry_order CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS auth_sessions_tenant_user_idx
  ON auth_sessions (tenant_id, user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS auth_sessions_active_idx
  ON auth_sessions (tenant_id, token_hash)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_recovery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('email_verify', 'password_reset')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_recovery_tokens_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES local_auth_users(tenant_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT auth_recovery_tokens_expiry_order CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS auth_recovery_tokens_user_purpose_idx
  ON auth_recovery_tokens (tenant_id, user_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_recovery_tokens_claim_idx
  ON auth_recovery_tokens (tenant_id, token_hash, purpose, expires_at)
  WHERE used_at IS NULL;

ALTER TABLE local_auth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_auth_users FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_recovery_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_recovery_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS local_auth_users_isolation ON local_auth_users;
CREATE POLICY local_auth_users_isolation ON local_auth_users
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS auth_sessions_isolation ON auth_sessions;
CREATE POLICY auth_sessions_isolation ON auth_sessions
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS auth_recovery_tokens_isolation ON auth_recovery_tokens;
CREATE POLICY auth_recovery_tokens_isolation ON auth_recovery_tokens
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

COMMIT;
