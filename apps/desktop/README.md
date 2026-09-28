# ZEAZ Affiliate Autopilot — Windows shell (AUTO-WIN-01)

This is an **unverified Tauri 2 scaffold** for the existing React/Vite control plane. It does not enable platform publishing, embed OAuth secrets, or start the production API. Run the existing Node API separately.

Prerequisites: Windows 11, Node.js 22+, Rust stable (MSVC), Microsoft C++ Build Tools with the Desktop development with C++ workload, Windows SDK and WebView2.

Recommended from repository root: `pwsh -NoProfile -File .\\scripts\\bootstrap-windows.ps1` (or `powershell -NoProfile -File .\\scripts\\bootstrap-windows.ps1` for Windows PowerShell 5.1). Add `-InstallPrerequisites` to request winget installation of Node/Rust/Git, or `-BuildDesktop` to attempt an unsigned NSIS build. The bootstrap is fail-fast and never deploys or publishes content. Tauri CLI is a development dependency, not a production runtime dependency.

From repository root, install the existing web dependencies; then run the desktop CLI in its own package:

```powershell
npm ci
cd apps/desktop
npm install
npm run dev
npm run build
```

**Known bootstrap blocker:** the current Tauri beforeDevCommand calls the missing root `dev:web` npm script; `npm run dev` may fail until that root command is implemented and validated in Windows CI. The desktop package lockfile must be committed after dependency resolution on a trusted development machine. CI should use `npm ci` in both locations once that lockfile exists.

The development shell uses Vite on http://127.0.0.1:3000. Vite proxies /api to http://127.0.0.1:8080; start the API separately with `npm start` or the documented Compose stack. **Do not point this shell at production accounts until security review.**

Build output is an **unsigned** Windows installer candidate. Code-signing, updater, clean-host install/upgrade/uninstall and Windows CI evidence remain release blockers. Review `docs/architecture/AUTOPILOT-DESKTOP-REVIEW-TODOS.md` before release.

Security: no shell, filesystem, HTTP, opener or arbitrary IPC plugin permissions are granted. Provider tokens remain on the backend. Production CSP and authenticated session handoff require an explicit review before shipping. The static frontend build is bundled; this is not a remote-code desktop shell.
