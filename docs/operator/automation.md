# Operator Handbook — Automation

The automation policy plane (`packages/automation/src/index.js`) is the single authority for autonomous behavior. Intelligence outputs are structurally incapable of acting outside it (`packages/intelligence/src/decision-gate.js`).

## Modes

`manual · assisted · draft_only · approval_required · auto_safe · autonomous`

Exact transition semantics are contract-tested (`test/automation-policy.test.js`, 17 cases). Default posture is fail-closed: empty allowlists DENY.

## Live controls over HTTP

```sh
# Inspect effective policy + active kill switches
curl -H 'x-tenant-id: T' https://zaffiliate.zeaz.dev/api/v1/automation/status

# Tighten policy
curl -X PUT -H 'x-tenant-id: T' -H 'content-type: application/json' \
  https://zaffiliate.zeaz.dev/api/v1/automation/policy \
  -d '{"mode":"approval_required","allowedPlatforms":["tiktok"],"maxPostsPerDay":5,"minimumQualityScore":70,"minimumComplianceScore":70}'

# Ask the gate whether an action may proceed (full OPT-004 chain incl. commercial revalidation)
curl -X POST -H 'x-tenant-id: T' -H 'content-type: application/json' \
  https://zaffiliate.zeaz.dev/api/v1/intelligence/gate -d '{"action":{...}}'
```

## Kill switches

Six scopes (global / provider / organization / campaign / publishing / AI). Activation takes effect without redeploy; every decision — including denials — is audited.

```sh
curl -X POST -H 'x-tenant-id: T' -H 'content-type: application/json' \
  https://zaffiliate.zeaz.dev/api/v1/automation/kill-switch \
  -d '{"scope":"publishing","id":"<provider-or-campaign-id>","active":true,"reason":"incident-1234"}'
```

Verify with `/api/v1/automation/status` → `activeKillSwitches`. Deactivate with `"active":false` once clear.

## Production ramp (do not skip)

L0 recommendations → L1 draft generation → L2 approval_required → L3 auto_safe → L4 limited autonomous. Advance one level at a time, with observation windows between.
