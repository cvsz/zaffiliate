BEGIN;

-- Standalone OIDC login starts before a tenant is known. This table therefore
-- intentionally has no tenant column/RLS policy. It contains no user PII: only
-- provider metadata, a SHA-256 state digest, and an AES-GCM encrypted
-- PKCE/nonce bundle. Access is revoked from PUBLIC below.
CREATE TABLE IF NOT EXISTS oauth_login_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  issuer text NOT NULL,
  state_hash text NOT NULL UNIQUE,
  authorization_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_login_authorizations_provider_safe
    CHECK (provider ~ '^[a-z0-9_-]{2,32}$'),
  CONSTRAINT oauth_login_authorizations_issuer_present
    CHECK (length(btrim(issuer)) BETWEEN 1 AND 2048),
  CONSTRAINT oauth_login_authorizations_state_hash_shape
    CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT oauth_login_authorizations_ciphertext_present
    CHECK (length(authorization_ciphertext) >= 32),
  CONSTRAINT oauth_login_authorizations_expiry_order
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS oauth_login_authorizations_claim_idx
  ON oauth_login_authorizations (provider, state_hash, expires_at)
  WHERE consumed_at IS NULL;

-- Global identity lookup is required before tenant context exists. The key is a
-- SHA-256 digest of issuer + NUL + subject, not the raw provider subject. The
-- canonical tenant-scoped identity remains auth_user_identities under FORCE RLS.
CREATE TABLE IF NOT EXISTS oauth_identity_directory (
  identity_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_identity_directory_hash_shape
    CHECK (identity_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT oauth_identity_directory_user_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES local_auth_users(tenant_id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS oauth_identity_directory_user_idx
  ON oauth_identity_directory (tenant_id, user_id);

-- Backfill identities linked before standalone OIDC login existed.
INSERT INTO oauth_identity_directory (identity_hash, tenant_id, user_id)
SELECT
  encode(digest(issuer || chr(0) || issuer_subject, 'sha256'), 'hex'),
  tenant_id,
  user_id
FROM auth_user_identities
ON CONFLICT (identity_hash) DO NOTHING;

-- Keep the global hash directory synchronized with the canonical RLS-protected
-- identity table. The function has a fixed search_path and never accepts caller
-- supplied SQL identifiers.
CREATE OR REPLACE FUNCTION sync_oauth_identity_directory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  digest_value text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    digest_value := encode(digest(OLD.issuer || chr(0) || OLD.issuer_subject, 'sha256'), 'hex');
    DELETE FROM public.oauth_identity_directory
    WHERE identity_hash = digest_value
      AND tenant_id = OLD.tenant_id
      AND user_id = OLD.user_id;
    RETURN OLD;
  END IF;

  digest_value := encode(digest(NEW.issuer || chr(0) || NEW.issuer_subject, 'sha256'), 'hex');
  INSERT INTO public.oauth_identity_directory (identity_hash, tenant_id, user_id)
  VALUES (digest_value, NEW.tenant_id, NEW.user_id)
  ON CONFLICT (identity_hash) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_user_identities_directory_sync ON auth_user_identities;
CREATE TRIGGER auth_user_identities_directory_sync
AFTER INSERT OR DELETE ON auth_user_identities
FOR EACH ROW EXECUTE FUNCTION sync_oauth_identity_directory();

REVOKE ALL ON oauth_login_authorizations FROM PUBLIC;
REVOKE ALL ON oauth_identity_directory FROM PUBLIC;
REVOKE ALL ON FUNCTION sync_oauth_identity_directory() FROM PUBLIC;

COMMIT;
