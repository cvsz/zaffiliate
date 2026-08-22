\set ON_ERROR_STOP on

BEGIN;

INSERT INTO tenants (id, slug, name) VALUES
  ('00000000-0000-0000-0000-000000000011', 'workflow-a', 'Workflow A'),
  ('00000000-0000-0000-0000-000000000012', 'workflow-b', 'Workflow B');

SET LOCAL ROLE zaffiliate_app_test;
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000011';

INSERT INTO creator_contacts (tenant_id, id, external_creator_id, platform, email, consent)
VALUES (
  '00000000-0000-0000-0000-000000000011',
  '11000000-0000-0000-0000-000000000001',
  'creator-a',
  'tiktok',
  'creator@example.com',
  true
);

INSERT INTO outreach_outbox (
  tenant_id, id, creator_contact_id, channel, template_version, body, idempotency_key
) VALUES (
  '00000000-0000-0000-0000-000000000011',
  '12000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'email', 'intro-v1', 'hello', 'outreach-1'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO outreach_outbox (
      tenant_id, id, creator_contact_id, channel, template_version, body, idempotency_key
    ) VALUES (
      '00000000-0000-0000-0000-000000000011',
      '12000000-0000-0000-0000-000000000002',
      '11000000-0000-0000-0000-000000000001',
      'email', 'intro-v1', 'duplicate', 'outreach-1'
    );
    RAISE EXCEPTION 'expected duplicate outreach idempotency key rejection';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

INSERT INTO jobs (
  tenant_id, id, actor_id, action, resource_id, idempotency_key, fingerprint, requires_approval
) VALUES (
  '00000000-0000-0000-0000-000000000011',
  '13000000-0000-0000-0000-000000000001',
  'actor-a', 'publish', 'campaign-a', 'job-key-1', 'fingerprint-a', true
);

INSERT INTO approvals (
  tenant_id, id, job_id, approver_id, actor_id, action, resource_id, idempotency_key, decision, expires_at
) VALUES (
  '00000000-0000-0000-0000-000000000011',
  '14000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000001',
  'admin-a', 'actor-a', 'publish', 'campaign-a', 'job-key-1', 'approved', now() + interval '1 hour'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO approvals (
      tenant_id, id, job_id, approver_id, actor_id, action, resource_id, idempotency_key, decision, expires_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000011',
      '14000000-0000-0000-0000-000000000002',
      '13000000-0000-0000-0000-000000000001',
      'admin-a', 'actor-a', 'publish', 'different-resource', 'job-key-1', 'approved', now() + interval '1 hour'
    );
    RAISE EXCEPTION 'expected approval binding mismatch rejection';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

INSERT INTO idempotency_records (tenant_id, idempotency_key, fingerprint, status)
VALUES ('00000000-0000-0000-0000-000000000011', 'job-key-1', 'fingerprint-a', 'in_progress');

DO $$
BEGIN
  BEGIN
    INSERT INTO idempotency_records (tenant_id, idempotency_key, fingerprint, status)
    VALUES ('00000000-0000-0000-0000-000000000011', 'job-key-1', 'fingerprint-b', 'in_progress');
    RAISE EXCEPTION 'expected duplicate idempotency key rejection';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000012';

DO $$
DECLARE
  visible_jobs integer;
  visible_outbox integer;
BEGIN
  SELECT count(*) INTO visible_jobs FROM jobs;
  SELECT count(*) INTO visible_outbox FROM outreach_outbox;
  IF visible_jobs <> 0 OR visible_outbox <> 0 THEN
    RAISE EXCEPTION 'tenant B observed tenant A durable workflow rows';
  END IF;
END $$;

RESET ROLE;
ROLLBACK;
