BEGIN;

CREATE TABLE IF NOT EXISTS tiktok_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  open_id text NOT NULL,
  union_id text,
  username text,
  display_name text,
  avatar_url text,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'expired', 'revoked', 'reauth_required', 'error')),
  scope text,
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  refresh_expires_at timestamptz,
  last_sync_at timestamptz,
  last_successful_api_call_at timestamptz,
  last_error text,
  token_version integer NOT NULL DEFAULT 1 CHECK (token_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tiktok_accounts_open_id_unique UNIQUE (open_id),
  CONSTRAINT tiktok_accounts_tenant_user_open_id UNIQUE (tenant_id, user_id, open_id)
);

CREATE INDEX IF NOT EXISTS tiktok_accounts_tenant_idx
  ON tiktok_accounts (tenant_id, user_id, status);

CREATE INDEX IF NOT EXISTS tiktok_accounts_sync_idx
  ON tiktok_accounts (tenant_id, status, token_expires_at);

ALTER TABLE tiktok_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tiktok_accounts_isolation ON tiktok_accounts;
CREATE POLICY tiktok_accounts_isolation ON tiktok_accounts
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

COMMIT;
