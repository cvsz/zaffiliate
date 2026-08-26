#!/usr/bin/env node
// GM-B2b TikTok Shop live/sandbox probe — signs one read-only affiliate_seller
// request via the production signer and classifies the platform verdict.
// Requires: .env.tiktok-sandbox (access token) + TIKTOK_APP_KEY / TIKTOK_APP_SECRET env or flags.
import { readFileSync } from 'node:fs';
import { buildTikTokRequest } from '../packages/tiktok-shop/src/client.js';

function loadDotEnv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  } catch { /* absent */ }
  return out;
}

const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const sandboxEnv = loadDotEnv('.env.tiktok-sandbox');
const appKey = arg.appKey ?? process.env.TIKTOK_APP_KEY;
const appSecret = arg.appSecret ?? process.env.TIKTOK_APP_SECRET;
if (!appKey || !appSecret) {
  console.error('tiktok-probe: TIKTOK_APP_KEY / TIKTOK_APP_SECRET required (Shop Partner credentials)');
  process.exit(2);
}
const accessToken = arg.accessToken ?? sandboxEnv.TIKTOK_SHOP_ACCESS_TOKEN;
// NOTE: sandbox hosts vary by region/documentation generation and may not resolve
// from all networks; the production host is used by default since it returns
// authoritative per-app verdicts (e.g. 40006 no-schema when the app lacks the product).
const baseUrl = arg.baseUrl ?? 'https://open-api.tiktokglobalshop.com';
const path = arg.path ?? '/affiliate_seller/campaign/search';

const req = buildTikTokRequest({
  baseUrl,
  path,
  method: 'GET',
  query: { page_size: 10 },
  appKey,
  appSecret,
  accessToken
});

let status = 0;
let payload = null;
try {
  const res = await fetch(req.url, { method: req.method, headers: req.headers });
  status = res.status;
  payload = await res.json().catch(() => null);
} catch (error) {
  console.log(JSON.stringify({ classification: 'TRANSPORT_FAILURE', detail: String(error?.message ?? error) }));
  process.exit(1);
}

const code = Number(payload?.code ?? -1);
const message = String(payload?.message ?? '');
let classification = 'UNEXPECTED';
if (status === 200 && code === 0) classification = 'VERIFIED_OK';
else if ([401, 403].includes(status) || [40105, 10001, 10002, 10061].includes(code) || /token|authoriz/i.test(message)) classification = 'AUTH_EXPIRED_OR_FORBIDDEN';
else if ([4003, 10003].includes(code) || /sign/i.test(message)) classification = 'SIGNATURE_OR_APP_REJECTED';

console.log(JSON.stringify({
  probe: 'tiktokshop.sandbox',
  endpoint: path,
  httpStatus: status,
  platformCode: code,
  message: message.slice(0, 160),
  classification,
  verifiedAt: new Date().toISOString(),
  note: classification === 'VERIFIED_OK'
    ? 'live sandbox verification succeeded'
    : 'capability remains unverified; see RELEASE-READINESS.md B2'
}, null, 2));
