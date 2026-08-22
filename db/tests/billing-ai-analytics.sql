\set ON_ERROR_STOP on

BEGIN;

INSERT INTO tenants (id, slug, name) VALUES
  ('00000000-0000-0000-0000-000000000021', 'data-a', 'Data A'),
  ('00000000-0000-0000-0000-000000000022', 'data-b', 'Data B');

SET LOCAL ROLE zaffiliate_app_test;
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000021';

INSERT INTO products (tenant_id,id,platform,external_product_id,title,currency) VALUES
('00000000-0000-0000-0000-000000000021','21000000-0000-0000-0000-000000000001','tiktok','p-ext','Product','THB');
INSERT INTO offers (tenant_id,id,product_id,sale_price,commission_rate,cost,currency) VALUES
('00000000-0000-0000-0000-000000000021','22000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001',1000,0.1,20,'THB');
INSERT INTO affiliate_links (tenant_id,id,offer_id,url,sub_id) VALUES
('00000000-0000-0000-0000-000000000021','23000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','https://example.com/a','sub-a');
INSERT INTO conversions (tenant_id,id,external_order_id,offer_id,affiliate_link_id,gross_revenue,commission,cost,currency,occurred_at) VALUES
('00000000-0000-0000-0000-000000000021','24000000-0000-0000-0000-000000000001','order-a','22000000-0000-0000-0000-000000000001','23000000-0000-0000-0000-000000000001',1000,100,20,'THB',now());

DO $$ DECLARE m numeric; BEGIN
  SELECT true_margin INTO m FROM conversions WHERE external_order_id='order-a';
  IF m <> 80 THEN RAISE EXCEPTION 'expected true margin 80, got %', m; END IF;
END $$;

INSERT INTO ledger_transactions (tenant_id,id,currency,reference_type,reference_id) VALUES
('00000000-0000-0000-0000-000000000021','25000000-0000-0000-0000-000000000001','THB','commission','order-a');
INSERT INTO ledger_entries (tenant_id,transaction_id,account,debit) VALUES
('00000000-0000-0000-0000-000000000021','25000000-0000-0000-0000-000000000001','commission_receivable',100);
INSERT INTO ledger_entries (tenant_id,transaction_id,account,credit) VALUES
('00000000-0000-0000-0000-000000000021','25000000-0000-0000-0000-000000000001','commission_income',100);
SELECT post_ledger_transaction('25000000-0000-0000-0000-000000000001');

DO $$ DECLARE s text; BEGIN
  SELECT status INTO s FROM ledger_transactions WHERE id='25000000-0000-0000-0000-000000000001';
  IF s <> 'posted' THEN RAISE EXCEPTION 'ledger transaction not posted'; END IF;
END $$;

INSERT INTO ledger_transactions (tenant_id,id,currency,reference_type,reference_id) VALUES
('00000000-0000-0000-0000-000000000021','25000000-0000-0000-0000-000000000002','THB','test','unbalanced');
INSERT INTO ledger_entries (tenant_id,transaction_id,account,debit) VALUES
('00000000-0000-0000-0000-000000000021','25000000-0000-0000-0000-000000000002','a',100);
INSERT INTO ledger_entries (tenant_id,transaction_id,account,credit) VALUES
('00000000-0000-0000-0000-000000000021','25000000-0000-0000-0000-000000000002','b',90);
DO $$ BEGIN
  BEGIN
    PERFORM post_ledger_transaction('25000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'expected unbalanced ledger rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO ai_requests (tenant_id,id,request_id,actor_id,provider,model,modality,prompt_template_id,prompt_template_version,input_hash,max_cost) VALUES
('00000000-0000-0000-0000-000000000021','26000000-0000-0000-0000-000000000001','ai-1','actor','provider','model','text','caption','v1','sha256:input',1.00);
INSERT INTO ai_usage (tenant_id,id,ai_request_id,output_hash,actual_cost) VALUES
('00000000-0000-0000-0000-000000000021','27000000-0000-0000-0000-000000000001','26000000-0000-0000-0000-000000000001','sha256:output',0.50);
DO $$ BEGIN
  BEGIN
    INSERT INTO ai_usage (tenant_id,id,ai_request_id,output_hash,actual_cost) VALUES
    ('00000000-0000-0000-0000-000000000021','27000000-0000-0000-0000-000000000002','26000000-0000-0000-0000-000000000001','sha256:too-expensive',2.00);
    RAISE EXCEPTION 'expected AI budget rejection';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

INSERT INTO analytics_events (tenant_id,event_id,event_type,occurred_at) VALUES
('00000000-0000-0000-0000-000000000021','event-1','click',now());
DO $$ BEGIN
  BEGIN
    INSERT INTO analytics_events (tenant_id,event_id,event_type,occurred_at) VALUES
    ('00000000-0000-0000-0000-000000000021','event-1','click',now());
    RAISE EXCEPTION 'expected analytics event dedupe rejection';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000022';
DO $$ DECLARE c integer; BEGIN
  SELECT count(*) INTO c FROM conversions;
  IF c <> 0 THEN RAISE EXCEPTION 'tenant B observed tenant A conversion'; END IF;
END $$;

RESET ROLE;
ROLLBACK;
