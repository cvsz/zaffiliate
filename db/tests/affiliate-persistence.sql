\set ON_ERROR_STOP on

BEGIN;

INSERT INTO tenants (id, slug, name) VALUES
  ('00000000-0000-0000-0000-000000000011', 'affiliate-a', 'Affiliate A'),
  ('00000000-0000-0000-0000-000000000012', 'affiliate-b', 'Affiliate B');

SET LOCAL ROLE zaffiliate_app_test;
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000011';

INSERT INTO products (tenant_id, id, runtime_id, platform, external_product_id, title, currency)
VALUES (
  '00000000-0000-0000-0000-000000000011',
  '11000000-0000-0000-0000-000000000001',
  'prod_test_a', 'tiktok', 'external-a', 'Product A', 'THB'
);

INSERT INTO offers (
  tenant_id, id, runtime_id, product_id, sale_price, price_minor_units,
  commission_rate, cost, currency, captured_at
) VALUES (
  '00000000-0000-0000-0000-000000000011',
  '11000000-0000-0000-0000-000000000002',
  'off_test_a', '11000000-0000-0000-0000-000000000001',
  10000, 10000, 0.10, 0, 'THB', now()
);

INSERT INTO affiliate_links (
  tenant_id, id, runtime_id, offer_id, url, destination_url, deep_link_url,
  sub_id, sub_ids, slug
) VALUES (
  '00000000-0000-0000-0000-000000000011',
  '11000000-0000-0000-0000-000000000003',
  'lnk_test_a', '11000000-0000-0000-0000-000000000002',
  'https://example.test/p?subid=abc', 'https://example.test/p', 'https://example.test/p?subid=abc',
  'abc', '{"subid":"abc"}'::jsonb, 'test-a'
);

INSERT INTO affiliate_clicks (
  tenant_id, id, runtime_id, affiliate_link_id, touchpoint, recorded_at
) VALUES (
  '00000000-0000-0000-0000-000000000011',
  '11000000-0000-0000-0000-000000000004',
  'clk_test_a', '11000000-0000-0000-0000-000000000003',
  '{"source":"go","medium":"redirect"}'::jsonb, now()
);

INSERT INTO conversions (
  tenant_id, id, runtime_id, external_order_id, offer_id, affiliate_link_id,
  gross_revenue, commission, cost, currency, occurred_at,
  revenue_minor_units, gross_commission_minor_units, commission_rate
) VALUES (
  '00000000-0000-0000-0000-000000000011',
  '11000000-0000-0000-0000-000000000005',
  'cnv_test_a', 'order-a', '11000000-0000-0000-0000-000000000002',
  '11000000-0000-0000-0000-000000000003',
  10000, 1000, 0, 'THB', now(), 10000, 1000, 0.10
);

INSERT INTO affiliate_margins (
  tenant_id, id, runtime_id, conversion_id, gross_commission_minor_units,
  cost_minor_units, net_margin_minor_units, currency, computed_at
) VALUES (
  '00000000-0000-0000-0000-000000000011',
  '11000000-0000-0000-0000-000000000006',
  'mgn_test_a', '11000000-0000-0000-0000-000000000005',
  1000, 250, 750, 'THB', now()
);

INSERT INTO affiliate_domain_outbox (
  tenant_id, id, event_id, event_type, payload, occurred_at
) VALUES (
  '00000000-0000-0000-0000-000000000011',
  '11000000-0000-0000-0000-000000000007',
  'evt_test_a', 'conversion.recorded', '{"conversionId":"cnv_test_a"}'::jsonb, now()
);

DO $$
DECLARE
  clicks_count integer;
  margins_count integer;
  outbox_count integer;
BEGIN
  SELECT count(*) INTO clicks_count FROM affiliate_clicks;
  SELECT count(*) INTO margins_count FROM affiliate_margins;
  SELECT count(*) INTO outbox_count FROM affiliate_domain_outbox;
  IF clicks_count <> 1 OR margins_count <> 1 OR outbox_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected durable affiliate rows, got clicks=% margins=% outbox=%', clicks_count, margins_count, outbox_count;
  END IF;
END $$;

SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000012';

DO $$
DECLARE
  visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count
  FROM affiliate_clicks c
  JOIN affiliate_margins m ON true
  JOIN affiliate_domain_outbox o ON true;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'tenant B must not see tenant A affiliate persistence rows';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO affiliate_domain_outbox (tenant_id, event_id, event_type, payload, occurred_at)
    VALUES ('00000000-0000-0000-0000-000000000011', 'evt_cross_tenant', 'test', '{}'::jsonb, now());
    RAISE EXCEPTION 'expected cross-tenant outbox insert to be rejected';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

RESET ROLE;
ROLLBACK;
