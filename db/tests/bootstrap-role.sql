\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zaffiliate_app_test') THEN
    CREATE ROLE zaffiliate_app_test NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO zaffiliate_app_test;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenant_memberships,
  products,
  offers,
  affiliate_links,
  affiliate_clicks,
  affiliate_margins,
  affiliate_domain_outbox,
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
  analytics_events,
  conversions
TO zaffiliate_app_test;

GRANT USAGE, SELECT ON SEQUENCE audit_events_id_seq TO zaffiliate_app_test;
GRANT EXECUTE ON FUNCTION post_ledger_transaction(uuid) TO zaffiliate_app_test;
