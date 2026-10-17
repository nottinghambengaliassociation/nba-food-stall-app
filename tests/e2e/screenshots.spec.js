// Screenshots of every screen, both projects, empty and with orders.
// Definition of done: "Screenshots of every screen at both sizes in qa/screenshots/".
import { test, expect } from '@playwright/test';
import { clearFirestore, seedReportDay, shot, tid, placeOrder } from './helpers.js';

const SCREENS = [
  ['landing', '#/'],
  ['cash', '#/cash'],
  ['kitchen', '#/kitchen'],
  ['reports', '#/reports']
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
  await tid(page, 'tile-chat').click();
  await tid(page, 'tile-straw').click();
  await tid(page, 'customer-name').fill('Sam');
  await page.waitForTimeout(600);
  await shot(page, info.project.name, 'cash', 'orders');

  for (const [name, route] of SCREENS.filter(([n]) => n !== 'cash')) {
    await page.goto('/' + route);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1400);
    await shot(page, info.project.name, name, 'orders');
  }
});
