// L-01..L-05 — landing page and till letter. Spec: CLAUDE.md route table
// ("#/ Landing page with three big buttons to the above, plus till letter setting").
import { test, expect } from './session.js';
import {
  clearFirestore, openApp, tid, heightOf, expectNoConsoleErrors, setTill, placeOrder, waitForOrders
} from './helpers.js';

test.beforeEach(async () => { await clearFirestore(); });

test('L-01 three big navigation buttons are present and large enough', async ({ page }) => {
  const errors = await openApp(page, '#/');
  for (const name of ['nav-cash', 'nav-kitchen', 'nav-reports']) {
    const el = tid(page, name);
    await expect(el, `${name} is missing from the landing page`).toBeVisible();
    const h = await heightOf(el);
    expect(h, `${name} is ${h}px tall; CLAUDE.md requires touch targets of at least 48px`).toBeGreaterThanOrEqual(47.5);
  }
  await expectNoConsoleErrors(errors, '#/');
});

test('L-02 each button routes to its screen', async ({ page }) => {
  await openApp(page, '#/');
  // The cash counter's marker is a menu tile: hotfix H3 hides the order panel
  // (and with it `send-order`) behind the order bar below 700 px.
  const routes = [
    ['nav-cash', '#/cash', 'tile-fuchka'],
    ['nav-kitchen', '#/kitchen', null],
    ['nav-reports', '#/reports', 'report-date']
  ];
  for (const [button, hash, marker] of routes) {
    await page.evaluate(() => { window.location.hash = '#/'; });
    await page.waitForTimeout(200);
    await tid(page, button).click();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(hash);
    if (marker) await expect(tid(page, marker)).toBeVisible({ timeout: 15000 });
  }
});

test('L-03 till letter defaults to A', async ({ page }) => {
  await openApp(page, '#/');
  const control = tid(page, 'till-letter');
  await expect(control).toBeVisible();
  const value = await control.evaluate((el) => (el.value !== undefined && el.value !== '' ? el.value : el.textContent).trim());
  expect(value, 'CLAUDE.md: "Till letter is set on the landing page (default A)"').toBe('A');
});

test('L-04 till letter persists and drives the order number', async ({ page }) => {
  await openApp(page, '#/');
  await setTill(page, 'B');

  const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
  expect(stored, 'the till letter must be stored in localStorage').toContain('B');

  await page.reload();
  await expect.poll(async () => {
    const el = tid(page, 'till-letter');
    return el.evaluate((n) => (n.value !== undefined && n.value !== '' ? n.value : n.textContent).trim());
  }).toBe('B');

  await page.evaluate(() => { window.location.hash = '#/cash'; });
  await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 15000 });
  const no = await placeOrder(page, { items: { momo: 1 }, name: 'Till B', payment: 'card' });
  expect(no, 'an order from till B must be numbered B-001').toBe('B-001');
  await waitForOrders((o) => o.some((x) => x.orderNo === 'B-001' && x.till === 'B'), { label: 'B-001 written with till B' });
});

test('L-05 deep link straight to a screen works', async ({ page }) => {
  const errors = await openApp(page, '#/kitchen');
  await expect(page.locator('header').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/kitchen');
  await expectNoConsoleErrors(errors, '#/kitchen deep link');
});

test('L-06 an unknown route does not crash the app', async ({ page }) => {
  const errors = await openApp(page, '#/does-not-exist');
  await expect(page.locator('header').first()).toBeVisible();
  await expectNoConsoleErrors(errors, '#/does-not-exist');
});
