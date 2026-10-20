// C-01..C-14 and D-01..D-03 — cash counter. Spec: CLAUDE.md "Cash counter" FR 1..6
// and the Data model block.
//
// Phase V (v1.4.0) changes two things in this file:
//   * the menu gains `samosa_chat`, so the till shows EIGHT tiles
//     (CLAUDE.md -> Menu, "so 8", and Phase V 7);
//   * the Recent orders strip is replaced by "Open orders" (Phase V 1), and
//     Cancel now goes through the reason dialog (Phase V 3), so C-10, C-11 and
//     C-12 assert the Phase V behaviour. The old limits ("last 5", "this till
//     only", "new only") were Phase I rules that Phase V supersedes.
//
// Hotfix H3 (v1.3.1) does two things this file has to follow:
//   * the menu is exactly the Menu table (CLAUDE.md -> Menu). `fountain` is
//     deleted and `samosa` / `straw` are gone from the seed entirely; those
//     ids are never reused.
//   * below 700 px the order panel is replaced by an order bar and a
//     "Review & send" sheet, so the panel controls are reached through
//     `openCashPanel()`. Tablet (700 px and wider) is unchanged, and the
//     tablet-only sizes below are asserted there only.
// Those are deliberate spec changes, not defects.
import { test, expect } from './session.js';
import {
  clearFirestore, openApp, tid, heightOf, boxOf, expectNoConsoleErrors,
  addItem, placeOrder, readCollection, waitForOrders, londonDay,
  isSmallCash, openCashPanel, closeCashPanel, quickTender, seedDoc, londonTimeToday,
  // Phase V: Open orders replaces the recent strip (CLAUDE.md Phase V 1).
  openOpenOrders, openOrderRow, openEditButton, openCancelButton, listedOpenOrders,
  openCancelDialog, cancelDialog, cancelReasonButton, cancelConfirm, kitchenAdvance
} from './helpers.js';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

/** CLAUDE.md -> Menu: the eight items the till sells, in sort order. */
const ITEMS = ['fuchka', 'momo', 'chat', 'sweet_box', 'samosa_only', 'choc_strawberry', 'marshmallow', 'samosa_chat'];
/** Deleted by H3 ("Don't reuse those ids"). */
const GONE = ['fountain', 'samosa', 'straw'];

test.beforeEach(async () => { await clearFirestore(); });

test('C-01 eight big item tiles with an icon and a name (H3-j, Phase V 7)', async ({ page }) => {
  const errors = await openApp(page, '#/cash');
  const small = isSmallCash(page);
  for (const id of ITEMS) {
    const tile = tid(page, `tile-${id}`);
    await expect(tile, `tile-${id} is missing`).toBeVisible({ timeout: 15000 });
    const h = await heightOf(tile);
    expect(h, `tile-${id} is ${h}px tall; touch targets must be at least 48px`).toBeGreaterThanOrEqual(47.5);
    expect(await tile.locator('svg').count(), `tile-${id} must carry an inline SVG icon, not an emoji`).toBeGreaterThan(0);
    const text = (await tile.innerText()).replace(/\s+/g, ' ');
    // CLAUDE.md Cash 1 puts "£5" on the tile; the H3 small layout draws the
    // tile as icon + short name only (H3 2 and design/CashCounterSmall.dc.html).
    if (!small) expect(text, `tile-${id} must show the £5 price`).toMatch(/£5(\.00)?/);
    expect(text.trim().length, `tile-${id} must show the item name`).toBeGreaterThan(2);
  }
  // Exactly eight tiles, in sort order, and none of the deleted ids.
  const rendered = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="tile-"]')]
    .map((t) => t.dataset.testid.replace(/^tile-/, '')));
  expect(rendered, 'CLAUDE.md Menu / Phase V 7: the till shows the eight items in sort order').toEqual(ITEMS);
  for (const id of GONE) {
    expect(await tid(page, `tile-${id}`).count(), `"${id}" was deleted by H3 and must not be a tile`).toBe(0);
  }
  await expectNoConsoleErrors(errors, '#/cash');
});

test('C-02 the menu is seeded once on first load (H-07)', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-marshmallow')).toBeVisible({ timeout: 15000 });

  const menu = await (async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const m = await readCollection('menu');
      if (m.length >= ITEMS.length) return m;
      await new Promise((r) => setTimeout(r, 250));
    }
    return readCollection('menu');
  })();

  expect(menu.map((m) => m._id).sort(), 'CLAUDE.md Menu after Phase V: eight documents').toEqual([...ITEMS].sort());
  for (const m of menu) {
    expect(m.price, `${m._id} must be seeded at 500 pence`).toBe(500);
    expect(typeof m.name).toBe('string');
    expect(typeof m.short).toBe('string');
    expect(m.colour, `${m._id} must carry a tile colour`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(['chaat', 'momo', 'sweets'], `${m._id} station`).toContain(m.station);
    expect(typeof m.sort).toBe('number');
    expect(m.active, `${m._id} must be active — H3 keeps no retired rows`).toBe(true);
  }
  expect(menu.find((m) => m._id === 'fuchka').station).toBe('chaat');
  expect(menu.find((m) => m._id === 'momo').station).toBe('momo');
  for (const id of ['sweet_box', 'samosa_only', 'choc_strawberry', 'marshmallow']) {
    expect(menu.find((m) => m._id === id).station, `${id} station`).toBe('sweets');
  }
  // H3 7: the Marshmallow rename.
  expect(menu.find((m) => m._id === 'marshmallow').name).toBe('Chocolate Marshmallow (V)');
  expect(menu.find((m) => m._id === 'marshmallow').short).toBe('Choc Marshmallow');
  for (const id of GONE) {
    expect(menu.find((m) => m._id === id), `H3 deletes "${id}" and never reseeds it`).toBeUndefined();
  }
  expect(menu.find((m) => m._id === 'samosa_chat').station, 'CLAUDE.md Menu: Samosa Chat is a Chaat line').toBe('chaat');
  expect(menu.map((m) => m.sort).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

  // Second load must not duplicate the seed.
  await page.reload();
  await expect(tid(page, 'tile-marshmallow')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);
  expect((await readCollection('menu')).length, 'seeding must only happen when the menu collection is empty').toBe(ITEMS.length);
});

test('C-03 tapping a tile adds one and shows a quantity badge', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 15000 });

  await addItem(page, 'fuchka', 3);
  await addItem(page, 'momo', 1);

  await expect(tid(page, 'qty-fuchka')).toHaveText(/3/);
  await expect(tid(page, 'qty-momo')).toHaveText(/1/);
  const untouched = tid(page, 'qty-chat');
  if (await untouched.count()) await expect(untouched).toBeHidden();
});

test('C-04 order panel shows lines, line totals and a big total', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 15000 });
  await addItem(page, 'fuchka', 3);
  await addItem(page, 'momo', 1);
  await openCashPanel(page);

  await expect(tid(page, 'line-fuchka')).toBeVisible();
  await expect(tid(page, 'line-fuchka')).toContainText('£15.00');
  await expect(tid(page, 'line-momo')).toContainText('£5.00');
  await expect(tid(page, 'order-total')).toContainText('£20.00');
});

test('C-05 the minus and plus buttons are big enough and adjust the line', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 15000 });
  await addItem(page, 'fuchka', 3);
  await openCashPanel(page);

  // CLAUDE.md Cash 2 sets 52x52 on the tablet panel; H3 4 sets 48 px in the
  // small Review & send sheet.
  const min = isSmallCash(page) ? 48 : 52;
  for (const name of ['line-inc-fuchka', 'line-dec-fuchka']) {
    const box = await boxOf(tid(page, name));
    expect(box, `${name} is missing`).not.toBeNull();
    expect(box.height, `${name} is ${box.height}px tall; it must be at least ${min}px here`).toBeGreaterThanOrEqual(min - 0.5);
    expect(box.width, `${name} is ${box.width}px wide; it must be at least ${min}px here`).toBeGreaterThanOrEqual(min - 0.5);
  }

  await tid(page, 'line-inc-fuchka').click();
  await expect(tid(page, 'order-total')).toContainText('£20.00');
  await tid(page, 'line-dec-fuchka').click();
  await tid(page, 'line-dec-fuchka').click();
  await expect(tid(page, 'order-total')).toContainText('£10.00');
  await closeCashPanel(page);
  await expect(tid(page, 'qty-fuchka')).toHaveText(/2/);
  await openCashPanel(page);

  await tid(page, 'line-dec-fuchka').click();
  await tid(page, 'line-dec-fuchka').click();
  await expect(tid(page, 'line-fuchka')).toHaveCount(0);
  if (isSmallCash(page)) {
    // CLAUDE.md H3 4: "Removing the last item closes the sheet".
    await expect(tid(page, 'review-sheet')).toBeHidden({ timeout: 8000 });
    await expect(tid(page, 'order-bar')).toBeHidden();
  } else {
    await expect(tid(page, 'order-total')).toContainText('£0.00');
  }
});

test('C-07 cash and card toggle, quick tenders and change due', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 15000 });
  await addItem(page, 'fuchka', 3); // £15.00
  await openCashPanel(page);

  await tid(page, 'pay-cash').click();
  for (const p of [500, 1000, 2000, 5000]) {
    await expect(tid(page, `tender-${p}`), `quick tender button for ${p}p is missing`).toBeVisible();
  }

  await tid(page, 'tender-2000').click();
  await expect(tid(page, 'change-due')).toContainText('£5.00');

  // Short tender: never show a negative change (qa/test-plan.md 15.1).
  await tid(page, 'tender-1000').click();
  const change = tid(page, 'change-due');
  if (await change.isVisible()) {
    const text = await change.innerText();
    expect(text, `a £10 tender on a £15 order showed "${text}"`).not.toMatch(/-\s*£|£\s*-/);
  }

  await tid(page, 'pay-card').click();
  await expect(tid(page, 'tender-2000')).toBeHidden();
  await expect(tid(page, 'change-due')).toBeHidden();
});

test('C-08 send is unavailable on an empty order and big enough when it is not', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 15000 });

  if (isSmallCash(page)) {
    // CLAUDE.md H3 3: the order bar — the only way to Send — is "hidden while
    // the cart is empty", which is this layout's form of "disabled when empty".
    await expect(tid(page, 'order-bar')).toBeHidden();
    await expect(tid(page, 'send-order')).toHaveCount(0);
    await addItem(page, 'momo', 1);
    await expect(tid(page, 'order-bar-open')).toBeVisible();
    await openCashPanel(page);
    const send = tid(page, 'send-order');
    await expect(send).toBeEnabled();
    const h = await heightOf(send);
    expect(h, `send-order is ${h}px tall; CLAUDE.md H3 4 requires 60px in the sheet`).toBeGreaterThanOrEqual(56);
    return;
  }

  const send = tid(page, 'send-order');
  await expect(send).toBeVisible({ timeout: 15000 });
  await expect(send, 'CLAUDE.md Cash 4: the send button is disabled when the order is empty').toBeDisabled();

  await addItem(page, 'momo', 1);
  await expect(send).toBeEnabled();
  const h = await heightOf(send);
  expect(h, `send-order is ${h}px tall; CLAUDE.md Cash 4 requires at least 72px`).toBeGreaterThanOrEqual(71.5);
});

test('C-09 / D-01 / D-03 send writes the order, toasts the number and clears the panel', async ({ page }) => {
  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 15000 });

  const no = await placeOrder(page, { items: { fuchka: 3 }, name: 'Priya', payment: 'cash', tender: 2000 });
  expect(no, 'a fresh till must issue A-001').toBe('A-001');
  await expect(tid(page, 'order-toast')).toContainText('A-001');

  // Panel clears.
  await expect(tid(page, 'line-fuchka')).toHaveCount(0);
  if (isSmallCash(page)) {
    await expect(tid(page, 'review-sheet'), 'CLAUDE.md H3 5: send closes the sheet').toBeHidden({ timeout: 8000 });
    await expect(tid(page, 'order-bar'), 'CLAUDE.md H3 5: send clears the cart').toBeHidden({ timeout: 8000 });
    await expect(tid(page, 'qty-fuchka')).toBeHidden();
  } else {
    await expect(tid(page, 'order-total')).toContainText('£0.00');
    await expect(tid(page, 'customer-name')).toHaveValue('');
    await expect(tid(page, 'send-order')).toBeDisabled();
  }

  // Document shape, CLAUDE.md Data model.
  const [order] = await waitForOrders((o) => o.length === 1, { label: 'the order to be written' });
  expect(order.orderNo).toBe('A-001');
  expect(order.name).toBe('Priya');
  expect(order.total).toBe(1500);
  expect(Number.isInteger(order.total)).toBe(true);
  expect(order.payment).toBe('cash');
  // Cash received is an on-screen calculator only: the document stores neither
  // `tendered` nor `changeGiven` (requirement change 2026-10-18).
  expect(Object.keys(order), 'no tendered field on the order document').not.toContain('tendered');
  expect(Object.keys(order), 'no changeGiven field on the order document').not.toContain('changeGiven');
  expect(order.status).toBe('new');
  expect(order.day, 'day must be the Europe/London date').toBe(londonDay());
  expect(order.till).toBe('A');
  expect(typeof order.createdAtMs).toBe('number');
  expect(order.items).toHaveLength(1);
  expect(order.items[0]).toMatchObject({ id: 'fuchka', qty: 3, price: 500 });
  expect(typeof order.items[0].name).toBe('string');
  expect(order.createdAt, 'createdAt serverTimestamp must be set').toBeTruthy();

  // Toast is transient (CLAUDE.md Cash 4: "show a confirmation ... for 4 s").
  await expect(tid(page, 'order-toast')).toBeHidden({ timeout: 9000 });
  await expectNoConsoleErrors(errors, '#/cash after sending');
});

test('C-06 a blank name is stored as Guest, and no tender is stored', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 15000 });

  await placeOrder(page, { items: { momo: 1 }, name: '', payment: 'card' });
  const [order] = await waitForOrders((o) => o.length === 1, { label: 'the guest order' });
  expect(order.name, 'CLAUDE.md Data model: name is "Guest" if blank').toBe('Guest');
  expect(order.payment).toBe('card');
  expect(Object.keys(order), 'card orders store no tender either').not.toContain('tendered');
});

test('C-10 Open orders lists today\'s open orders from every till (Phase V 1)', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 15000 });

  for (let i = 1; i <= 6; i++) {
    await placeOrder(page, { items: { momo: 1 }, name: `Cust${i}`, payment: 'card' });
    await page.waitForTimeout(150);
  }
  // An order from another till, placed straight into Firestore.
  await seedDoc('orders', {
    orderNo: 'B-003', name: 'Other Till', till: 'B', day: londonDay(), payment: 'cash', status: 'new',
    items: [{ id: 'momo', name: 'Momo', qty: 1, price: 500 }], total: 500,
    createdAtMs: Date.now() - 60000
  });

  // CLAUDE.md Phase V 1: "today's orders from all tills with status new,
  // preparing or ready, newest first" — no five-order limit, and not just
  // this till. That replaces the Phase I recent strip.
  await openOpenOrders(page);
  for (const n of ['A-001', 'A-002', 'A-003', 'A-004', 'A-005', 'A-006', 'B-003']) {
    await expect(openOrderRow(page, n), `${n} is open, so it must be listed`).toBeVisible({ timeout: 10000 });
  }
  expect(await listedOpenOrders(page), 'newest first')
    .toEqual(['A-006', 'A-005', 'A-004', 'A-003', 'A-002', 'A-001', 'B-003']);
  expect(norm(await openOrderRow(page, 'A-006').innerText())).toMatch(/new/i);
});

test('C-11 cancel from Open orders needs a reason and writes it (Phase V 3)', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 15000 });
  await placeOrder(page, { items: { momo: 1 }, name: 'Cancel Me', payment: 'card' });

  await openCancelDialog(page, 'A-001');
  expect(norm(await cancelDialog(page).innerText()),
    'CLAUDE.md Phase V 3: "Cancel A-001 for Cancel Me?"'
  ).toMatch(/Cancel A-001 for Cancel Me\?/);
  await expect(cancelConfirm(page), 'disabled until a reason is picked').toBeDisabled();
  await cancelReasonButton(page, 'mistake').click();
  await cancelConfirm(page).click();

  const orders = await waitForOrders((o) => o[0] && o[0].status === 'cancelled', { label: 'the order to be cancelled' });
  expect(orders[0].status).toBe('cancelled');
  expect(typeof orders[0].cancelledAtMs, 'cancelledAtMs must be stamped').toBe('number');
  expect(orders[0].cancelReason, 'CLAUDE.md Phase V 3: the reason is stored').toBe('mistake');
  expect(orders[0].cancelledFrom, 'and the status it was cancelled from').toBe('new');

  await openOpenOrders(page);
  expect(await listedOpenOrders(page), 'a cancelled order is no longer open').toEqual([]);
});

test('C-12 cancel stays available once the kitchen has started the order (Phase V)', async ({ page, context }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 15000 });
  await placeOrder(page, { items: { momo: 1 }, name: 'Started', payment: 'card' });
  await openOpenOrders(page);
  await expect(openCancelButton(page, 'A-001')).toBeVisible({ timeout: 10000 });

  const kitchen = await context.newPage();
  await kitchen.goto('/#/kitchen');
  await kitchenAdvance(kitchen, 'A-001', 'new');
  await waitForOrders((o) => o[0] && o[0].status === 'preparing', { label: 'the order to start preparing' });

  // CLAUDE.md Phase V, status table: Preparing is still Yes for both Edit and
  // Cancel. (Phase I's "cancel only while new" is superseded.)
  await expect
    .poll(async () => openCancelButton(page, 'A-001').isEnabled().catch(() => false),
      { timeout: 10000, message: 'a Preparing order can still be cancelled' })
    .toBe(true);
  await expect(openEditButton(page, 'A-001'), 'and still edited').toBeEnabled();

  // Ready: cancel only.
  await kitchenAdvance(kitchen, 'A-001', 'preparing');
  await waitForOrders((o) => o[0] && o[0].status === 'ready', { label: 'the order to go ready' });
  await expect
    .poll(async () => openEditButton(page, 'A-001').isDisabled().catch(() => false),
      { timeout: 10000, message: 'CLAUDE.md Phase V 1: Edit is disabled for ready' })
    .toBe(true);
  await expect(openCancelButton(page, 'A-001'), 'a Ready order can still be cancelled').toBeEnabled();

  // Collected: it leaves the list altogether.
  await kitchenAdvance(kitchen, 'A-001', 'ready');
  await waitForOrders((o) => o[0] && o[0].status === 'collected', { label: 'the order to be collected' });
  await kitchen.close();
  await expect
    .poll(async () => listedOpenOrders(page),
      { timeout: 10000, message: 'CLAUDE.md Phase V 1: only new, preparing and ready are open' })
    .toEqual([]);
});

test('C-13 connection pill reads Online', async ({ page }) => {
  await openApp(page, '#/cash');
  const pill = tid(page, 'conn-pill');
  await expect(pill).toBeVisible({ timeout: 15000 });
  await expect(pill, 'CLAUDE.md Cash 6: "Online · synced" or "Offline · N queued"').toContainText(/Online/i, { timeout: 15000 });
  // H3 1 shortens it to "Online" in the 52px one-row phone header.
  if (!isSmallCash(page)) await expect(pill).toContainText(/synced/i);
});

test('C-14 the order sequence survives a reload', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 15000 });
  expect(await placeOrder(page, { items: { momo: 1 }, payment: 'card' })).toBe('A-001');
  expect(await placeOrder(page, { items: { momo: 1 }, payment: 'card' })).toBe('A-002');

  await page.reload();
  await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 15000 });
  expect(await placeOrder(page, { items: { momo: 1 }, payment: 'card' }), 'the sequence lives in localStorage').toBe('A-003');

  const seq = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('seq:')) out[k] = localStorage.getItem(k);
    }
    return out;
  });
  const key = Object.keys(seq)[0];
  expect(key, 'CLAUDE.md: localStorage["seq:<till>:<day>"]').toBe(`seq:A:${londonDay()}`);
  expect(Number(seq[key])).toBe(3);
});

test('C-15 an unknown item id on an older order still renders (H3-k)', async ({ page }) => {
  // CLAUDE.md -> Menu: "Any item id the app doesn't know still renders with
  // the name stored on the order line and the plate icon."
  await seedDoc('orders', {
    orderNo: 'A-900', name: 'Old', till: 'A', day: londonDay(),
    items: [{ id: 'fountain', name: 'Chocolate Fountain', qty: 2, price: 500 }],
    total: 1000, payment: 'cash', status: 'new', createdAtMs: londonTimeToday(12, 0)
  });

  const errors = await openApp(page, '#/kitchen');
  const tab = tid(page, 'tab-new');
  if ((await tab.count()) && (await tab.isVisible().catch(() => false))) await tab.click();
  const card = tid(page, 'order-card-A-900');
  await expect(card, 'an order on a deleted id must still show on the board').toBeVisible({ timeout: 20000 });
  const text = (await card.innerText()).replace(/\s+/g, ' ');
  expect(text, 'the line keeps the name stored on the order').toContain('Chocolate Fountain');
  expect(text, 'no placeholder for an unknown item').not.toMatch(/unknown|undefined|\[object/i);
  expect(await card.locator('svg').count(), 'the plate fallback icon is still drawn').toBeGreaterThan(0);
  await expectNoConsoleErrors(errors, '#/kitchen with an unknown item id');
});

test('C-16 quick tenders are reachable wherever the cash block lives', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 15000 });
  await addItem(page, 'fuchka', 3);
  await openCashPanel(page);
  await tid(page, 'pay-cash').click();
  const exact = await quickTender(page, 'exact');
  await expect(exact).toBeVisible();
  await exact.click();
  await expect(tid(page, 'change-due')).toContainText('£0.00');
});
