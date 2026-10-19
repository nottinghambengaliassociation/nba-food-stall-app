// Screenshots of every screen, both projects, empty and with orders.
// Definition of done: "Screenshots of every screen at both sizes in qa/screenshots/".
import { test, expect } from './session.js';
import {
  clearFirestore, seedReportDay, shot, tid, placeOrder,
  addItem, openCashPanel, closeCashPanel, isSmallCash
} from './helpers.js';

const SCREENS = [
  ['landing', '#/'],
  ['cash', '#/cash'],
  ['kitchen', '#/kitchen'],
  ['reports', '#/reports'],
  // Phase IV: the Orders list. The detail-panel shots are taken by P4-19 in
  // tests/e2e/reports-orders.spec.js, which has the scripted day seeded.
  ['reports-orders', '#/reports/orders']
];

test('screenshots: empty state', async ({ page }, info) => {
  await clearFirestore();
  for (const [name, route] of SCREENS) {
    await page.goto('/' + route);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1000);
    await shot(page, info.project.name, name, 'empty');
  }
});

test('screenshots: with orders', async ({ page }, info) => {
  await clearFirestore();
  await seedReportDay();

  // One live order built through the UI so the cash panel is populated too.
  await page.goto('/#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
  await placeOrder(page, { items: { fuchka: 2, momo: 1 }, name: 'Priya', payment: 'cash', tender: 2000 });
  await addItem(page, 'chat', 1);
  await addItem(page, 'choc_strawberry', 1);
  await page.waitForTimeout(400);
  if (isSmallCash(page)) {
    // H3: the cart lives behind the order bar below 700 px, so capture both
    // the menu with the bar up and the Review & send sheet.
    await shot(page, info.project.name, 'cash', 'orders');
    await openCashPanel(page);
    await tid(page, 'customer-name').fill('Sam');
    await page.waitForTimeout(500);
    await shot(page, info.project.name, 'cash', 'sheet');
    await closeCashPanel(page);
  } else {
    await tid(page, 'customer-name').fill('Sam');
    await page.waitForTimeout(600);
    await shot(page, info.project.name, 'cash', 'orders');
  }

  for (const [name, route] of SCREENS.filter(([n]) => n !== 'cash')) {
    await page.goto('/' + route);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1400);
    await shot(page, info.project.name, name, 'orders');
  }
});
