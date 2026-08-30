\set ON_ERROR_STOP on

BEGIN;

INSERT INTO tenants (id, slug, name) VALUES
  ('00000000-0000-4000-8000-000000000021', 'conversion-a', 'Conversion A'),
  ('00000000-0000-4000-8000-000000000022', 'conversion-b', 'Conversion B');

INSERT INTO products (tenant_id, id, runtime_id, platform, external_product_id, title, currency)
VALUES (
  '00000000-0000-4000-8000-000000000021',
  '21000000-0000-4000-8000-000000000001',
  'prod_conversion_a', 'tiktok', 'conversion-product-a', 'Conversion Product A', 'THB'
);

INSERT INTO offers (
  tenant_id, id, runtime_id, product_id, sale_price, price_minor_units,
  commission_rate, cost, currency, captured_at
) VALUES (
  '00000000-0000-4000-8000-000000000021',
  '21000000-0000-4000-8000-000000000002',
  'off_conversion_a', '21000000-0000-4000-8000-000000000001',
  10000, 10000, 0.10, 0, 'THB', now()
);

INSERT INTO affiliate_links (
  tenant_id, id, runtime_id, offer_id, url, destination_url, deep_link_url,
  sub_id, sub_ids, slug
) VALUES (
  '00000000-0000-4000-8000-000000000021',
  '21000000-0000-4000-8000-000000000003',
  'lnk_conversion_a', '21000000-0000-4000-8000-000000000002',
  'https://example.test/p?subid=reconcile', 'https://example.test/p', 'https://example.test/p?subid=reconcile',
  'reconcile', '{"subid":"reconcile"}'::jsonb, 'conversion-a'
);

INSERT INTO conversions (
  tenant_id, id, runtime_id, external_order_id, offer_id, affiliate_link_id,
  gross_revenue, commission, cost, currency, occurred_at,
  revenue_minor_units, gross_commission_minor_units, commission_rate
) VALUES (
  '00000000-0000-4000-8000-000000000021',
  '21000000-0000-4000-8000-000000000004',
  'cnv_reconcile_a', 'reconcile-order-a', '21000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000003',
  10000, 1000, 0, 'THB', now(), 10000, 1000, 0.10
);

SET LOCAL ROLE zaffiliate_app_test;
SET LOCAL app.tenant_id = '00000000-0000-4000-8000-000000000021';

DO $$
DECLARE
  visible_count integer;
  current_status text;
BEGIN
  SELECT count(*), min(status) INTO visible_count, current_status FROM conversions;
  IF visible_count <> 1 OR current_status <> 'pending' THEN
    RAISE EXCEPTION 'tenant A expected one pending conversion, got count=% status=%', visible_count, current_status;
  END IF;
END $$;

UPDATE conversions
SET status = 'confirmed', status_updated_at = now()
WHERE runtime_id = 'cnv_reconcile_a';

DO $$
DECLARE
  current_status text;
BEGIN
  SELECT status INTO current_status FROM conversions WHERE runtime_id = 'cnv_reconcile_a';
  IF current_status <> 'confirmed' THEN
    RAISE EXCEPTION 'tenant A conversion status update failed: %', current_status;
  END IF;

  BEGIN
    UPDATE conversions SET status = 'invalid' WHERE runtime_id = 'cnv_reconcile_a';
    RAISE EXCEPTION 'expected invalid conversion status to be rejected';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

SET LOCAL app.tenant_id = '00000000-0000-4000-8000-000000000022';

DO $$
DECLARE
  visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM conversions;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'tenant B must not see tenant A conversions';
  END IF;
END $$;

DO $$
DECLARE
  changed_count integer;
BEGIN
  UPDATE conversions SET status = 'refunded' WHERE runtime_id = 'cnv_reconcile_a';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant B must not update tenant A conversion';
  END IF;
END $$;

RESET ROLE;
ROLLBACK;
