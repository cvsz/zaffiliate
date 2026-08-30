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

CREATE TABLE IF NOT EXISTS oauth_pending_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id text NOT NULL,
  provider text NOT NULL,
  issuer text NOT NULL,
  state_hash text NOT NULL UNIQUE,
  code_verifier_ciphertext text NOT NULL,
  subject_hint text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_pending_authorizations_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES local_auth_users(tenant_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT oauth_pending_authorizations_provider_safe
    CHECK (provider ~ '^[a-z0-9_-]{2,32}$'),
  CONSTRAINT oauth_pending_authorizations_issuer_present
    CHECK (length(btrim(issuer)) BETWEEN 1 AND 2048),
  CONSTRAINT oauth_pending_authorizations_state_hash_shape
    CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT oauth_pending_authorizations_verifier_present
    CHECK (length(code_verifier_ciphertext) >= 32),
  CONSTRAINT oauth_pending_authorizations_expiry_order
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS oauth_pending_authorizations_claim_idx
  ON oauth_pending_authorizations (tenant_id, state_hash, expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS oauth_pending_authorizations_user_idx
  ON oauth_pending_authorizations (tenant_id, user_id, provider, created_at DESC);

CREATE TABLE IF NOT EXISTS oauth_provider_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id text NOT NULL,
  provider text NOT NULL,
  issuer text NOT NULL,
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text,
  token_type text,
  scope text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_provider_tokens_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES local_auth_users(tenant_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT oauth_provider_tokens_provider_safe
    CHECK (provider ~ '^[a-z0-9_-]{2,32}$'),
  CONSTRAINT oauth_provider_tokens_issuer_present
    CHECK (length(btrim(issuer)) BETWEEN 1 AND 2048),
  CONSTRAINT oauth_provider_tokens_access_present
    CHECK (length(access_token_ciphertext) >= 32),
  UNIQUE (tenant_id, user_id, provider)
);

CREATE INDEX IF NOT EXISTS oauth_provider_tokens_user_idx
  ON oauth_provider_tokens (tenant_id, user_id, updated_at DESC);

ALTER TABLE auth_user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_user_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_pending_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_pending_authorizations FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_provider_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_provider_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_user_identities_isolation ON auth_user_identities;
CREATE POLICY auth_user_identities_isolation ON auth_user_identities
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS oauth_pending_authorizations_isolation ON oauth_pending_authorizations;
CREATE POLICY oauth_pending_authorizations_isolation ON oauth_pending_authorizations
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS oauth_provider_tokens_isolation ON oauth_provider_tokens;
CREATE POLICY oauth_provider_tokens_isolation ON oauth_provider_tokens
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

COMMIT;
