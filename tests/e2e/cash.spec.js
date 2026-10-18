// C-01..C-14 and D-01..D-03 — cash counter. Spec: CLAUDE.md "Cash counter" FR 1..6
// and the Data model block.
import { test, expect } from './session.js';
import {
  clearFirestore, openApp, tid, heightOf, boxOf, expectNoConsoleErrors,
  addItem, placeOrder, readCollection, waitForOrders, londonDay
} from './helpers.js';

const ITEMS = ['fuchka', 'momo', 'chat', 'samosa', 'straw', 'fountain'];

test.beforeEach(async () => { await clearFirestore(); });

test('C-01 six big item tiles with an icon, a name and £5', async ({ page }) => {
  const errors = await openApp(page, '#/cash');
  for (const id of ITEMS) {
    const tile = tid(page, `tile-${id}`);
    await expect(tile, `tile-${id} is missing`).toBeVisible({ timeout: 15000 });
    const h = await heightOf(tile);
    expect(h, `tile-${id} is ${h}px tall; touch targets must be at least 48px`).toBeGreaterThanOrEqual(47.5);
    expect(await tile.locator('svg').count(), `tile-${id} must carry an inline SVG icon, not an emoji`).toBeGreaterThan(0);
    const text = await tile.innerText();
    expect(text.replace(/\s+/g, ' '), `tile-${id} must show the £5 price`).toMatch(/£5(\.00)?/);
    expect(text.trim().length, `tile-${id} must show the item name`).toBeGreaterThan(2);
  }
  await expectNoConsoleErrors(errors, '#/cash');
});

test('C-02 the menu is seeded once on first load', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fountain')).toBeVisible({ timeout: 15000 });

  const menu = await (async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const m = await readCollection('menu');
      if (m.length >= 6) return m;
      await new Promise((r) => setTimeout(r, 250));
    }
    return readCollection('menu');
  })();

  expect(menu.map((m) => m._id).sort()).toEqual([...ITEMS].sort());
  for (const m of menu) {
    expect(m.price, `${m._id} must be seeded at 500 pence`).toBe(500);
    expect(typeof m.name).toBe('string');
    expect(typeof m.short).toBe('string');
    expect(m.colour, `${m._id} must carry a tile colour`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(['chaat', 'momo', 'sweets'], `${m._id} station`).toContain(m.station);
    expect(typeof m.sort).toBe('number');
  }
  expect(menu.find((m) => m._id === 'fuchka').station).toBe('chaat');
  expect(menu.find((m) => m._id === 'momo').station).toBe('momo');
  expect(menu.find((m) => m._id === 'fountain').station).toBe('sweets');

  // Second load must not duplicate the seed.
  await page.reload();
  await expect(tid(page, 'tile-fountain')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);
  expect((await readCollection('menu')).length, 'seeding must only happen when the menu collection is empty').toBe(6);
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

  await expect(tid(page, 'line-fuchka')).toBeVisible();
  await expect(tid(page, 'line-fuchka')).toContainText('£15.00');
  await expect(tid(page, 'line-momo')).toContainText('£5.00');
  await expect(tid(page, 'order-total')).toContainText('£20.00');
});

test('C-05 the minus and plus buttons are at least 52px and adjust the line', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 15000 });
  await addItem(page, 'fuchka', 3);

  for (const name of ['line-inc-fuchka', 'line-dec-fuchka']) {
    const box = await boxOf(tid(page, name));
    expect(box, `${name} is missing`).not.toBeNull();
    expect(box.height, `${name} is ${box.height}px tall; CLAUDE.md Cash 2 requires at least 52x52px`).toBeGreaterThanOrEqual(51.5);
    expect(box.width, `${name} is ${box.width}px wide; CLAUDE.md Cash 2 requires at least 52x52px`).toBeGreaterThanOrEqual(51.5);
  }

  await tid(page, 'line-inc-fuchka').click();
  await expect(tid(page, 'order-total')).toContainText('£20.00');
  await tid(page, 'line-dec-fuchka').click();
  await tid(page, 'line-dec-fuchka').click();
  await expect(tid(page, 'order-total')).toContainText('£10.00');
  await expect(tid(page, 'qty-fuchka')).toHaveText(/2/);

  await tid(page, 'line-dec-fuchka').click();
  await tid(page, 'line-dec-fuchka').click();
  await expect(tid(page, 'line-fuchka')).toHaveCount(0);
  await expect(tid(page, 'order-total')).toContainText('£0.00');
});

test('C-07 cash and card toggle, quick tenders and change due', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 15000 });
  await addItem(page, 'fuchka', 3); // £15.00

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

test('C-08 send button is disabled when empty and at least 72px tall', async ({ page }) => {
  await openApp(page, '#/cash');
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
  await expect(tid(page, 'order-total')).toContainText('£0.00');
  await expect(tid(page, 'line-fuchka')).toHaveCount(0);
  await expect(tid(page, 'customer-name')).toHaveValue('');
  await expect(tid(page, 'send-order')).toBeDisabled();

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

test('C-10 recent orders strip keeps the last five from this till', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 15000 });

  for (let i = 1; i <= 6; i++) {
    await placeOrder(page, { items: { momo: 1 }, name: `Cust${i}`, payment: 'card' });
    await page.waitForTimeout(150);
  }

  for (const n of ['A-002', 'A-003', 'A-004', 'A-005', 'A-006']) {
    await expect(tid(page, `recent-${n}`), `${n} should be in the recent strip`).toBeVisible({ timeout: 10000 });
  }
  await expect(tid(page, 'recent-A-001'), 'CLAUDE.md Cash 5: the strip shows the last 5 orders').toHaveCount(0);
  await expect(tid(page, 'recent-A-006')).toContainText(/new/i);
});

test('C-11 cancel is available while the order is new', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 15000 });
  await placeOrder(page, { items: { momo: 1 }, name: 'Cancel Me', payment: 'card' });

  const cancel = tid(page, 'cancel-A-001');
  await expect(cancel, 'CLAUDE.md Cash 5: cancel is available while status is new').toBeVisible({ timeout: 10000 });
  await cancel.click();

  const orders = await waitForOrders((o) => o[0] && o[0].status === 'cancelled', { label: 'the order to be cancelled' });
  expect(orders[0].status).toBe('cancelled');
  expect(typeof orders[0].cancelledAtMs, 'cancelledAtMs must be stamped').toBe('number');
  await expect(tid(page, 'recent-A-001')).toContainText(/cancel/i);
});

test('C-12 cancel disappears once the kitchen has started the order', async ({ page, context }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 15000 });
  await placeOrder(page, { items: { momo: 1 }, name: 'Started', payment: 'card' });
  await expect(tid(page, 'cancel-A-001')).toBeVisible({ timeout: 10000 });

  const kitchen = await context.newPage();
  await kitchen.goto('/#/kitchen');
  await kitchen.locator('[data-testid="action-A-001"]').click({ timeout: 20000 });
  await waitForOrders((o) => o[0] && o[0].status === 'preparing', { label: 'the order to start preparing' });
  await kitchen.close();

  await expect
    .poll(async () => {
      const el = tid(page, 'cancel-A-001');
      if (!(await el.count())) return 'gone';
      return (await el.isDisabled()) ? 'disabled' : 'enabled';
    }, { timeout: 10000, message: 'CLAUDE.md Cash 5: cancel is available only while status is new' })
    .not.toBe('enabled');
});

test('C-13 connection pill reads Online · synced', async ({ page }) => {
  await openApp(page, '#/cash');
  const pill = tid(page, 'conn-pill');
  await expect(pill).toBeVisible({ timeout: 15000 });
  await expect(pill, 'CLAUDE.md Cash 6: "Online · synced" or "Offline · N queued"').toContainText(/Online/i, { timeout: 15000 });
  await expect(pill).toContainText(/synced/i);
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
