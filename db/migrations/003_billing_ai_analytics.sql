BEGIN;

CREATE TABLE IF NOT EXISTS ledger_transactions (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency text NOT NULL,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','void')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  UNIQUE (tenant_id, reference_type, reference_id)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  account text NOT NULL,
  debit numeric(20,6) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(20,6) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE INDEX IF NOT EXISTS ledger_entries_tx_idx ON ledger_entries (tenant_id, transaction_id);

CREATE TABLE IF NOT EXISTS ai_requests (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  actor_id text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  modality text NOT NULL CHECK (modality IN ('text','image','video','voice','embedding')),
  prompt_template_id text NOT NULL,
  prompt_template_version text NOT NULL,
  input_hash text NOT NULL,
  max_cost numeric(20,8) NOT NULL CHECK (max_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_id)
);

CREATE TABLE IF NOT EXISTS ai_usage (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_request_id uuid NOT NULL REFERENCES ai_requests(id) ON DELETE RESTRICT,
  provider_request_id text,
  output_hash text NOT NULL,
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  actual_cost numeric(20,8) NOT NULL DEFAULT 0 CHECK (actual_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ai_request_id)
);

CREATE TABLE IF NOT EXISTS analytics_events (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('impression','click','cart','order','conversion','commission')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  measures jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_id)
);

CREATE INDEX IF NOT EXISTS analytics_events_time_idx ON analytics_events (tenant_id, occurred_at, event_type);

CREATE TABLE IF NOT EXISTS conversions (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_order_id text NOT NULL,
  offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE RESTRICT,
  affiliate_link_id uuid NOT NULL REFERENCES affiliate_links(id) ON DELETE RESTRICT,
  gross_revenue numeric(20,6) NOT NULL CHECK (gross_revenue >= 0),
  commission numeric(20,6) NOT NULL CHECK (commission >= 0),
  cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  true_margin numeric(20,6) GENERATED ALWAYS AS (commission - cost) STORED,
  currency text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_order_id)
);

ALTER TABLE ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events FORCE ROW LEVEL SECURITY;
ALTER TABLE conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ledger_transactions_isolation ON ledger_transactions;
CREATE POLICY ledger_transactions_isolation ON ledger_transactions
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS ledger_entries_isolation ON ledger_entries;
CREATE POLICY ledger_entries_isolation ON ledger_entries
USING (tenant_id = app_current_tenant_id())
WITH CHECK (
  tenant_id = app_current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM ledger_transactions t
    WHERE t.id = ledger_entries.transaction_id
      AND t.tenant_id = app_current_tenant_id()
      AND t.status = 'draft'
  )
);

DROP POLICY IF EXISTS ai_requests_isolation ON ai_requests;
CREATE POLICY ai_requests_isolation ON ai_requests
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS ai_usage_isolation ON ai_usage;
CREATE POLICY ai_usage_isolation ON ai_usage
USING (tenant_id = app_current_tenant_id())
WITH CHECK (
  tenant_id = app_current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM ai_requests r
    WHERE r.id = ai_usage.ai_request_id
      AND r.tenant_id = app_current_tenant_id()
      AND ai_usage.actual_cost <= r.max_cost
  )
);

DROP POLICY IF EXISTS analytics_events_isolation ON analytics_events;
CREATE POLICY analytics_events_isolation ON analytics_events
USING (tenant_id = app_current_tenant_id())
WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS conversions_isolation ON conversions;
CREATE POLICY conversions_isolation ON conversions
USING (tenant_id = app_current_tenant_id())
WITH CHECK (
  tenant_id = app_current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM offers o
    WHERE o.id = conversions.offer_id AND o.tenant_id = app_current_tenant_id()
  )
  AND EXISTS (
    SELECT 1 FROM affiliate_links l
    WHERE l.id = conversions.affiliate_link_id
      AND l.tenant_id = app_current_tenant_id()
      AND l.offer_id = conversions.offer_id
  )
);

CREATE OR REPLACE FUNCTION post_ledger_transaction(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_debits numeric(20,6);
  v_credits numeric(20,6);
  v_entry_count integer;
  v_tenant uuid;
BEGIN
  v_tenant := app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'tenant context is required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(sum(e.debit),0), COALESCE(sum(e.credit),0), count(*)
    INTO v_debits, v_credits, v_entry_count
  FROM public.ledger_entries e
  WHERE e.transaction_id = p_transaction_id
    AND e.tenant_id = v_tenant;

  IF v_entry_count < 2 THEN
    RAISE EXCEPTION 'ledger transaction requires at least two entries' USING ERRCODE = 'check_violation';
  END IF;
  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'ledger transaction is not balanced' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.ledger_transactions
  SET status = 'posted', posted_at = now()
  WHERE id = p_transaction_id
    AND tenant_id = v_tenant
    AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ledger transaction is unavailable or already finalized' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION post_ledger_transaction(uuid) FROM PUBLIC;

COMMIT;
