/**
 * T-01..T-13 — "Cash received (optional)".
 * Spec: CLAUDE.md -> Cash counter 3 (rewritten in Phase II) and the mock-ups
 * design/CashCounter.dc.html and design/CashCounterMobile.dc.html.
 *
 * Requirement change, 2026-10-18: Cash received is purely an on-screen
 * calculator for the cashier. Nothing about it is persisted — the order
 * document carries neither `tendered` nor `changeGiven`, not even as null, and
 * the CSV keeps its Phase I columns.
 */
import { test, expect } from './session.js';
import {
  clearFirestore, openApp, tid, addItem, heightOf, expectNoConsoleErrors,
  quickTender, quickTenderButtons, otherAmount, tenderText, firstOf, anyOf,
  waitForOrders, readCollection, shot, londonDay
} from './helpers.js';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const rgb = (s) => { const m = String(s).match(/(\d+(?:\.\d+)?)/g); return m ? m.slice(0, 3).map(Number) : [0, 0, 0]; };
const isAmber = ([r, g, b]) => r >= 150 && g >= 50 && g <= 160 && b <= 90;        // #B45309
const isTeal = ([r, g, b]) => g >= 70 && g > r + 30 && b >= 55;                   // #0F766E / #134E4A

/** Open the cash screen with a £15.00 order on it. */
async function cashWithOrder(page, qty = 3) {
  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
  await addItem(page, 'fuchka', qty);
  await expect(tid(page, 'order-total')).toContainText(`£${(qty * 5).toFixed(2)}`);
  const cash = tid(page, 'pay-cash');
  if (await cash.count()) await cash.click();
  await page.waitForTimeout(200);
  return errors;
}

/**
 * Cash received is an on-screen calculator for the cashier only (requirement
 * change 2026-10-18): the order document must carry neither field, not even
 * as null.
 */
function expectNoCashFields(order) {
  const keys = Object.keys(order);
  expect(keys, `order ${order.orderNo} stores a tendered field; cash received is screen-only`).not.toContain('tendered');
  expect(keys, `order ${order.orderNo} stores a changeGiven field; cash received is screen-only`).not.toContain('changeGiven');
}

/** Everything the cash-received block says right now. */
async function message(page) {
  return norm(await tenderText(page));
}

test.beforeEach(async () => { await clearFirestore(); });

test('T-01 the Cash received block belongs to the cash path only', async ({ page }) => {
  const errors = await cashWithOrder(page);
  expect(await message(page), 'CLAUDE.md Cash 3: a block labelled "Cash received (optional)"').toMatch(/Cash received/i);
  expect(await message(page)).toMatch(/\(optional\)/i);

  await tid(page, 'pay-card').click();
  await page.waitForTimeout(300);
  const exact = await anyOf(page, ['[data-testid="tender-exact"]', '[role="group"][aria-label="Quick cash amounts"]']);
  if (exact) await expect(exact, 'the cash-received block must be hidden with Card selected').toBeHidden();
  const other = await anyOf(page, ['[data-testid="tender-other"]', 'input[inputmode="decimal"]']);
  if (other) await expect(other).toBeHidden();

  await tid(page, 'pay-cash').click();
  await page.waitForTimeout(300);
  expect(await message(page)).toMatch(/Cash received/i);
  await expectNoConsoleErrors(errors, '#/cash cash received');
});

test('T-02 five quick buttons, in order, big enough', async ({ page }, info) => {
  await cashWithOrder(page);
  const buttons = await quickTenderButtons(page);
  expect(await buttons.count(), 'CLAUDE.md Cash 3: quick buttons Exact, £5, £10, £20, £50').toBe(5);
  const labels = (await buttons.allInnerTexts()).map(norm);
  expect(labels).toEqual(['Exact', '£5', '£10', '£20', '£50']);

  const min = info.project.name === 'phone' ? 44 : 54;
  for (let i = 0; i < 5; i++) {
    const h = await heightOf(buttons.nth(i));
    expect(h, `quick button "${labels[i]}" is ${h}px tall; the brief requires at least ${min}px here`).toBeGreaterThanOrEqual(min - 1);
    const pressed = await buttons.nth(i).getAttribute('aria-pressed');
    expect(pressed, `quick button "${labels[i]}" must expose aria-pressed`).not.toBeNull();
  }
});

test('T-03 Exact equals the order total', async ({ page }, info) => {
  await cashWithOrder(page);
  await (await quickTender(page, 'exact')).click();
  await page.waitForTimeout(250);
  const text = await message(page);
  const want = info.project.name === 'phone' ? /Change £0\.00/ : /Change to give: £0\.00/;
  expect(text, `CLAUDE.md Cash 3: "Exact = the order total"; the block reads "${text}"`).toMatch(want);

  await tid(page, 'send-order').click();
  const orders = await waitForOrders((o) => o.length === 1, { label: 'the Exact order' });
  expect(orders[0].total).toBe(1500);
  expectNoCashFields(orders[0]);
});

test('T-04 tapping a selected quick button deselects it', async ({ page }) => {
  await cashWithOrder(page);
  const twenty = await quickTender(page, 2000);
  await twenty.click();
  await page.waitForTimeout(200);
  expect(await twenty.getAttribute('aria-pressed')).toBe('true');
  expect(await message(page)).toMatch(/Change/);

  await twenty.click();
  await page.waitForTimeout(250);
  expect(await twenty.getAttribute('aria-pressed'), 'CLAUDE.md Cash 3: "Tapping a selected button deselects it"').toBe('false');
  const text = await message(page);
  expect(text, `after deselecting, nothing should be shown; the block reads "${text}"`).not.toMatch(/Change|Short|Enter an amount|Check amount/);
});

test('T-05 the Other amount box parses every documented form', async ({ page }, info) => {
  await cashWithOrder(page);
  const box = await otherAmount(page);
  await expect(box, 'CLAUDE.md Cash 3: an "Other amount" text box').toBeVisible();
  expect(await box.getAttribute('inputmode'), 'the brief requires inputmode="decimal"').toBe('decimal');

  const phone = info.project.name === 'phone';
  const cases = [
    ['17.50', '£2.50'],
    ['17.5', '£2.50'],
    ['£17.50', '£2.50'],
    ['17', '£2.00'],
    ['1,000', '£985.00']
  ];
  for (const [typed, change] of cases) {
    await box.fill('');
    await box.fill(typed);
    await page.waitForTimeout(250);
    const text = await message(page);
    const want = phone ? `Change ${change}` : `Change to give: ${change}`;
    expect(text, `typing "${typed}" on a £15.00 order should read "${want}"; it reads "${text}"`).toContain(want);
  }
});

test('T-06 the Other box and the quick buttons clear each other', async ({ page }, info) => {
  await cashWithOrder(page);
  const phone = info.project.name === 'phone';
  const twenty = await quickTender(page, 2000);
  const box = await otherAmount(page);

  await twenty.click();
  await page.waitForTimeout(200);
  await box.fill('17.50');
  await page.waitForTimeout(250);
  const buttons = await quickTenderButtons(page);
  const pressed = await buttons.evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').length);
  expect(pressed, 'CLAUDE.md Cash 3: "Typing in it clears the quick button"').toBe(0);
  expect(await message(page)).toContain(phone ? 'Change £2.50' : 'Change to give: £2.50');

  const ten = await quickTender(page, 1000);
  await ten.click();
  await page.waitForTimeout(250);
  expect(await box.inputValue(), 'CLAUDE.md Cash 3: "tapping a quick button clears it"').toBe('');
  expect(await message(page)).toContain(phone ? 'Short £5.00' : 'Short by £5.00');
});

test('T-07 the four display states, wording and colour', async ({ page }, info) => {
  await cashWithOrder(page);
  const phone = info.project.name === 'phone';
  const box = await otherAmount(page);

  // empty -> nothing
  let text = await message(page);
  expect(text, `with no amount entered nothing should be shown; the block reads "${text}"`)
    .not.toMatch(/Change|Short|Enter an amount|Check amount/);

  // over -> change to give, teal
  await box.fill('20');
  await page.waitForTimeout(250);
  const changeWord = phone ? 'Change £5.00' : 'Change to give: £5.00';
  expect(await message(page)).toContain(changeWord);
  const changeEl = page.getByText(changeWord, { exact: false }).last();
  const changeColour = await changeEl.evaluate((el) => getComputedStyle(el).color);
  expect(isTeal(rgb(changeColour)), `"${changeWord}" is ${changeColour}; CLAUDE.md Cash 3 wants teal`).toBe(true);

  // short -> amber
  await box.fill('13');
  await page.waitForTimeout(250);
  const shortWord = phone ? 'Short £2.00' : 'Short by £2.00';
  expect(await message(page)).toContain(shortWord);
  const shortColour = await page.getByText(shortWord, { exact: false }).last()
    .evaluate((el) => getComputedStyle(el).color);
  expect(isAmber(rgb(shortColour)), `"${shortWord}" is ${shortColour}; CLAUDE.md Cash 3 wants amber #B45309`).toBe(true);

  // unparseable -> amber hint
  for (const junk of ['abc', '--', '1.2.3']) {
    await box.fill(junk);
    await page.waitForTimeout(250);
    const t = await message(page);
    const wanted = phone ? 'Check amount' : 'Enter an amount like 17.50';
    expect(t, `"${junk}" should produce "${wanted}"; the block reads "${t}"`).toContain(wanted);
    expect(t, `"${junk}" must not be read as a number`).not.toMatch(/Change to give|Change £|Short/);
  }
  const junkColour = await page.getByText(phone ? 'Check amount' : 'Enter an amount like 17.50', { exact: false }).last()
    .evaluate((el) => getComputedStyle(el).color);
  expect(isAmber(rgb(junkColour)), `the invalid-amount hint is ${junkColour}; the brief wants amber`).toBe(true);

  // back to empty -> nothing again
  await box.fill('');
  await page.waitForTimeout(250);
  text = await message(page);
  expect(text).not.toMatch(/Change|Short|Enter an amount|Check amount/);

  // the readout is announced
  const status = await anyOf(page, ['[role="status"]', '[aria-live]']);
  expect(status, 'the mock-ups expose the change readout as role="status"').not.toBeNull();
});

test('T-08 the Clear link resets the block (tablet)', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'the phone mock-up has no Clear link');
  await cashWithOrder(page);
  const box = await otherAmount(page);
  await box.fill('20');
  await page.waitForTimeout(200);
  const clear = await firstOf(page, [
    '[data-testid="tender-clear"]',
    '[data-testid="clear-tender"]',
    'button:text-is("Clear")'
  ]);
  await expect(clear, 'CLAUDE.md Cash 3: "A Clear link (tablet) resets it"').toBeVisible();
  await clear.click();
  await page.waitForTimeout(250);
  expect(await box.inputValue()).toBe('');
  const pressed = await (await quickTenderButtons(page)).evaluateAll((els) =>
    els.filter((e) => e.getAttribute('aria-pressed') === 'true').length);
  expect(pressed).toBe(0);
  expect(await message(page)).not.toMatch(/Change|Short|Enter an amount|Check amount/);
});

test('T-09 it resets on Card, on send and on clearing the order', async ({ page }) => {
  await cashWithOrder(page);
  const box = await otherAmount(page);

  // (a) switching to Card and back
  await box.fill('20');
  await page.waitForTimeout(200);
  await tid(page, 'pay-card').click();
  await page.waitForTimeout(200);
  await tid(page, 'pay-cash').click();
  await page.waitForTimeout(300);
  expect(await (await otherAmount(page)).inputValue(), 'CLAUDE.md Cash 3: "Switching to Card ... resets it"').toBe('');
  expect(await message(page)).not.toMatch(/Change|Short|Enter an amount|Check amount/);

  // (b) sending
  await (await quickTender(page, 2000)).click();
  await page.waitForTimeout(200);
  await tid(page, 'send-order').click();
  await expect(tid(page, 'order-toast')).toBeVisible({ timeout: 10000 });
  await waitForOrders((o) => o.length === 1, { label: 'the sent order' });
  await addItem(page, 'momo', 1);
  await page.waitForTimeout(300);
  expect(await (await otherAmount(page)).inputValue(), 'a new order must start with no cash received').toBe('');
  expect(await message(page)).not.toMatch(/Change|Short|Enter an amount|Check amount/);

  // (c) clearing the order
  await (await quickTender(page, 2000)).click();
  await page.waitForTimeout(200);
  const clearOrder = await anyOf(page, [
    '[data-testid="clear-order"]',
    'button:has-text("Clear order")'
  ]);
  if (clearOrder) {
    await clearOrder.click();
  } else {
    // No explicit control: empty the panel with the - button instead.
    await tid(page, 'line-dec-momo').click();
  }
  await page.waitForTimeout(300);
  await addItem(page, 'momo', 1);
  await page.waitForTimeout(300);
  expect(await (await otherAmount(page)).inputValue(), 'CLAUDE.md Cash 3: "clearing the order resets it"').toBe('');
  expect(await message(page), 'CLAUDE.md Cash 3: "clearing the order resets it"').not.toMatch(/Change|Short|Enter an amount|Check amount/);

  // (d) the same when the panel is emptied one line at a time: the next order
  // must not inherit the previous cash received.
  await (await quickTender(page, 2000)).click();
  await page.waitForTimeout(200);
  await tid(page, 'line-dec-momo').click();
  await page.waitForTimeout(300);
  await addItem(page, 'momo', 1);
  await page.waitForTimeout(300);
  expect(
    await message(page),
    'emptying the panel clears the order too, so the cash received must not carry into the next one (CLAUDE.md Cash 3)'
  ).not.toMatch(/Change|Short|Enter an amount|Check amount/);
});

test('T-10 it never blocks sending: no amount, short amount, unparseable amount', async ({ page }) => {
  const errors = await cashWithOrder(page);
  const send = tid(page, 'send-order');

  // (a) no amount at all
  await tid(page, 'customer-name').fill('No amount');
  expect(await send.isDisabled()).toBe(false);
  await send.click();
  await expect(tid(page, 'order-toast')).toBeVisible({ timeout: 10000 });
  let orders = await waitForOrders((o) => o.length === 1, { label: 'order (a)' });
  expect(orders[0].total).toBe(1500);
  expectNoCashFields(orders[0]);

  // (b) short amount
  await addItem(page, 'fuchka', 3);
  await tid(page, 'customer-name').fill('Short');
  await (await otherAmount(page)).fill('10');
  await page.waitForTimeout(250);
  expect(await message(page), 'a short amount is shown, not blocked').toMatch(/Short/);
  expect(await send.isDisabled(), 'CLAUDE.md Cash 3: "It never blocks sending"').toBe(false);
  await send.click();
  await expect(tid(page, 'order-toast')).toBeVisible({ timeout: 10000 });
  orders = await waitForOrders((o) => o.length === 2, { label: 'order (b)' });
  const short = orders.find((o) => o.name === 'Short');
  expect(short, 'the short-tender order was written').toBeTruthy();
  expect(short.total).toBe(1500);
  expectNoCashFields(short);

  // (c) unparseable amount
  await addItem(page, 'fuchka', 3);
  await tid(page, 'customer-name').fill('Junk');
  await (await otherAmount(page)).fill('abc');
  await page.waitForTimeout(250);
  expect(await send.isDisabled(), 'an unparseable amount must not block sending').toBe(false);
  await send.click();
  await expect(tid(page, 'order-toast')).toBeVisible({ timeout: 10000 });
  orders = await waitForOrders((o) => o.length === 3, { label: 'order (c)' });
  const junk = orders.find((o) => o.name === 'Junk');
  expect(junk, 'the unparseable-amount order was written').toBeTruthy();
  expectNoCashFields(junk);

  await expectNoConsoleErrors(errors, 'cash received sending');
});

test('T-11 nothing about cash received is persisted', async ({ page }) => {
  await cashWithOrder(page);
  await (await quickTender(page, 2000)).click();
  await page.waitForTimeout(200);
  await tid(page, 'customer-name').fill('Over');
  await tid(page, 'send-order').click();
  await expect(tid(page, 'order-toast')).toBeVisible({ timeout: 10000 });
  await waitForOrders((o) => o.length === 1, { label: 'the £20 order' });

  await addItem(page, 'fuchka', 3);
  await tid(page, 'pay-card').click();
  await tid(page, 'customer-name').fill('Carded');
  await tid(page, 'send-order').click();
  await expect(tid(page, 'order-toast')).toBeVisible({ timeout: 10000 });
  const orders = await waitForOrders((o) => o.length === 2, { label: 'the card order' });

  const over = orders.find((o) => o.name === 'Over');
  const card = orders.find((o) => o.name === 'Carded');
  expect(over.total).toBe(1500);
  expect(card.payment).toBe('card');
  // Cash received is a calculator for the cashier; it leaves no trace on the
  // order, even when £20 was keyed in and £5.00 change was shown.
  expectNoCashFields(over);
  expectNoCashFields(card);
  for (const o of orders) expect(Number.isInteger(o.total)).toBe(true);
});

test('T-12 Send stays enabled and large in every cash-received state', async ({ page }) => {
  await cashWithOrder(page);
  const send = tid(page, 'send-order');
  const box = await otherAmount(page);
  for (const value of ['', '20', '10', 'abc', '1,000']) {
    await box.fill(value);
    await page.waitForTimeout(200);
    expect(await send.isDisabled(), `Send was disabled with Other amount "${value}"`).toBe(false);
    const h = await heightOf(send);
    expect(h, `send-order is ${h}px tall; CLAUDE.md Cash 4: at least 72 px`).toBeGreaterThanOrEqual(71.5);
  }
  await (await quickTender(page, 'exact')).click();
  expect(await send.isDisabled()).toBe(false);
});

test('T-13 cash-received screenshot', async ({ page }, info) => {
  await cashWithOrder(page);
  await tid(page, 'customer-name').fill('Priya');
  await (await quickTender(page, 2000)).click();
  await page.waitForTimeout(400);
  await shot(page, info.project.name, 'cash', 'tender');
});
