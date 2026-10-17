// S-01..S-03 — live smoke against LIVE_URL. Skipped unless LIVE_SMOKE=1,
// so `npm run test:e2e` stays offline and deterministic.
// Run with:  LIVE_SMOKE=1 npx playwright test tests/e2e/live-smoke.spec.js
//
// This hits the REAL shared Firestore, not the emulator. Nothing here deletes
// anything: the two QA-SMOKE orders it creates are left in place for Trinity.
import { test, expect } from '@playwright/test';
import { attachConsole, realErrors, SHOTS } from './helpers.js';
import { resolve } from 'node:path';
import { appendFileSync } from 'node:fs';

const LIVE = process.env.LIVE_URL || 'https://nottinghambengaliassociation.github.io/nba-food-stall-app/';
const ROUTES = ['#/', '#/cash', '#/kitchen', '#/reports'];
// The order-placing test writes to the real project, so run it once, not once
// per viewport. Tablet is the shape a till actually runs on.
const WRITE_PROJECT = 'tablet';

function record(line) {
  // eslint-disable-next-line no-console
  console.log(`[LIVE-SMOKE] ${line}`);
  try { appendFileSync(resolve(SHOTS, '../live-smoke-record.txt'), line + '\n'); } catch { /* ignore */ }
}

test.skip(!process.env.LIVE_SMOKE, 'set LIVE_SMOKE=1 to run the live smoke test');
test.describe.configure({ mode: 'serial' });

test('S-01 every route loads on the live site with no console errors', async ({ page }, info) => {
  const errors = attachConsole(page);
  for (const route of ROUTES) {
    const name = route === '#/' ? 'landing' : route.replace('#/', '');
    await page.goto(LIVE + route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header').first(), `${route} did not render on the live site`).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: resolve(SHOTS, `live-${info.project.name}-${name}.png`), fullPage: true });
  }
  const real = realErrors(errors);
  record(`S-01 ${info.project.name}: ${ROUTES.length} routes loaded, ${real.length} console errors${real.length ? ': ' + real.join(' | ') : ''}`);
  if (errors.length) record(`S-01 ${info.project.name} raw console output (incl. ignored noise): ${errors.join(' | ')}`);
  expect(real, `console errors on the live site:\n${real.join('\n')}`).toEqual([]);
});

test('S-02 the connection pill reads Online and the config banner is absent', async ({ page }, info) => {
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const banner = page.getByText(/storage not configured/i);
  const bannerShown = (await banner.count()) > 0;
  record(`S-02 ${info.project.name}: "Storage not configured" banner present = ${bannerShown}`);
  expect(bannerShown, 'the deployed firebase-config.js must be wired up, so the banner must be absent').toBe(false);

  const pill = page.locator('[data-testid="conn-pill"]');
  await expect(pill.first(), 'the cash screen must show a connection pill').toBeVisible({ timeout: 20000 });
  await expect(pill.first()).toContainText(/Online/i, { timeout: 25000 });
  const pillText = (await pill.first().innerText()).replace(/\s+/g, ' ').trim();
  record(`S-02 ${info.project.name}: connection pill reads "${pillText}"`);
  await page.screenshot({ path: resolve(SHOTS, `live-${info.project.name}-cash-pill.png`), fullPage: false });
});

test('S-03 QA-SMOKE order round trip against the real project', async ({ page }, info) => {
  test.skip(info.project.name !== WRITE_PROJECT, `writes to the real project run once, on ${WRITE_PROJECT} only`);

  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const banner = page.getByText(/storage not configured/i);
  test.skip((await banner.count()) > 0, 'live Firebase is not configured; QA-SMOKE order skipped');

  const tile = page.locator('[data-testid="tile-momo"]');
  await expect(tile, 'the live menu must render (seeded on first load if empty)').toBeVisible({ timeout: 30000 });

  const day = await page.evaluate(() => {
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
    return `${p.year}-${p.month}-${p.day}`;
  });
  record(`S-03 London day for the smoke orders: ${day}`);

  const send = async (name) => {
    await tile.click();
    await page.locator('[data-testid="customer-name"]').fill(name);
    await page.locator('[data-testid="pay-card"]').click();
    await page.locator('[data-testid="send-order"]').click();
    const toast = page.locator('[data-testid="order-toast"]');
    await expect(toast).toBeVisible({ timeout: 25000 });
    const no = ((await toast.innerText()).match(/[A-Z]-\d{3}/) || [])[0];
    expect(no, 'the live till must issue an order number').toBeTruthy();
    return no;
  };

  // Order 1: all the way to Collected.
  const first = await send('QA-SMOKE');
  record(`S-03 created order 1: ${first} name=QA-SMOKE payment=card day=${day} (taken to collected)`);
  await page.screenshot({ path: resolve(SHOTS, 'live-cash-qa-smoke-sent.png'), fullPage: false });

  await page.goto(LIVE + '#/kitchen', { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`[data-testid="order-card-${first}"]`), `${first} must reach the live kitchen`).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: resolve(SHOTS, 'live-kitchen-qa-smoke.png'), fullPage: false });

  for (const step of ['Start', 'Ready', 'Collected']) {
    const action = page.locator(`[data-testid="action-${first}"]`);
    await expect(action, `${step} for ${first}`).toBeVisible({ timeout: 30000 });
    await action.click();
    await page.waitForTimeout(1500);
  }
  await expect(
    page.locator(`[data-testid="order-card-${first}"]`),
    'a collected order must leave the live kitchen board'
  ).toHaveCount(0, { timeout: 25000 });
  record(`S-03 ${first} reached collected and left the kitchen board`);

  // Order 2: cancelled from the till.
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await expect(tile).toBeVisible({ timeout: 30000 });
  const second = await send('QA-SMOKE');
  record(`S-03 created order 2: ${second} name=QA-SMOKE payment=card day=${day} (to be cancelled)`);

  const cancel = page.locator(`[data-testid="cancel-${second}"]`);
  await expect(cancel, 'cancel must be available while the live order is new').toBeVisible({ timeout: 25000 });
  await cancel.click();
  await expect(page.locator(`[data-testid="recent-${second}"]`)).toContainText(/cancel/i, { timeout: 25000 });
  record(`S-03 ${second} cancelled from the recent strip`);
  await page.screenshot({ path: resolve(SHOTS, 'live-cash-qa-smoke-cancelled.png'), fullPage: false });

  // The collected order counts, the cancelled one does not.
  await page.goto(LIVE + '#/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="kpi-orders"]')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);
  const orders = (await page.locator('[data-testid="kpi-orders"]').innerText()).trim();
  const sales = (await page.locator('[data-testid="kpi-sales"]').innerText()).trim();
  record(`S-03 live reports for ${day}: orders=${orders} sales=${sales} (cancelled ${second} must be excluded)`);
  await page.screenshot({ path: resolve(SHOTS, 'live-reports-qa-smoke.png'), fullPage: true });
  expect(orders, 'the cancelled order must not be counted').toMatch(/\b1\b/);
});
