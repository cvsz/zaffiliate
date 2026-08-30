\set ON_ERROR_STOP on

INSERT INTO tenants (id, slug, name)
VALUES ('30000000-0000-4000-8000-0000000000c3', 'oidc-login-c', 'OIDC Login C');

INSERT INTO tenant_memberships (tenant_id, user_id, role)
VALUES ('30000000-0000-4000-8000-0000000000c3', 'usr_oidc_login_c', 'owner');

INSERT INTO local_auth_users
  (tenant_id, user_id, email, password_hash, email_verified)
VALUES
  ('30000000-0000-4000-8000-0000000000c3', 'usr_oidc_login_c', 'oidc-login-c@example.test', repeat('c', 64), true);

-- The canonical identity insert must populate the global hash directory through
-- the migration trigger without exposing issuer_subject in that directory.
INSERT INTO auth_user_identities (tenant_id, user_id, issuer, issuer_subject)
VALUES
  ('30000000-0000-4000-8000-0000000000c3', 'usr_oidc_login_c', 'https://idp.example', 'remote-login-c');

SET ROLE zaffiliate_app_test;
SELECT set_config('app.tenant_id', '', false);

DO $$
DECLARE
  expected_hash text := encode(
    digest(
      convert_to('https://idp.example', 'UTF8') || decode('00', 'hex') || convert_to('remote-login-c', 'UTF8'),
      'sha256'
    ),
    'hex'
  );
BEGIN
  IF (SELECT count(*) FROM oauth_identity_directory WHERE identity_hash=expected_hash) <> 1 THEN
    RAISE EXCEPTION 'canonical identity insert must populate oauth identity directory';
  END IF;
  IF EXISTS (SELECT 1 FROM auth_user_identities) THEN
    RAISE EXCEPTION 'canonical oauth identities must remain hidden without tenant context';
  END IF;
END $$;

INSERT INTO oauth_login_authorizations
  (provider, issuer, state_hash, authorization_ciphertext, expires_at)
VALUES
  ('acme', 'https://idp.example', repeat('3', 64), repeat('x', 64), now() + interval '10 minutes');

DO $$
DECLARE
  claimed integer;
BEGIN
  UPDATE oauth_login_authorizations
  SET consumed_at=now()
  WHERE provider='acme'
    AND state_hash=repeat('3', 64)
    AND consumed_at IS NULL
    AND expires_at > now();
  GET DIAGNOSTICS claimed = ROW_COUNT;
  IF claimed <> 1 THEN
    RAISE EXCEPTION 'first standalone OIDC state claim must succeed exactly once';
  END IF;

  UPDATE oauth_login_authorizations
  SET consumed_at=now()
  WHERE provider='acme'
    AND state_hash=repeat('3', 64)
    AND consumed_at IS NULL
    AND expires_at > now();
  GET DIAGNOSTICS claimed = ROW_COUNT;
  IF claimed <> 0 THEN
    RAISE EXCEPTION 'replayed standalone OIDC state must not be claimable';
  END IF;
END $$;

-- Restoring the correct tenant context makes the canonical identity visible;
-- deleting it must remove the corresponding global hash directory entry.
SELECT set_config('app.tenant_id', '30000000-0000-4000-8000-0000000000c3', false);

DO $$
BEGIN
  IF (SELECT count(*) FROM auth_user_identities WHERE user_id='usr_oidc_login_c') <> 1 THEN
    RAISE EXCEPTION 'tenant owner must see its canonical oauth identity';
  END IF;
END $$;

DELETE FROM auth_user_identities
WHERE tenant_id='30000000-0000-4000-8000-0000000000c3'
  AND user_id='usr_oidc_login_c'
  AND issuer='https://idp.example'
  AND issuer_subject='remote-login-c';

SELECT set_config('app.tenant_id', '', false);

DO $$
DECLARE
  expected_hash text := encode(
    digest(
      convert_to('https://idp.example', 'UTF8') || decode('00', 'hex') || convert_to('remote-login-c', 'UTF8'),
      'sha256'
    ),
    'hex'
  );
BEGIN
  IF EXISTS (SELECT 1 FROM oauth_identity_directory WHERE identity_hash=expected_hash) THEN
    RAISE EXCEPTION 'identity unlink must remove oauth identity directory entry';
  END IF;
END $$;

RESET ROLE;
