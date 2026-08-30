\set ON_ERROR_STOP on

INSERT INTO tenants (id, slug, name) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'auth-a', 'Auth A'),
  ('00000000-0000-0000-0000-0000000000b2', 'auth-b', 'Auth B');

INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'usr_a', 'owner'),
  ('00000000-0000-0000-0000-0000000000b2', 'usr_b', 'owner');

INSERT INTO local_auth_users (tenant_id, user_id, email, password_hash) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'usr_a', 'a@example.test', repeat('a', 64)),
  ('00000000-0000-0000-0000-0000000000b2', 'usr_b', 'b@example.test', repeat('b', 64));

INSERT INTO auth_sessions (tenant_id, user_id, token_hash, expires_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'usr_a', repeat('1', 64), now() + interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000b2', 'usr_b', repeat('2', 64), now() + interval '1 hour');

INSERT INTO auth_recovery_tokens (tenant_id, user_id, purpose, token_hash, expires_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'usr_a', 'password_reset', repeat('3', 64), now() + interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000b2', 'usr_b', 'password_reset', repeat('4', 64), now() + interval '1 hour');

SET ROLE zaffiliate_app_test;
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-0000000000a1', false);

DO $$
BEGIN
  IF (SELECT count(*) FROM local_auth_users) <> 1 THEN
    RAISE EXCEPTION 'tenant A must see exactly one local auth user';
  END IF;
  IF (SELECT count(*) FROM auth_sessions) <> 1 THEN
    RAISE EXCEPTION 'tenant A must see exactly one auth session';
  END IF;
  IF (SELECT count(*) FROM auth_recovery_tokens) <> 1 THEN
    RAISE EXCEPTION 'tenant A must see exactly one recovery token';
  END IF;
  IF EXISTS (SELECT 1 FROM local_auth_users WHERE user_id = 'usr_b') THEN
    RAISE EXCEPTION 'cross-tenant auth user leaked through RLS';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO local_auth_users (tenant_id, user_id, email, password_hash)
    VALUES ('00000000-0000-0000-0000-0000000000b2', 'usr_intruder', 'intruder@example.test', repeat('x', 64));
    RAISE EXCEPTION 'expected cross-tenant insert to be rejected';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN foreign_key_violation THEN NULL;
  END;
END $$;

UPDATE auth_sessions
SET revoked_at = now()
WHERE tenant_id = '00000000-0000-0000-0000-0000000000a1' AND user_id = 'usr_a';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth_sessions WHERE user_id='usr_a' AND revoked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'tenant A must be able to revoke its own session';
  END IF;
END $$;

RESET ROLE;
