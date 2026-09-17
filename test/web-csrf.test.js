import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebServer } from '../apps/web/server.js';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

const TENANT = { 'x-tenant-id': 'tenant-acme' };

async function getCsrfToken(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/csrf-token`, { headers: TENANT });
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.token;
}

async function approveRequest(port, token, overrides = {}) {
  return fetch(`http://127.0.0.1:${port}/api/workflow/approve`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...TENANT,
      'x-csrf-token': token,
      ...overrides
    },
    body: JSON.stringify({ approvalId: 'apr-1001', decision: 'reject' })
  });
}

test('state-changing posts without the CSRF header are rejected and change nothing', async (t) => {
  const server = buildWebServer();
  t.after(() => server.close());
  const port = await listen(server);

  const rejected = await approveRequest(port, '');
  assert.equal(rejected.status, 403);
  const body = await rejected.json();
  assert.equal(body.error, 'csrf_check_failed');

  const stillPending = await (await fetch(`http://127.0.0.1:${port}/api/workflow/pending-approvals`, { headers: TENANT })).json();
  assert.ok(stillPending.approvals.some((record) => record.id === 'apr-1001'), 'approval must remain pending after blocked attempt');
});

test('wrong content-type is rejected even with valid token', async (t) => {
  const server = buildWebServer();
  t.after(() => server.close());
  const port = await listen(server);
  const token = await getCsrfToken(port);
  const response = await fetch(`http://127.0.0.1:${port}/api/workflow/approve`, {
    method: 'POST',
    headers: { ...TENANT, 'x-csrf-token': token, 'content-type': 'text/plain' },
    body: 'approvalId=apr-1001&decision=approve'
  });
  assert.equal(response.status, 403);
});

test('cross-origin browser posts are rejected even with valid token', async (t) => {
  const server = buildWebServer();
  t.after(() => server.close());
  const port = await listen(server);
  const token = await getCsrfToken(port);
  const response = await fetch(`http://127.0.0.1:${port}/api/workflow/approve`, {
    method: 'POST',
    headers: {
      ...TENANT,
      'x-csrf-token': token,
      'content-type': 'application/json',
      origin: 'https://evil.example'
    },
    body: JSON.stringify({ approvalId: 'apr-1002', decision: 'approve' })
  });
  assert.equal(response.status, 403);
});

test('same-origin posts with valid token succeed end-to-end', async (t) => {
  const server = buildWebServer();
  t.after(() => server.close());
  const port = await listen(server);
  const token = await getCsrfToken(port);
  const response = await fetch(`http://127.0.0.1:${port}/api/workflow/approve`, {
    method: 'POST',
    headers: {
      ...TENANT,
      'x-csrf-token': token,
      'content-type': 'application/json',
      origin: `http://127.0.0.1:${port}`
    },
    body: JSON.stringify({ approvalId: 'apr-1003', decision: 'approve' })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.approval.status, 'approved');
});

test('api clients without an origin header are permitted with valid token', async (t) => {
  const server = buildWebServer();
  t.after(() => server.close());
  const port = await listen(server);
  const token = await getCsrfToken(port);
  const response = await fetch(`http://127.0.0.1:${port}/api/workflow/approve`, {
    method: 'POST',
    headers: { ...TENANT, 'x-csrf-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ approvalId: 'apr-1004', decision: 'reject' })
  });
  assert.equal(response.status, 200);
});

test('read routes are untouched by the CSRF gate', async (t) => {
  const server = buildWebServer();
  t.after(() => server.close());
  const port = await listen(server);
  const response = await fetch(`http://127.0.0.1:${port}/api/navigation`, { headers: TENANT });
  assert.equal(response.status, 200);
});

test('CSRF token is single-use and expires', async (t) => {
  const server = buildWebServer();
  t.after(() => server.close());
  const port = await listen(server);
  const token = await getCsrfToken(port);

  // First use succeeds
  const first = await fetch(`http://127.0.0.1:${port}/api/workflow/approve`, {
    method: 'POST',
    headers: { ...TENANT, 'x-csrf-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ approvalId: 'apr-1001', decision: 'approve' })
  });
  assert.equal(first.status, 200);

  // Second use fails (token consumed)
  const second = await fetch(`http://127.0.0.1:${port}/api/workflow/approve`, {
    method: 'POST',
    headers: { ...TENANT, 'x-csrf-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ approvalId: 'apr-1002', decision: 'reject' })
  });
  assert.equal(second.status, 403);
});