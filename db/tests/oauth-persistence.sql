\set ON_ERROR_STOP on

INSERT INTO tenants (id, slug, name) VALUES
  ('10000000-0000-4000-8000-0000000000a1', 'oauth-a', 'OAuth A'),
  ('20000000-0000-4000-8000-0000000000b2', 'oauth-b', 'OAuth B');

INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES
  ('10000000-0000-4000-8000-0000000000a1', 'usr_oauth_a', 'owner'),
  ('20000000-0000-4000-8000-0000000000b2', 'usr_oauth_b', 'owner');

INSERT INTO local_auth_users (tenant_id, user_id, email, password_hash) VALUES
  ('10000000-0000-4000-8000-0000000000a1', 'usr_oauth_a', 'oauth-a@example.test', repeat('a', 64)),
  ('20000000-0000-4000-8000-0000000000b2', 'usr_oauth_b', 'oauth-b@example.test', repeat('b', 64));

INSERT INTO auth_user_identities (tenant_id, user_id, issuer, issuer_subject) VALUES
  ('10000000-0000-4000-8000-0000000000a1', 'usr_oauth_a', 'https://idp.example', 'remote-a'),
  ('20000000-0000-4000-8000-0000000000b2', 'usr_oauth_b', 'https://idp.example', 'remote-b');

INSERT INTO oauth_pending_authorizations
  (tenant_id, user_id, provider, issuer, state_hash, code_verifier_ciphertext, expires_at)
VALUES
  ('10000000-0000-4000-8000-0000000000a1', 'usr_oauth_a', 'acme', 'https://idp.example', repeat('1', 64), repeat('c', 64), now() + interval '10 minutes'),
  ('20000000-0000-4000-8000-0000000000b2', 'usr_oauth_b', 'acme', 'https://idp.example', repeat('2', 64), repeat('d', 64), now() + interval '10 minutes');

INSERT INTO oauth_provider_tokens
  (tenant_id, user_id, provider, issuer, access_token_ciphertext, refresh_token_ciphertext, token_type, scope)
VALUES
  ('10000000-0000-4000-8000-0000000000a1', 'usr_oauth_a', 'acme', 'https://idp.example', repeat('e', 64), repeat('f', 64), 'Bearer', 'read'),
  ('20000000-0000-4000-8000-0000000000b2', 'usr_oauth_b', 'acme', 'https://idp.example', repeat('7', 64), repeat('8', 64), 'Bearer', 'read');

SET ROLE zaffiliate_app_test;
SELECT set_config('app.tenant_id', '10000000-0000-4000-8000-0000000000a1', false);

DO $$
BEGIN
  IF (SELECT count(*) FROM auth_user_identities) <> 1 THEN
    RAISE EXCEPTION 'tenant A must see exactly one oauth identity';
  END IF;
  IF (SELECT count(*) FROM oauth_pending_authorizations) <> 1 THEN
    RAISE EXCEPTION 'tenant A must see exactly one pending oauth flow';
  END IF;
  IF (SELECT count(*) FROM oauth_provider_tokens) <> 1 THEN
    RAISE EXCEPTION 'tenant A must see exactly one provider token set';
  END IF;
  IF EXISTS (SELECT 1 FROM auth_user_identities WHERE user_id='usr_oauth_b') THEN
    RAISE EXCEPTION 'cross-tenant oauth identity leaked through RLS';
  END IF;
  IF EXISTS (SELECT 1 FROM oauth_provider_tokens WHERE user_id='usr_oauth_b') THEN
    RAISE EXCEPTION 'cross-tenant provider token leaked through RLS';
  END IF;
END $$;

DO $$
DECLARE
  claimed integer;
BEGIN
  UPDATE oauth_pending_authorizations
  SET consumed_at=now()
  WHERE tenant_id='10000000-0000-4000-8000-0000000000a1'
    AND provider='acme'
    AND state_hash=repeat('1', 64)
    AND consumed_at IS NULL
    AND expires_at > now();
  GET DIAGNOSTICS claimed = ROW_COUNT;
  IF claimed <> 1 THEN
    RAISE EXCEPTION 'first oauth state claim must succeed exactly once';
  END IF;

  UPDATE oauth_pending_authorizations
  SET consumed_at=now()
  WHERE tenant_id='10000000-0000-4000-8000-0000000000a1'
    AND provider='acme'
    AND state_hash=repeat('1', 64)
    AND consumed_at IS NULL
    AND expires_at > now();
  GET DIAGNOSTICS claimed = ROW_COUNT;
  IF claimed <> 0 THEN
    RAISE EXCEPTION 'replayed oauth state must not be claimable';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO oauth_provider_tokens
      (tenant_id, user_id, provider, issuer, access_token_ciphertext)
    VALUES
      ('20000000-0000-4000-8000-0000000000b2', 'usr_oauth_b', 'evil', 'https://idp.example', repeat('9', 64));
    RAISE EXCEPTION 'expected cross-tenant oauth token insert to be rejected';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN foreign_key_violation THEN NULL;
  END;
END $$;

RESET ROLE;
