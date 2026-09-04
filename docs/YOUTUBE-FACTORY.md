# ZEAZ YouTube Factory v1

Production contract for turning ZEAZDEV research into original, reviewable YouTube content without bypassing human approval.

## Operating model

Pipeline:

`topic discovery -> evidence/research -> brief -> original script -> long-form package + Shorts derivatives -> media render -> quality/compliance gate -> human approval -> schedule/upload -> analytics -> learning loop`

Default channel strategy:

- Language: Thai first; English is a separate localization, never a blind machine translation.
- Pillars: AI & Automation; Software & Developer; Technology & Business.
- Cadence target: 1 long-form + up to 3 Shorts per publishing day. This is a planning target, not an unconditional auto-publish rule.
- Long-form: practical explanation, build/demo, case study, benchmark, or engineering narrative.
- Shorts: independently useful derivatives with a distinct hook and takeaway; never simple duplicate crops.
- CTA: relevant ZEAZDEV product/site or source material only when it naturally fits.

## Safety and monetization quality gates

Every candidate MUST:

1. be based on attributable research/evidence and avoid invented claims;
2. add original narration, analysis, demonstration, editing, or commentary;
3. reject copied/reused scripts, mass-produced near-duplicates, misleading titles/thumbnails, and unsupported financial/performance claims;
4. disclose sponsorship/affiliate relationships when applicable;
5. pass copyright/license checks for music, footage, images, and voice assets;
6. contain no secrets, credentials, private customer data, or internal-only URLs;
7. remain DRAFT_ONLY until an explicit human approval reference exists;
8. use official/authorized provider APIs for upload and analytics.

No automation may manufacture views, clicks, likes, comments, subscribers, watch time, or ad interactions.

## Content brief schema

Each job should persist:

- `topic`, `pillar`, `language`, `audience`, `searchIntent`
- `sources[]` with URL/reference, retrieved timestamp, claim/evidence notes
- `angle`, `hook`, `promise`, `outline[]`
- `script`, `shotList[]`, `broll[]`, `voiceover`, `captions`
- `titleCandidates[]`, `description`, `chapters[]`, `tags[]`
- `thumbnailBrief` and truthful thumbnail text
- `shorts[]` with independent hook/body/CTA
- `qualityScore`, `originalityEvidence`, `rightsEvidence[]`
- `approvalRef`, `scheduledAt`, `publicationJobId`
- post-publication metrics and experiment identifiers

## Topic scoring

Use a deterministic 0-100 score:

- audience/search relevance: 25
- ZEAZDEV authority/experience: 20
- freshness: 15
- educational utility: 15
- visual/demo potential: 10
- conversion relevance: 10
- production effort efficiency: 5

Reject a topic when evidence is weak or it depends on unverifiable claims even if the score is high.

## Rendering

The existing MoneyPrinterTurbo integration is the default self-hosted render provider. Rendering is a side-effect-free preparation step: output must be reviewed before publication. Prefer original screen recordings, diagrams, generated visuals with appropriate rights, licensed assets, and original narration.

Required outputs:

- 16:9 long-form master
- 9:16 Shorts masters
- SRT/VTT captions
- thumbnail asset
- metadata JSON
- provenance/rights manifest

## YouTube integration

`YOUTUBE_CREDENTIALS_REF` is a server-side credential reference only. Never commit OAuth tokens.

Provider completion requires:

- OAuth authorization and refresh/revocation lifecycle
- channel identity verification
- resumable video upload
- metadata/status update
- thumbnail upload
- playlist assignment when configured
- scheduled publishing/private-draft support
- analytics ingestion
- quota accounting and typed retry/backoff
- idempotent publication jobs
- REAUTH_REQUIRED on revoked/invalid credentials

Until those live-provider requirements are verified, the factory MUST stop at an approved render/package and must not claim production upload readiness.

## Analytics learning loop

Collect authorized YouTube Analytics metrics after publication and compare by pillar, format, hook, duration, and experiment:

- impressions and CTR
- views
- average view duration / percentage viewed
- audience retention signals when available
- subscribers attributable to content where available

Optimization changes future topic/title/thumbnail recommendations only. It must never rewrite historical evidence or automatically republish failed content without policy approval.

## Definition of done

v1 is complete only when:

- deterministic unit tests cover topic scoring and gates;
- render package generation is repeatable;
- human approval is fail-closed;
- YouTube OAuth/upload/analytics are verified with the real ZEAZDEV channel;
- one private/unlisted end-to-end canary uploads successfully;
- thumbnail/captions/metadata are verified on the canary;
- analytics can be read back;
- revocation, quota exhaustion, retry, idempotency, and kill-switch paths are tested;
- the first public video is explicitly approved by a human.
