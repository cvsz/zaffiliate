\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zaffiliate_app_test') THEN
    CREATE ROLE zaffiliate_app_test NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO zaffiliate_app_test;

GRANT SELECT, INSERT ON tenants TO zaffiliate_app_test;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenant_memberships,
  products,
  offers,
  affiliate_links,
  creator_contacts,
  outreach_outbox,
  jobs,
  idempotency_records
TO zaffiliate_app_test;

GRANT SELECT, INSERT ON
  approvals,
  audit_events,
  ledger_transactions,
  ledger_entries,
  ai_requests,
  ai_usage,
  analytics_events
TO zaffiliate_app_test;

GRANT SELECT, INSERT, UPDATE ON conversions TO zaffiliate_app_test;

DO $$
BEGIN
  IF to_regclass('public.affiliate_clicks') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON affiliate_clicks TO zaffiliate_app_test;
  END IF;
  IF to_regclass('public.affiliate_margins') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON affiliate_margins TO zaffiliate_app_test;
  END IF;
  IF to_regclass('public.affiliate_domain_outbox') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON affiliate_domain_outbox TO zaffiliate_app_test;
  END IF;
  IF to_regclass('public.local_auth_users') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON local_auth_users TO zaffiliate_app_test;
  END IF;
  IF to_regclass('public.auth_sessions') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth_sessions TO zaffiliate_app_test;
  END IF;
  IF to_regclass('public.auth_recovery_tokens') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth_recovery_tokens TO zaffiliate_app_test;
  END IF;
  IF to_regclass('public.auth_user_identities') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth_user_identities TO zaffiliate_app_test;
  END IF;
  IF to_regclass('public.oauth_pending_authorizations') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_pending_authorizations TO zaffiliate_app_test;
  END IF;
  IF to_regclass('public.oauth_provider_tokens') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_provider_tokens TO zaffiliate_app_test;
  END IF;
  IF to_regclass('public.oauth_login_authorizations') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_login_authorizations TO zaffiliate_app_test;
  END IF;
  IF to_regclass('public.oauth_identity_directory') IS NOT NULL THEN
    GRANT SELECT ON oauth_identity_directory TO zaffiliate_app_test;
  END IF;
  IF to_regclass('public.campaigns') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO zaffiliate_app_test;
  END IF;
END $$;

GRANT USAGE, SELECT ON SEQUENCE audit_events_id_seq TO zaffiliate_app_test;
GRANT EXECUTE ON FUNCTION post_ledger_transaction(uuid) TO zaffiliate_app_test;
