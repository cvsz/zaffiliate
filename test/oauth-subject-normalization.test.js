import test from 'node:test';
import assert from 'node:assert/strict';
import { createOAuthFlow } from '../packages/security/src/oauth.js';

function flow(responseJson) {
  return createOAuthFlow({
    provider: 'acme',
    clientId: 'client',
    clientSecret: 'secret',
    authorizeUrl: 'https://idp.example/authorize',
    tokenUrl: 'https://idp.example/token',
    redirectUri: 'https://app.example/api/v1/oauth/acme/callback',
    scope: 'read',
    transport: async () => ({ status: 200, json: responseJson }),
    clock: () => 1_760_000_000_000
  });
}

test('oauth token normalization preserves common provider account identifiers', async () => {
  for (const [field, value] of [
    ['provider_account_id', 'acct-provider'],
    ['account_id', 'acct-generic'],
    ['open_id', 'open-tiktok-style'],
    ['user_id', 123456],
    ['sub', 'oidc-subject']
  ]) {
    const f = flow({ access_token: 'access', [field]: value });
    const authorization = f.createAuthorization();
    const tokens = await f.exchangeCode({ authorization, code: 'grant' });
    assert.equal(tokens.providerAccountId, String(value), `expected ${field} to become providerAccountId`);
  }
});

test('oauth token normalization leaves providerAccountId null when provider does not identify the account', async () => {
  const f = flow({ access_token: 'access' });
  const tokens = await f.exchangeCode({ authorization: f.createAuthorization(), code: 'grant' });
  assert.equal(tokens.providerAccountId, null);
});
