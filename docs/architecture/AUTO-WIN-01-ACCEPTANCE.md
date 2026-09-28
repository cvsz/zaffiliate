# AUTO-WIN-01 — Windows shell acceptance

Implementation status: SCAFFOLD ONLY. This slice adds a Tauri 2 wrapper around the existing React/Vite frontend without replacing the Node.js API or changing provider integrations.

## Evidence required before marking COMPLETE

- [ ] `npm ci`, `npm run check`, `npm test`, `npm run build:web` on the exact PR SHA.
- [ ] Windows 11 MSVC/WebView2/Rust clean runner: `npm run desktop:build` produces an NSIS installer.
- [ ] Clean Windows install, open `/autopilot-review`, navigation, authenticated API session, logout and uninstall.
- [ ] Verify production CSP; current `csp: null` is a **release blocker**, not a security approval. Replace with tested least-privilege policy.
- [ ] Confirm no provider credentials in frontend bundle, binary, installer or logs.
- [ ] Review signed installer and secure updater design; no auto-update enabled by this scaffold.
- [ ] Verify offline/error UI when backend unavailable, proxy behavior in development and packaged API origin configuration. Current relative `/api` URLs need an authenticated production API origin or same-origin backend bridge; packaging alone does not supply it.
- [ ] Confirm Windows artifacts, installer rollback and release provenance.
- [ ] Confirm GitHub Code Scanning Alert #2 resolved or documented as release blocker.

## Rollback

Revert this additive scaffold and root package script additions. No schema or provider mutation.
