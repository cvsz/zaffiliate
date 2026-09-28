import { test, expect } from '@playwright/test';

const baseURL = process.env.LIVE_SITE_URL || 'https://zaff.zeaz.dev';

test('production control plane loads compiled UI without browser errors', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(baseURL + '/', { waitUntil: 'networkidle' });
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('script[src*="/src/main.jsx"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('login page has accessible labels and password handling', async ({ page }) => {
  const response = await page.goto(baseURL + '/login', { waitUntil: 'networkidle' });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: /operator sign in/i })).toBeVisible();
  await expect(page.getByLabel('Tenant ID')).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveAttribute('type', 'email');
  await expect(page.getByLabel('Password')).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});

test('SPA routes survive direct refresh and protected API denies anonymous tenant', async ({ page, request }) => {
  const dashboard = await page.goto(baseURL + '/dashboard', { waitUntil: 'domcontentloaded' });
  expect(dashboard?.status()).toBe(200);
  const api = await request.get(baseURL + '/api/ui/overview', {
    headers: { 'x-tenant-id': '11111111-1111-4111-8111-111111111111' }
  });
  expect(api.status()).toBe(401);
});

test('privacy and terms remain publicly reachable', async ({ request }) => {
  expect((await request.get(baseURL + '/privacy')).status()).toBe(200);
  expect((await request.get(baseURL + '/terms')).status()).toBe(200);
});
