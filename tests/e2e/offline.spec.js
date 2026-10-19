// O-01..O-03 and persistence. Spec: CLAUDE.md Cash 6 (connection pill) and
// "Firestore with persistentLocalCache and persistentMultipleTabManager for offline writes".
import { test, expect } from './session.js';
import {
  clearFirestore, openApp, tid, placeOrder, waitForOrders, addItem, readCollection,
  isSmallCash, closeCashPanel
} from './helpers.js';

/**
 * Hotfix H3 (v1.3.1): below 700 px the recent-orders strip moved to
 * ☰ -> Recent orders (CLAUDE.md H3 6). Open it where it lives.
 */
async function openRecent(page) {
  if (!isSmallCash(page)) return;
  await closeCashPanel(page);
  if (await tid(page, 'recent-sheet').isVisible().catch(() => false)) return;
  await tid(page, 'menu-button').click();
  await tid(page, 'menu-recent').click();
  await expect(tid(page, 'recent-sheet')).toBeVisible({ timeout: 10000 });
}

test.beforeEach(async () => { await clearFirestore(); });

test('O-01 / O-02 an order placed offline queues, then reaches the kitchen when back online', async ({ browser }) => {
  const tillCtx = await browser.newContext();
  const kitchenCtx = await browser.newContext();
  const cash = await tillCtx.newPage();
  const kitchen = await kitchenCtx.newPage();

  await kitchen.goto('/#/kitchen');
  await expect(kitchen.locator('header').first()).toBeVisible({ timeout: 20000 });

  await cash.goto('/#/cash');
  await expect(cash.locator('[data-testid="tile-momo"]')).toBeVisible({ timeout: 20000 });
  await expect(cash.locator('[data-testid="conn-pill"]')).toContainText(/Online/i, { timeout: 15000 });

  await tillCtx.setOffline(true);
  await cash.evaluate(() => window.dispatchEvent(new Event('offline')));

  const no = await placeOrder(cash, { items: { momo: 2 }, name: 'Offline', payment: 'card' });
  expect(no, 'the order number is issued locally, the till never waits for the network').toBe('A-001');

  const pill = cash.locator('[data-testid="conn-pill"]');
  await expect(pill, 'CLAUDE.md Cash 6: "Offline · N queued"').toContainText(/Offline/i, { timeout: 15000 });
  await expect(pill).toContainText(/queued/i, { timeout: 15000 });

  await tillCtx.setOffline(false);
  await cash.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect(pill, 'the pill must go back to Online once the queue drains').toContainText(/Online/i, { timeout: 25000 });
  await waitForOrders((o) => o.some((x) => x.orderNo === 'A-001'), { timeout: 25000, label: 'the queued order to reach Firestore' });
  await expect(
    kitchen.locator('[data-testid="order-card-A-001"]'),
    'the queued order must arrive at the kitchen once back online'
  ).toBeVisible({ timeout: 20000 });

  await tillCtx.close();
  await kitchenCtx.close();
});

test('O-03 the app keeps working offline, serving the menu from the local cache', async ({ browser }) => {
  // Note: the document itself is fetched over HTTP, and Playwright's setOffline
  // blocks that too, so this checks in-app navigation rather than a full reload.
  // CLAUDE.md requires persistentLocalCache for offline *writes* and reads, not a
  // service worker.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/#/cash');
  await expect(page.locator('[data-testid="tile-momo"]')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(2000); // let the persistent cache settle

  await ctx.setOffline(true);
  await page.evaluate(() => { window.location.hash = '#/kitchen'; });
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.location.hash = '#/cash'; });

  await expect(
    page.locator('[data-testid="tile-momo"]'),
    'persistentLocalCache must serve the menu while offline'
  ).toBeVisible({ timeout: 25000 });
  await expect(page.locator('body')).not.toContainText('Storage not configured');
  // CLAUDE.md H3 3 hides the order bar (and with it the total) on an empty
  // small cart, so the empty-state check is the tile grid at that size.
  if ((page.viewportSize()?.width ?? 1280) < 700) {
    await expect(page.locator('[data-testid="order-bar"]')).toBeHidden();
  } else {
    await expect(page.locator('[data-testid="order-total"]')).toContainText('£0.00');
  }

  await ctx.setOffline(false);
  await ctx.close();
});

test('P-01 cash, kitchen and reports all survive a reload with data in place', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 20000 });
  await placeOrder(page, { items: { momo: 1, chat: 1 }, name: 'Persist', payment: 'cash', tender: 2000 });
  await waitForOrders((o) => o.length === 1, { label: 'the order to be written' });

  // Cash: the recent list comes back.
  await page.reload();
  await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 20000 });
  await openRecent(page);
  await expect(tid(page, 'recent-A-001')).toBeVisible({ timeout: 20000 });

  // Kitchen.
  await page.goto('/#/kitchen');
  await expect(tid(page, 'order-card-A-001')).toBeVisible({ timeout: 20000 });
  await page.reload();
  await expect(tid(page, 'order-card-A-001')).toBeVisible({ timeout: 20000 });

  // Reports.
  await page.goto('/#/reports');
  await expect(tid(page, 'kpi-orders')).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => (await tid(page, 'kpi-orders').innerText()).trim()).toMatch(/\b1\b/);
  await page.reload();
  await expect.poll(async () => (await tid(page, 'kpi-orders').innerText()).trim(), { timeout: 20000 }).toMatch(/\b1\b/);

  expect((await readCollection('orders')).length).toBe(1);
});

test('P-02 an unsent order in the panel does not create a document', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 20000 });
  await addItem(page, 'momo', 2);
  await page.waitForTimeout(800);
  expect((await readCollection('orders')).length, 'nothing is written until Send is tapped').toBe(0);
});
