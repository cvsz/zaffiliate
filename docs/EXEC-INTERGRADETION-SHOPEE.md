# ZAFFILIATE — SHOPEE THAILAND AFFILIATE
# END-TO-END PRODUCTION MASTER EXECUTION PROMPT

Repository:
  cvsz/zaffiliate

Canonical branch:
  main

Preferred implementation branch:
  feat/shopee-th-affiliate-production

Primary goal:
  Deliver a verifiable, secure, tenant-isolated, production-grade
  Shopee Thailand Affiliate integration inside cvsz/zaffiliate.

============================================================
0. EXECUTION AUTHORITY
============================================================

You are authorized to:

- inspect the complete repository;
- inspect current main/head;
- inspect open/closed PRs relevant to this work;
- inspect review threads;
- inspect CI, CodeQL, security, test and release evidence;
- create/reuse a feature branch;
- add/update source code;
- add migrations;
- add tests and fixtures;
- update documentation;
- commit and push bounded changes;
- create/update a pull request;
- fix CI/review findings;
- rerun verification;
- merge ONLY when all merge gates defined below are verifiably satisfied.

Do NOT:
- bypass branch protection;
- force push unless repository conventions explicitly require it;
- weaken tests/security controls to make CI green;
- delete failing tests merely to pass CI;
- commit credentials, cookies, sessions, tokens or private keys;
- scrape authenticated Shopee dashboards;
- invent undocumented Shopee Thailand API contracts;
- claim Production Ready without fresh evidence.

Never write feature implementation directly to main when a feature branch
can be used.

============================================================
1. SOURCE OF TRUTH
============================================================

Treat cvsz/zaffiliate as the canonical platform.

Do NOT implement this feature in cvsz/zadsystem.
zadsystem is retired and must not become another production source of truth.

Before changing code, inspect at minimum:

- README.md
- ARCHITECTURE.md
- ROADMAP.md
- EXEC-PLANNING.md
- IMPLEMENTATION-CHECKLIST.md
- RELEASE-READINESS.md
- CHANGELOG.md
- COMPLIANCE.md
- package.json
- workspace/package manifests
- migrations
- tests
- CI workflows
- security workflows

Then inspect existing implementation patterns for:

- PostgreSQL repositories
- RLS
- tenant context
- affiliate-core
- campaign repository
- conversion reconciliation
- tracking
- /go/:slug
- webhook ingress
- durable outbox
- Redis
- adapters
- TikTok Shop integration
- Shopee integration
- analytics
- metrics/readiness
- secret handling

Do not duplicate an existing abstraction when it can safely be extended.

============================================================
2. VERIFIED SHOPEE STARTING POINT
============================================================

Shopee support already exists.

Inspect:

  packages/adapters/src/shopee.js

before implementing anything.

Preserve useful existing behavior including, where currently present:

- provider abstraction;
- request signing;
- authentication/token handling;
- catalog operations;
- order operations;
- affiliate-link functionality;
- provider errors;
- capability contracts.

Inspect existing marketplace adapter tests before extending the adapter.

Do not rewrite this implementation simply to introduce a new architecture.

============================================================
3. END-TO-END TARGET
============================================================

Build this production flow:

Shopee TH source
      
CSV / Datafeed / Report ingestion
      
Schema validation
      
Normalization
      
Products + Offers
      
Affiliate URL
      
Sub-ID / attribution metadata
      
Campaign / Content
      
/go/:slug
      
Click tracking
      
Shopee click/order reports
      
Conversions
      
Commission reconciliation
      
Payment reconciliation
      
Analytics
      
Operational / release evidence

The implementation must remain compatible with the existing zaffiliate
architecture rather than becoming an independent service.

============================================================
4. REAL SHOPEE TH PRODUCT FEED CONTRACT
============================================================

Support the observed Shopee Thailand Affiliate CSV/datafeed schema:

- รหัสสินค้า
- ชื่อสินค้า
- ราคา
- ขาย
- ชื่อร้านค้า
- อัตราค่าคอมมิชชัน
- คอมมิชชัน
- ลิงก์สินค้า
- ลิงก์ข้อเสนอ

Implement an explicit Shopee TH mapping layer.

Normalize fields into typed canonical values.

Examples of required normalization:

- product ID  stable string identifier
- product name  normalized text
- price  decimal/money representation
- shop name  normalized text
- commission rate  decimal/percentage representation
- commission amount  money representation
- product URL  validated URL
- affiliate/offer URL  validated URL
- sold notation  normalized numeric estimate where safe

Thai quantity notation may include values conceptually equivalent to:

- พัน
- หมื่น
- แสน
- ล้าน

Parsing must be deterministic and covered by tests.

Do not silently accept malformed monetary, percentage or URL values.

Unknown schemas must fail clearly rather than guessing column meanings.

Verified fixture: the real Shopee Thailand product export is the authoritative
source for the header mapping above. It is referenced at
`docs/SHOPEE-PRODUCT-EXPORT.md`. The constants in
`packages/adapters/src/shopee-th-constants.js` are transcribed from that
fixture as explicit Unicode code points; if the real headers ever differ, the
constants are wrong and must be fixed — never silently widen acceptance.

============================================================
5. IMPORT PROVENANCE
============================================================

Every durable import must preserve sufficient provenance.

Where appropriate retain:

- tenant_id
- platform
- source_type
- source_filename / source identity
- source_timestamp
- imported_at
- source row identity
- provider product ID
- provider shop identity when available
- source URL
- affiliate URL
- raw or canonical evidence hash
- parser/schema version
- import batch ID

Design provenance so later reconciliation can explain where a value came from.

Do not create unnecessary storage of sensitive raw data.

============================================================
6. IDEMPOTENCY
============================================================

Imports must be safely repeatable.

Re-importing the same source must not create duplicate:

- products;
- offers;
- clicks;
- orders;
- conversions;
- commissions;
- payment records.

Use repository-standard durable idempotency patterns.

Prefer stable source/provider identities and database constraints over
process-local memory.

Concurrent imports must not bypass uniqueness guarantees.

Test duplicate and concurrent scenarios where practical.

============================================================
7. POSTGRESQL + RLS
============================================================

Durable production state belongs in PostgreSQL.

Follow existing migration conventions.

Any new tenant-owned table must:

- include canonical tenant ownership;
- participate in RLS;
- deny cross-tenant access;
- fail closed when tenant context is absent;
- have required uniqueness constraints;
- have appropriate indexes;
- have explicit timestamps;
- avoid unrestricted public access.

Add service-backed PostgreSQL regression tests where repository conventions
support them.

Explicitly test:

Tenant A cannot:
- read Tenant B's Shopee products;
- modify Tenant B's offers;
- reconcile Tenant B's orders;
- access Tenant B's attribution metadata.

============================================================
8. PRODUCTS AND OFFERS
============================================================

Normalize Shopee data into existing commerce/domain contracts where possible.

A Shopee product and an affiliate offer are related but not necessarily
identical lifecycle objects.

Preserve, where available:

- provider product identity;
- product URL;
- shop identity/name;
- observed price;
- observed sales indicator;
- affiliate URL;
- observed commission rate;
- observed commission amount;
- observation timestamp;
- source evidence.

Do not overwrite historical evidence merely because a newer feed was imported.

Use repository conventions for snapshots/history where available.

============================================================
9. COMMISSION SAFETY CONTRACT
============================================================

NEVER hard-code a universal Shopee commission assumption.

Commission conditions may change.

Store observed values rather than treating a static constant as truth.

Preserve:

- commission_rate
- commission_amount
- currency where available
- source
- observed_at/source timestamp
- reconciliation state
- reconciliation evidence

Do not derive final payable commission solely from an advertised percentage
when an authoritative order/payment report is available.

Separate concepts such as:

- estimated commission;
- reported order commission;
- approved commission;
- paid commission;

when actual source data supports those states.

============================================================
10. AFFILIATE LINKS
============================================================

Reuse existing Shopee affiliate-link capability when correct.

Requirements:

- validate original URLs;
- preserve provider identity;
- preserve tenant ownership;
- support idempotent creation;
- avoid duplicate link records;
- fail closed when required provider capability/credentials are unavailable.

Do not fabricate a Shopee affiliate URL locally when provider-generated or
export-provided URLs are required.

============================================================
11. SUB-ID / ATTRIBUTION
============================================================

Introduce an attribution model capable of carrying Shopee Sub-ID metadata.

It should support correlation between:

campaign/content
    
affiliate link
    
redirect
    
click
    
order/conversion
    
commission

However:

Do NOT invent exact Shopee TH Sub-ID field names, length limits, encoding
rules or API parameters without verified documentation/export evidence.

Design the internal contract so exact provider mapping can be added without
changing the domain model.

Unknown external Sub-ID schemas must fail clearly or remain unsupported.

============================================================
12. /go/:slug
============================================================

Integrate with the existing redirect route instead of creating a competing
tracking endpoint.

Preserve existing security and response behavior.

A redirect should be capable of recording:

- tenant
- link
- campaign/content attribution
- platform=shopee
- timestamp
- safe request metadata according to privacy policy
- correlation ID

before redirecting to the validated destination.

Do not create an open redirect.

Only previously validated destinations should be eligible.

Tracking failure behavior must follow existing fail-safe/fail-closed
repository contracts.

============================================================
13. CLICK REPORT INGESTION
============================================================

Prepare a pluggable Shopee TH Click Report importer.

It must support:

- explicit schema version/mapping;
- tenant isolation;
- idempotency;
- provenance;
- attribution correlation;
- deterministic errors;
- metrics.

Do not guess the production CSV schema if a real export fixture is unavailable.

If exact Click Report headers are unavailable:

1. implement the bounded importer interface;
2. implement schema recognition/fail-closed behavior;
3. document the missing external fixture;
4. do not claim the Click Report parser complete.

============================================================
14. ORDER REPORT INGESTION
============================================================

Apply the same principles to Shopee TH Order Reports.

Where supported by actual source evidence, normalize:

- provider order ID;
- product/order item identity;
- timestamps;
- order state;
- attribution;
- commission;
- source evidence.

Never synthesize an order that cannot be correlated to a provider/source
identity.

Updates must be idempotent and monotonic where provider lifecycle semantics
permit.

============================================================
15. PAYMENT REPORT INGESTION
============================================================

Implement/prepare payment reconciliation separately from order ingestion.

Payment state must not be inferred solely because an order is completed.

Preserve actual payment-report evidence.

Support reconciliation states such as repository conventions allow:

- unmatched
- matched
- discrepancy
- reconciled

Do not invent payout amounts.

============================================================
16. CONVERSION RECONCILIATION
============================================================

Reuse the existing conversion-reconciliation architecture.

Target:

Click
  
Order
  
Conversion
  
Commission
  
Payment

Reconciliation must be:

- tenant isolated;
- deterministic;
- auditable;
- repeatable;
- idempotent.

Ambiguous records must not be silently assigned.

Record discrepancy evidence.

============================================================
17. OPTIONAL SHOPEE OPEN API
============================================================

Open API is OPTIONAL.

CSV/datafeed/report operation must remain usable without Open API credentials.

Do not assume endpoints/signature contracts copied from another country are
valid for Shopee Thailand Affiliate.

Any API feature without verified contract must be:

- capability gated;
- disabled/fail closed by default;
- clearly documented.

Never commit:

- App Secret
- partner key
- access token
- refresh token
- cookie
- authenticated browser session

Use existing secret backend/configuration conventions.

============================================================
18. NO DASHBOARD SCRAPING
============================================================

Do not automate authenticated Shopee Affiliate pages using copied browser
cookies or sessions.

Preferred sources:

1. documented API with authorized credentials;
2. Shopee export/datafeed;
3. manually supplied report fixtures.

Never ask users to paste authentication cookies.

============================================================
19. REDIS + DURABLE OUTBOX
============================================================

Reuse existing Redis/outbox infrastructure where asynchronous processing is
appropriate.

Do not make Redis the sole durable source of commerce truth.

If ingestion/reconciliation produces downstream work:

database transaction
    
durable outbox
    
worker
    
downstream operation
    
acknowledgement

Preserve retry safety.

No double processing after retry/restart.

============================================================
20. API
============================================================

Follow existing API naming, versioning, auth and error conventions.

Potential surfaces should be introduced only when consistent with existing
architecture, for example:

- Shopee import initiation/status
- product/offer queries
- reconciliation status
- discrepancy reporting
- analytics

Every tenant-owned endpoint must enforce server-side tenant authorization.

Never trust tenant ownership supplied only by request body/query parameters.

Validate:

- body size;
- CSV size;
- content type;
- encoding;
- row count;
- required headers;
- URLs;
- numeric values.

Return canonical errors.

============================================================
21. ANALYTICS
============================================================

Expose analytics only from durable verified data.

Potential dimensions:

- clicks
- orders
- units
- GMV/order amount
- estimated commission
- reconciled commission
- paid commission
- conversion rate
- campaign
- content
- product
- shop
- time range

Clearly distinguish estimated and reconciled financial values.

Never present simulated CTR/ROAS/commission as observed production data.

============================================================
22. OBSERVABILITY
============================================================

Add repository-standard observability.

Useful metrics include:

- import batches
- imported rows
- rejected rows
- duplicate rows
- parser failures
- reconciliation matched/unmatched/discrepancy counts
- provider failures
- outbox retries

Avoid high-cardinality labels.

Logs must not contain:

- secrets;
- tokens;
- cookies;
- full sensitive payloads.

Health/readiness must accurately represent mandatory dependency state.

Optional Shopee API credentials must not make the entire application unhealthy
when CSV-only mode is intentionally configured.

============================================================
23. SECURITY
============================================================

Maintain or improve existing security posture.

Required properties:

- deny by default;
- tenant isolation;
- RLS;
- authorization on every protected operation;
- strict validation;
- parameterized SQL;
- safe URL handling;
- CSRF preservation where relevant;
- rate limiting;
- request size limits;
- secure errors;
- audit events;
- secret isolation.

Add regression tests for relevant abuse cases.

Do not weaken an invariant to make integration easier.

============================================================
24. TDD
============================================================

Use RED  GREEN  REFACTOR.

For every behavior:

1. write the smallest meaningful failing test;
2. run it;
3. confirm failure is caused by missing behavior;
4. implement minimal production code;
5. run focused test;
6. run relevant surrounding tests;
7. refactor only while green.

Never claim TDD if the test was never observed failing.

Priority tests:

- exact Thai product-feed mapping;
- BOM handling;
- UTF-8 Thai text;
- money parsing;
- percentage parsing;
- Thai sold-count parsing;
- invalid URL;
- missing headers;
- unknown schema;
- duplicate import;
- idempotent replay;
- tenant isolation;
- RLS;
- attribution;
- open-redirect prevention;
- commission provenance;
- reconciliation discrepancies.

============================================================
25. BOUNDED EXECUTION ORDER
============================================================

Do NOT implement the whole architecture in one giant commit.

Execute the next highest-priority incomplete bounded slice.

Recommended sequence:

SLICE 1
Shopee TH product-feed parser + fixtures + normalization tests.

SLICE 2
Durable products/offers schema + migration + RLS + repositories.

SLICE 3
Idempotent import batches + provenance/evidence.

SLICE 4
Affiliate-link persistence + attribution/Sub-ID internal model.

SLICE 5
/go/:slug Shopee attribution integration.

SLICE 6
Click Report contract/importer.

SLICE 7
Order Report contract/importer.

SLICE 8
Conversion + commission reconciliation.

SLICE 9
Payment Report reconciliation.

SLICE 10
Analytics/API.

SLICE 11
Observability + operator tooling.

SLICE 12
Security/performance/recovery hardening.

SLICE 13
Documentation + final release evidence.

At the beginning of every execution cycle:

- inspect current main;
- inspect existing feature PR;
- inspect exact branch/head;
- inspect latest CI;
- inspect unresolved review threads;
- determine the smallest incomplete slice.

Reuse an existing correct branch/PR instead of creating duplicate work.

============================================================
26. CI / VERIFICATION
============================================================

Before pushing a completion claim, run repository-standard verification.

At minimum inspect package.json/workflows and run the actual required commands.

Likely verification may include repository equivalents of:

npm test
npm run check
npm run lint
npm run security-check
npm run build

Do not assume these exact commands exist; inspect the repo first.

For database work, run service-backed PostgreSQL tests where required.

For Redis/outbox work, run service-backed Redis tests where required.

Verify:

- tests
- lint/static checks
- security
- migration checks
- build
- release checks
- CodeQL/workflows when available

Fresh evidence only.

Previous green CI does not prove a new HEAD is green.

============================================================
27. PR REQUIREMENTS
============================================================

PR description must explain:

- bounded scope;
- reason;
- architecture reused;
- schema/migrations;
- security implications;
- tenant/RLS implications;
- tests added;
- verification evidence;
- known limitations;
- rollback considerations;
- next bounded slice.

Do not describe unimplemented future work as completed.

============================================================
28. REVIEW FINDINGS
============================================================

Inspect all review threads.

For every unresolved legitimate finding:

- reproduce/understand it;
- add regression coverage where applicable;
- apply smallest safe fix;
- rerun focused verification;
- rerun required gates;
- resolve only after evidence supports resolution.

Do not mechanically accept technically incorrect review feedback.
Investigate first.

============================================================
29. MERGE GATE
============================================================

Merge ONLY if ALL are true:

[ ] PR is based on intended current main or has been safely reconciled
[ ] exact HEAD SHA identified
[ ] required CI checks are green for that exact HEAD
[ ] security gates are green
[ ] tests are green
[ ] migration/RLS verification is green where applicable
[ ] no unresolved blocking review threads
[ ] no known Critical/High release blocker introduced by this PR
[ ] no credentials/secrets introduced
[ ] PR scope remains bounded
[ ] documentation accurately describes implementation
[ ] rollback path is understood

If ANY item is false:

DO NOT MERGE.

Report the exact blocker and next action.

============================================================
30. PRODUCTION READY DEFINITION
============================================================

Do not equate "merged" with "Production Ready".

Shopee Thailand Affiliate may be called Production Ready only when the
end-to-end production-required scope has evidence for:

[ ] product/datafeed ingestion
[ ] schema validation
[ ] normalized products/offers
[ ] durable PostgreSQL persistence
[ ] RLS/tenant isolation
[ ] import idempotency
[ ] provenance
[ ] affiliate link lifecycle
[ ] attribution model
[ ] /go/:slug tracking
[ ] Click Report path using verified schema
[ ] Order Report path using verified schema
[ ] conversion reconciliation
[ ] commission reconciliation
[ ] Payment Report path if required for payout truth
[ ] analytics
[ ] Redis/outbox reliability where used
[ ] security controls
[ ] observability
[ ] operational documentation
[ ] migrations/rollback
[ ] deterministic tests
[ ] required CI/security gates
[ ] release evidence

External credentials or real Shopee export schemas that are unavailable must
be reported as external blockers rather than fabricated.

============================================================
31. REPORT FORMAT AFTER EVERY EXECUTION
============================================================

Return:

STATUS
- branch:
- HEAD:
- PR:
- current bounded slice:

INSPECTION
- main:
- existing implementation:
- CI:
- security:
- review threads:

IMPLEMENTED
- files:
- migrations:
- tests:
- docs:

VERIFICATION
- command:
- result:
- command:
- result:

SECURITY
- tenant isolation:
- RLS:
- secrets:
- validation:

PRODUCTION READINESS
- completed:
- incomplete:
- external blockers:

MERGE
- READY / BLOCKED / MERGED
- exact reason:

NEXT
- smallest next bounded action:

============================================================
32. CONTINUATION RULE
============================================================

If the current slice becomes fully verified and merged:

Do not stop merely because one PR merged.

Reinspect main and proceed to the next highest-priority bounded incomplete
Shopee Thailand Affiliate production slice.

Continue until:

A. all Production Ready gates have fresh evidence,

OR

B. progress requires external information/credentials/artifacts that cannot
   safely be inferred.

When blocked externally, stop at the exact boundary and report precisely what
artifact is required.

Never fabricate the missing evidence.

============================================================
33. FINAL RULE
============================================================

Evidence before assertion.

Secure behavior before convenience.

Existing architecture before duplication.

Tenant isolation before feature breadth.

Actual Shopee source data before assumptions.

Small verified PRs before giant changes.

Do not claim Production Ready until the repository itself proves it.