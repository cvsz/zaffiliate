# Production Closure Authorization

**Authorized:** 2026-09-05  
**Repository:** `cvsz/zaffiliate`  
**Authorized by:** repository owner via explicit chat instruction: “approve do all next”

## Scope of authorization

The release owner authorizes execution of the remaining production-closure plan, including reversible validation, shadow cutover, production traffic enablement, release-candidate creation, Gold Master decision, production deployment/smoke, and legacy retirement **when and only when each preceding evidence gate has actually passed**.

This authorization does not convert a failed, missing, future, or externally blocked prerequisite into PASS.

## Current gate state at authorization

- Main CI on closure-plan baseline: PASS.
- CodeQL on closure-plan baseline: PASS.
- B2 live provider credentials/approval: BLOCKED_EXTERNAL.
- B7 object-storage write permission: BLOCKED_EXTERNAL.
- Production traffic enablement: AUTHORIZED_CONDITIONALLY, not executable until B2/B7 and pre-cutover evidence pass.
- Gold Master: AUTHORIZED_CONDITIONALLY, not approvable until all mandatory gates pass.
- Legacy retirement: AUTHORIZED_CONDITIONALLY, not executable until production release is healthy for the required seven-day observation window and archive/restore/zero-dependency evidence passes.
- Signing: requires an available authorized private signing key; no key material may be committed or fabricated.

## Execution semantics

1. Continue automatically through every gate for which the required runtime, credentials, permissions, and evidence are available.
2. Fail closed on missing credentials, provider approval, storage write permission, signing key, or runtime access.
3. Do not fabricate provider, storage, deployment, attestation, observation-window, or retirement evidence.
4. A conditional authorization becomes executable only when its prerequisite evidence is green.
5. Any failed gate triggers the documented rollback/stop path rather than bypass.

## Next unblock

The critical path remains B2 + B7. Once those external prerequisites are provisioned in the production secret/runtime environment, execute the live probes and continue through EP-11 → shadow cutover → traffic enable → RC → Gold Master → release/smoke → attestation → seven-day observation → retirement.
