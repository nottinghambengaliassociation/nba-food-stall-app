// S-01..S-03 — live smoke against LIVE_URL. Skipped unless LIVE_SMOKE=1,
// so `npm run test:e2e` stays offline and deterministic.
// Run with:  LIVE_SMOKE=1 npx playwright test tests/e2e/live-smoke.spec.js
import { test, expect } from '@playwright/test';
import { attachConsole, realErrors, SHOTS } from './helpers.js';
import { resolve } from 'node:path';

const LIVE = process.env.LIVE_URL || 'https://nottinghambengaliassociation.github.io/nba-food-stall-app/';
const ROUTES = ['#/', '#/cash', '#/kitchen', '#/reports'];

test.skip(!process.env.LIVE_SMOKE, 'set LIVE_SMOKE=1 to run the live smoke test');
test.describe.configure({ mode: 'serial' });

test('S-01 every route loads on the live site with no console errors', async ({ page }, info) => {
  const errors = attachConsole(page);
  for (const route of ROUTES) {
    const name = route === '#/' ? 'landing' : route.replace('#/', '');
    await page.goto(LIVE + route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header').first(), `${route} did not render on the live site`).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: resolve(SHOTS, `live-${info.project.name}-${name}.png`), fullPage: true });
  }
  const real = realErrors(errors);
  expect(real, `console errors on the live site:\n${real.join('\n')}`).toEqual([]);
});

test('S-02 the connection pill or the "Storage not configured" banner is shown', async ({ page }) => {
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const pill = page.locator('[data-testid="conn-pill"]');
  const banner = page.getByText(/storage not configured/i);
  const configured = (await pill.count()) > 0 && (await pill.first().isVisible());
  const unconfigured = (await banner.count()) > 0;
  expect(
    configured || unconfigured,
    'CLAUDE.md: the cash screen shows a connection pill, or a clear "Storage not configured" banner instead of crashing'
  ).toBe(true);
  if (configured && !unconfigured) {
    await expect(pill.first()).toContainText(/Online/i, { timeout: 20000 });
  }
});

test('S-03 QA-SMOKE order round trip (only when real Firebase is configured)', async ({ page }) => {
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const banner = page.getByText(/storage not configured/i);
  test.skip((await banner.count()) > 0, 'live Firebase is not configured; QA-SMOKE order skipped');

  const tile = page.locator('[data-testid="tile-momo"]');
  await expect(tile).toBeVisible({ timeout: 30000 });

  // Order 1: take it all the way to Collected.
  await tile.click();
  await page.locator('[data-testid="customer-name"]').fill('QA-SMOKE');
  await page.locator('[data-testid="pay-card"]').click();
  await page.locator('[data-testid="send-order"]').click();
  const toast = page.locator('[data-testid="order-toast"]');
  await expect(toast).toBeVisible({ timeout: 20000 });
  const first = ((await toast.innerText()).match(/[A-Z]-\d{3}/) || [])[0];
  expect(first, 'the live till must issue an order number').toBeTruthy();

  await page.goto(LIVE + '#/kitchen', { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 3; i++) {
    const action = page.locator(`[data-testid="action-${first}"]`);
    await expect(action, `step ${i + 1} for ${first}`).toBeVisible({ timeout: 25000 });
    await action.click();
    await page.waitForTimeout(1200);
  }
  await expect(page.locator(`[data-testid="order-card-${first}"]`)).toHaveCount(0, { timeout: 20000 });

  // Order 2: cancel it from the till.
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await expect(tile).toBeVisible({ timeout: 25000 });
  await tile.click();
  await page.locator('[data-testid="customer-name"]').fill('QA-SMOKE');
  await page.locator('[data-testid="pay-card"]').click();
  await page.locator('[data-testid="send-order"]').click();
  await expect(toast).toBeVisible({ timeout: 20000 });
  const second = ((await toast.innerText()).match(/[A-Z]-\d{3}/) || [])[0];

  const cancel = page.locator(`[data-testid="cancel-${second}"]`);
  await expect(cancel).toBeVisible({ timeout: 20000 });
  await cancel.click();
  await expect(page.locator(`[data-testid="recent-${second}"]`)).toContainText(/cancel/i, { timeout: 20000 });
});
