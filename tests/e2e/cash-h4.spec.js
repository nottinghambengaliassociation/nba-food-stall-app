/**
 * H4-* — Hotfix H4 (v1.3.2): "Card is the default payment".
 *
 * Spec: CLAUDE.md -> "Hotfix H4: Card is the default payment (v1.3.2)":
 *   1. Every new order starts with Card selected, on every layout (tablet /
 *      desktop panel and the phone Review & send sheet): on first load, after
 *      Send, after Clear order, and when the cart empties. The choice is not
 *      remembered between orders.
 *   2. Tapping Cash works as today and shows Cash received (optional).
 *      Tapping Card again hides and resets it.
 *   3. Nothing else changes: order data, reports and CSV are unaffected
 *      (`payment` is still "cash" or "card").
 *
 * Plan: qa/test-plan.md section 43.
 *
 * WHERE IT RUNS. "on every layout", so this file runs on `tablet` (1280x800),
 * `phone` (390x844) and the H3 small phone `iphone13` (390x664, added to that
 * project's testMatch in playwright.config.js). The sheet-only cases skip at
 * 700 px and wider, and the always-open-panel cases skip below it.
 *
 * Emulator only. Nothing here touches live Firestore.
 */
import { test, expect } from './session.js';
import {
  clearFirestore, openApp, tid, addItem, waitForOrders, readCollection,
  openCashPanel, closeCashPanel, isSmallCash, selectPayment,
  cashReceivedVisible, quickTender, otherAmount, tenderText,
  expectNoConsoleErrors, shot
} from './helpers.js';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

/** Open #/cash and wait for the tiles. */
async function openCash(page) {
  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(300);
  return errors;
}

/** aria-pressed on both payment buttons, as a pair. */
async function pressed(page) {
  return {
    cash: await tid(page, 'pay-cash').getAttribute('aria-pressed'),
    card: await tid(page, 'pay-card').getAttribute('aria-pressed')
  };
}

/** CLAUDE.md H4 1: the order panel / sheet is on Card with no Cash received. */
async function expectOnCard(page, where) {
  expect(await pressed(page),
    `CLAUDE.md H4 1: ${where}, the order must start with Card selected`
  ).toEqual({ cash: 'false', card: 'true' });
  expect(await cashReceivedVisible(page),
    `CLAUDE.md H4 1-2: ${where}, Card is selected so Cash received must not be on screen`
  ).toBe(false);
}

/** The "Change ..."/"Short ..." wording for this viewport. */
const changeWord = (page, amount) =>
  isSmallCash(page) ? `Change £${amount}` : `Change to give: £${amount}`;

test.beforeEach(async () => { await clearFirestore(); });

/* ------------------------------------------------------------------ H4-01 */

test('H4-01 a fresh cash counter starts on Card with no Cash received', async ({ page }) => {
  const errors = await openCash(page);

  if (!isSmallCash(page)) {
    // The tablet panel is always open, so the toggle is readable before a
    // single tile is tapped.
    await expectOnCard(page, 'on first load with an empty cart');
  }

  // And with something in the cart, which is when the panel has a live order.
  await addItem(page, 'fuchka', 3);
  await openCashPanel(page);
  await expect(tid(page, 'order-total')).toContainText('£15.00');
  await expectOnCard(page, 'on first load with items in the cart');

  // The Cash received wording is nowhere on the screen either. `innerText`
  // ignores hidden subtrees, so this reads what the volunteer can actually see.
  const onScreen = norm(await page.locator('body').innerText());
  expect(onScreen, 'with Card selected nothing of the Cash received block is visible')
    .not.toMatch(/Cash received/i);

  await expectNoConsoleErrors(errors, '#/cash on first load (H4)');
});

/* ------------------------------------------------------------------ H4-02 */

test('H4-02 Cash reveals the calculator, Card hides and resets it', async ({ page }) => {
  const errors = await openCash(page);
  await addItem(page, 'fuchka', 3);           // £15.00
  await openCashPanel(page);
  await expectOnCard(page, 'before any payment tap');

  // Tapping Cash selects it and shows Cash received (H4 2).
  await selectPayment(page, 'cash');
  expect(await pressed(page), 'tapping Cash selects it').toEqual({ cash: 'true', card: 'false' });
  expect(await cashReceivedVisible(page),
    'CLAUDE.md H4 2: "Tapping Cash works as today and shows Cash received (optional)"').toBe(true);
  expect(norm(await tenderText(page))).toMatch(/Cash received/i);

  // Key an amount in with a quick button, then tap Card again.
  await (await quickTender(page, 2000)).click();
  await page.waitForTimeout(250);
  expect(norm(await tenderText(page))).toContain(changeWord(page, '5.00'));

  await tid(page, 'pay-card').click();
  await page.waitForTimeout(300);
  expect(await pressed(page), 'tapping Card selects Card').toEqual({ cash: 'false', card: 'true' });
  expect(await cashReceivedVisible(page),
    'CLAUDE.md H4 2: "Tapping Card again hides ... it"').toBe(false);

  // Back to Cash: the calculator is cleared, not restored.
  await selectPayment(page, 'cash');
  const after = norm(await tenderText(page));
  expect(after, 'CLAUDE.md H4 2: Card "resets it", so Cash comes back to a cleared calculator')
    .not.toMatch(/Change|Short|Enter an amount|Check amount/);
  const stillPressed = await page.locator(
    '[data-testid="tender-exact"], [data-testid="tender-500"], [data-testid="tender-1000"], [data-testid="tender-2000"], [data-testid="tender-5000"]'
  ).evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').length);
  expect(stillPressed, 'no quick cash button may stay selected through Card').toBe(0);

  // The same for a typed Other amount.
  const box = await otherAmount(page);
  await box.fill('17.50');
  await page.waitForTimeout(250);
  expect(norm(await tenderText(page))).toContain(changeWord(page, '2.50'));
  await tid(page, 'pay-card').click();
  await page.waitForTimeout(300);
  await selectPayment(page, 'cash');
  expect(await (await otherAmount(page)).inputValue(),
    'CLAUDE.md H4 2: Card resets the Other amount too').toBe('');
  expect(norm(await tenderText(page))).not.toMatch(/Change|Short|Enter an amount|Check amount/);

  await expectNoConsoleErrors(errors, '#/cash payment toggle (H4)');
});

/* ------------------------------------------------------------------ H4-03 */

test('H4-03 after Send the next order starts on Card', async ({ page }) => {
  const errors = await openCash(page);
  await addItem(page, 'fuchka', 3);
  await openCashPanel(page);
  await tid(page, 'customer-name').fill('Cashy');
  await selectPayment(page, 'cash');
  await (await quickTender(page, 2000)).click();
  await page.waitForTimeout(200);
  await tid(page, 'send-order').click();
  await expect(tid(page, 'order-toast')).toBeVisible({ timeout: 10000 });

  const [sent] = await waitForOrders((o) => o.length === 1, { label: 'the cash order' });
  expect(sent.payment, 'the cash order is still written as "cash" (H4 3)').toBe('cash');

  // Next order: Card again, with no cash received carried over (H4 1,
  // "The choice is not remembered between orders").
  await addItem(page, 'momo', 1);
  await openCashPanel(page);
  await expectOnCard(page, 'on the order after a cash Send');

  await expectNoConsoleErrors(errors, '#/cash after send (H4)');
});

/* ------------------------------------------------------------------ H4-04 */

test('H4-04 after Clear order the panel is back on Card', async ({ page }) => {
  // CLAUDE.md H3 4 gives the small Review & send sheet a header with Add more,
  // a scrolling body and a pinned Send footer — no Clear order control. H4 1's
  // "after Clear order" therefore applies to the tablet/desktop panel; the
  // phone equivalent (the cart emptying) is H4-05.
  test.skip(isSmallCash(page), 'CLAUDE.md H3 4: the phone sheet has no Clear order control');
  await openCash(page);
  await addItem(page, 'fuchka', 2);
  await openCashPanel(page);
  await selectPayment(page, 'cash');
  await (await quickTender(page, 5000)).click();
  await page.waitForTimeout(200);
  expect(await pressed(page)).toEqual({ cash: 'true', card: 'false' });

  const clear = tid(page, 'clear-order');
  await expect(clear, 'CLAUDE.md H4 1 names "after Clear order", so the control exists')
    .toBeVisible({ timeout: 10000 });
  await clear.click();
  await page.waitForTimeout(400);

  await addItem(page, 'momo', 1);
  await openCashPanel(page);
  await expectOnCard(page, 'on the order after Clear order');
});

/* ------------------------------------------------------------------ H4-05 */

test('H4-05 stepping the cart down to empty returns the payment to Card', async ({ page }) => {
  await openCash(page);
  await addItem(page, 'momo', 1);
  await openCashPanel(page);
  await selectPayment(page, 'cash');
  await (await quickTender(page, 1000)).click();
  await page.waitForTimeout(200);
  expect(await pressed(page)).toEqual({ cash: 'true', card: 'false' });

  // The last - tap empties the cart (and, below 700 px, closes the sheet).
  await tid(page, 'line-dec-momo').click();
  await page.waitForTimeout(400);
  if (isSmallCash(page)) {
    await expect(tid(page, 'review-sheet'), 'CLAUDE.md H3 4: removing the last item closes the sheet')
      .toBeHidden({ timeout: 8000 });
  } else {
    await expect(tid(page, 'order-total')).toContainText('£0.00');
    await expectOnCard(page, 'as soon as the cart empties');
  }

  await addItem(page, 'chat', 1);
  await openCashPanel(page);
  await expectOnCard(page, 'on the order built after the cart emptied');
});

/* ------------------------------------------------------------------ H4-06 */

test('H4-06 the Review & send sheet opens on Card, before and after a cash sale', async ({ page }, info) => {
  test.skip(!isSmallCash(page), 'CLAUDE.md H4 1 "the phone Review & send sheet"; this is the tablet panel');
  const errors = await openCash(page);

  // Fresh cart: the sheet opens on Card with no Cash received.
  await addItem(page, 'fuchka', 3);
  await openCashPanel(page);
  await expect(tid(page, 'review-sheet')).toBeVisible();
  await expectOnCard(page, 'when the sheet first opens');
  await shot(page, info.project.name, 'cash', 'sheet-card-default');

  // Sell for cash from the sheet.
  await tid(page, 'customer-name').fill('Sheet');
  await selectPayment(page, 'cash');
  expect(await cashReceivedVisible(page),
    'CLAUDE.md H4 2: Cash shows the calculator in the sheet too').toBe(true);
  await (await quickTender(page, 2000)).click();
  await page.waitForTimeout(200);
  await tid(page, 'send-order').click();
  await expect(tid(page, 'order-toast')).toBeVisible({ timeout: 10000 });
  const [sent] = await waitForOrders((o) => o.length === 1, { label: 'the sheet cash order' });
  expect(sent.payment).toBe('cash');
  await expect(tid(page, 'review-sheet')).toBeHidden({ timeout: 8000 });

  // Reopening for the next customer: Card again.
  await addItem(page, 'momo', 1);
  await openCashPanel(page);
  await expectOnCard(page, 'when the sheet reopens after a cash sale');

  await expectNoConsoleErrors(errors, '#/cash sheet (H4)');
});

/* ------------------------------------------------------------------ H4-07 */

test('H4-07 an order sent without touching the payment buttons is a card order', async ({ page }) => {
  const errors = await openCash(page);
  await addItem(page, 'fuchka', 1);
  await addItem(page, 'momo', 1);
  await openCashPanel(page);
  await tid(page, 'customer-name').fill('Untouched');
  // Deliberately no pay-cash / pay-card tap at all.
  await tid(page, 'send-order').click();
  await expect(tid(page, 'order-toast')).toBeVisible({ timeout: 10000 });

  const [order] = await waitForOrders((o) => o.length === 1, { label: 'the untouched-payment order' });
  expect(order.payment,
    'CLAUDE.md H4 1: "Every new order starts with Card selected", so an untouched order is a card order'
  ).toBe('card');
  expect(order.total).toBe(1000);
  expect(['cash', 'card'], 'CLAUDE.md H4 3: payment is still "cash" or "card"').toContain(order.payment);
  expect(Object.keys(order), 'H4 changes no order data: still no tendered field').not.toContain('tendered');

  // And the stored data is otherwise untouched by H4.
  const all = await readCollection('orders');
  expect(all).toHaveLength(1);

  await expectNoConsoleErrors(errors, '#/cash default send (H4)');
});

/* ------------------------------------------------------------------ H4-08 */

test('H4-08 Card survives closing and reopening the panel', async ({ page }) => {
  await openCash(page);
  await addItem(page, 'fuchka', 1);
  await openCashPanel(page);
  await expectOnCard(page, 'when the panel first shows the order');

  // Add more items and come back: still Card, still no Cash received.
  await closeCashPanel(page);
  await addItem(page, 'momo', 2);
  await openCashPanel(page);
  await expect(tid(page, 'order-total')).toContainText('£15.00');
  await expectOnCard(page, 'after adding more items to the same order');

  // Choosing Cash sticks while the same order is being built.
  await selectPayment(page, 'cash');
  await closeCashPanel(page);
  await addItem(page, 'chat', 1);
  await openCashPanel(page);
  expect(await pressed(page),
    'Cash chosen for the order in hand must not flip back to Card while the cart still has items'
  ).toEqual({ cash: 'true', card: 'false' });
});
