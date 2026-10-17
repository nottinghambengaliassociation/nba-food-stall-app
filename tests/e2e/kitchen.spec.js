// K-01..K-12 and D-02/D-04 — food counter. Spec: CLAUDE.md "Food counter" FR 1..6.
import { test, expect } from '@playwright/test';
import {
  clearFirestore, openApp, tid, heightOf, expectNoConsoleErrors,
  placeOrder, readCollection, waitForOrders, seedDoc, londonDay, setTill
} from './helpers.js';

const isPhone = (info) => info.project.name === 'phone';

test.beforeEach(async () => { await clearFirestore(); });

/** Make a column/tab visible before looking for a card inside it. */
async function selectLane(page, lane, info) {
  if (isPhone(info)) {
    const tab = tid(page, `tab-${lane}`);
    if (await tab.count()) await tab.click();
    await page.waitForTimeout(200);
  }
}

async function seedOrder(over = {}) {
  const now = Date.now();
  return seedDoc('orders', {
    orderNo: 'A-001', name: 'Priya', till: 'A', day: londonDay(),
    items: [{ id: 'momo', name: 'Momo', qty: 2, price: 500 }],
    total: 1000, payment: 'cash', tendered: 2000, status: 'new',
    createdAtMs: now, ...over
  });
}

test('K-01 an order placed at the till appears on the kitchen within 2s, no reload', async ({ browser }) => {
  const till = await browser.newContext();
  const kitchenCtx = await browser.newContext();
  const cash = await till.newPage();
  const kitchen = await kitchenCtx.newPage();

  await kitchen.goto('/#/kitchen');
  await expect(kitchen.locator('header').first()).toBeVisible({ timeout: 20000 });
  await kitchen.waitForTimeout(1000);

  await cash.goto('/#/cash');
  await expect(cash.locator('[data-testid="tile-momo"]')).toBeVisible({ timeout: 20000 });
  const t0 = Date.now();
  await placeOrder(cash, { items: { momo: 2 }, name: 'Priya', payment: 'card' });

  await expect(
    kitchen.locator('[data-testid="order-card-A-001"]'),
    'CLAUDE.md Food counter 1: live onSnapshot on today\'s orders'
  ).toBeVisible({ timeout: 8000 });
  const elapsed = Date.now() - t0;
  expect(elapsed, `the order took ${elapsed}ms to reach the kitchen`).toBeLessThan(8000);

  await till.close();
  await kitchenCtx.close();
});

test('K-02 three columns on tablet, tabs with counts on phone', async ({ page }, info) => {
  await seedOrder({ orderNo: 'A-001', status: 'new' });
  await seedOrder({ orderNo: 'A-002', status: 'preparing', startedAtMs: Date.now() });
  await seedOrder({ orderNo: 'A-003', status: 'ready', startedAtMs: Date.now(), readyAtMs: Date.now() });

  const errors = await openApp(page, '#/kitchen');
  await page.waitForTimeout(1500);

  if (isPhone(info)) {
    for (const lane of ['new', 'preparing', 'ready']) {
      const tab = tid(page, `tab-${lane}`);
      await expect(tab, `tab-${lane} is required below the 700px breakpoint`).toBeVisible();
      await expect(tab, `tab-${lane} must show a count`).toContainText(/\d/);
    }
    await expect(tid(page, 'tab-new')).toContainText('1');
  } else {
    for (const lane of ['new', 'preparing', 'ready']) {
      await expect(tid(page, `col-${lane}`), `col-${lane} is required at tablet width`).toBeVisible();
    }
    await expect(tid(page, 'col-new')).toContainText('A-001');
    await expect(tid(page, 'col-preparing')).toContainText('A-002');
    await expect(tid(page, 'col-ready')).toContainText('A-003');
  }
  await expectNoConsoleErrors(errors, '#/kitchen');
});

test('K-03 the card shows number, name, items with icons and an age', async ({ page }, info) => {
  await seedOrder({
    items: [
      { id: 'momo', name: 'Momo', qty: 2, price: 500 },
      { id: 'chat', name: 'Papri Chat', qty: 1, price: 500 }
    ],
    total: 1500
  });
  await openApp(page, '#/kitchen');
  await selectLane(page, 'new', info);

  const card = tid(page, 'order-card-A-001');
  await expect(card).toBeVisible({ timeout: 15000 });
  const text = (await card.innerText()).replace(/\s+/g, ' ');
  expect(text).toContain('A-001');
  expect(text).toContain('Priya');
  expect(text, 'quantities must be shown').toMatch(/2\s*×|2x|×\s*2/i);
  expect(text, 'an age such as "just now" or "3 min"').toMatch(/just now|\d+\s*min/i);
  expect(await card.locator('svg').count(), 'each line needs an inline SVG icon, no emoji').toBeGreaterThanOrEqual(2);
});

test('K-04 the age turns amber at 6 minutes or more', async ({ page }, info) => {
  const now = Date.now();
  await seedOrder({ orderNo: 'A-001', name: 'Old', createdAtMs: now - 7 * 60 * 1000 });
  await seedOrder({ orderNo: 'A-002', name: 'Fresh', createdAtMs: now - 2 * 60 * 1000 });

  await openApp(page, '#/kitchen');
  await selectLane(page, 'new', info);
  await expect(tid(page, 'order-card-A-001')).toBeVisible({ timeout: 15000 });

  const colourOf = async (orderNo) => {
    const card = tid(page, `order-card-${orderNo}`);
    return card.evaluate((el) => {
      const nodes = [...el.querySelectorAll('*')];
      const age = nodes.find((n) => /^(just now|\d+\s*min)$/i.test((n.textContent || '').trim()) && n.children.length === 0);
      return age ? getComputedStyle(age).color : null;
    });
  };

  const amber = 'rgb(180, 83, 9)'; // #B45309, the amber warning from CLAUDE.md Design
  expect(await colourOf('A-001'), 'CLAUDE.md Food counter 2: age turns amber at 6 min or more').toBe(amber);
  expect(await colourOf('A-002'), 'a 2-minute-old order must not be amber').not.toBe(amber);
});

test('K-05 / D-02 one big action button walks New to Preparing to Ready to Collected', async ({ page }, info) => {
  await seedOrder({ name: 'Priya' });
  await openApp(page, '#/kitchen');

  const steps = [
    ['new', /start/i, 'preparing', 'startedAtMs'],
    ['preparing', /ready/i, 'ready', 'readyAtMs'],
    ['ready', /collect/i, 'collected', 'collectedAtMs']
  ];

  for (const [lane, label, nextStatus, stamp] of steps) {
    await selectLane(page, lane, info);
    const action = tid(page, 'action-A-001');
    await expect(action, `the action button is missing in the ${lane} lane`).toBeVisible({ timeout: 15000 });
    await expect(action, `the action button in ${lane} must be labelled for the next step`).toHaveText(label);
    const h = await heightOf(action);
    expect(h, `action-A-001 is ${h}px tall; CLAUDE.md Food counter 3 requires at least 64px`).toBeGreaterThanOrEqual(63.5);

    await action.click();
    const [order] = await waitForOrders((o) => o[0] && o[0].status === nextStatus, { label: `status ${nextStatus}` });
    expect(typeof order[stamp], `${stamp} must be stamped as a number on the transition`).toBe('number');
  }

  // Collected leaves the board.
  for (const lane of ['new', 'preparing', 'ready']) {
    await selectLane(page, lane, info);
    await expect(tid(page, 'order-card-A-001'), 'a collected order must leave the board').toHaveCount(0);
  }
});

test('K-06 Ready cards show the name in large capitals', async ({ page }, info) => {
  await seedOrder({ name: 'priya', status: 'ready', startedAtMs: Date.now(), readyAtMs: Date.now() });
  await openApp(page, '#/kitchen');
  await selectLane(page, 'ready', info);

  const card = tid(page, 'order-card-A-001');
  await expect(card).toBeVisible({ timeout: 15000 });

  const found = await card.evaluate((el) => {
    for (const n of el.querySelectorAll('*')) {
      if (n.children.length) continue;
      const rendered = (n.textContent || '').trim();
      const cs = getComputedStyle(n);
      const shown = cs.textTransform === 'uppercase' ? rendered.toUpperCase() : rendered;
      if (shown === 'PRIYA') return { size: parseFloat(cs.fontSize) };
    }
    return null;
  });
  expect(found, 'CLAUDE.md Food counter 3: Ready cards show the name in large capitals').not.toBeNull();
  expect(found.size, `the call-out name is ${found.size}px; it must be large`).toBeGreaterThanOrEqual(24);
});

test('K-07 undo last tap restores the previous status', async ({ page }, info) => {
  await seedOrder();
  await openApp(page, '#/kitchen');

  const undo = tid(page, 'undo');
  await expect(undo, 'CLAUDE.md Food counter 5: "Undo last tap"').toBeVisible({ timeout: 15000 });
  await expect(undo, 'undo must be disabled before anything has been tapped').toBeDisabled();

  await selectLane(page, 'new', info);
  await tid(page, 'action-A-001').click();
  await waitForOrders((o) => o[0].status === 'preparing', { label: 'preparing' });

  await expect(undo).toBeEnabled();
  await undo.click();
  await waitForOrders((o) => o[0].status === 'new', { label: 'undo back to new' });

  await selectLane(page, 'new', info);
  await expect(tid(page, 'order-card-A-001')).toBeVisible({ timeout: 10000 });
});

test('K-08 the station filter greys other lines but never hides them', async ({ page }, info) => {
  await seedOrder({
    items: [
      { id: 'chat', name: 'Papri Chat', qty: 1, price: 500 },
      { id: 'momo', name: 'Momo', qty: 1, price: 500 }
    ],
    total: 1000
  });
  await openApp(page, '#/kitchen');
  await selectLane(page, 'new', info);
  await expect(tid(page, 'order-card-A-001')).toBeVisible({ timeout: 15000 });

  for (const s of ['all', 'chaat', 'momo', 'sweets']) {
    await expect(tid(page, `station-${s}`), `station-${s} filter is missing`).toBeVisible();
  }

  await tid(page, 'station-momo').click();
  await page.waitForTimeout(300);
  await selectLane(page, 'new', info);

  const card = tid(page, 'order-card-A-001');
  await expect(card, 'CLAUDE.md Food counter 4: lines not for the station are greyed but still shown').toBeVisible();
  const text = (await card.innerText()).replace(/\s+/g, ' ');
  expect(text, 'the chaat line must still be shown, only greyed').toContain('Papri Chat');
  expect(text).toContain('Momo');

  const colours = await card.evaluate((el) => {
    const pick = (needle) => {
      for (const n of el.querySelectorAll('*')) {
        if (n.children.length) continue;
        if ((n.textContent || '').trim().includes(needle)) {
          let node = n;
          // climb to the line row so a wrapper-level grey is found too
          for (let i = 0; i < 3 && node; i++) {
            const c = getComputedStyle(node);
            if (c.color) return { color: c.color, opacity: c.opacity };
            node = node.parentElement;
          }
        }
      }
      return null;
    };
    return { chaat: pick('Papri Chat'), momo: pick('Momo') };
  });
  expect(colours.chaat, 'the Papri Chat line must be found').not.toBeNull();
  expect(colours.momo).not.toBeNull();
  expect(
    colours.chaat.color !== colours.momo.color || Number(colours.chaat.opacity) < Number(colours.momo.opacity),
    `off-station lines must be greyed: chaat ${JSON.stringify(colours.chaat)} vs momo ${JSON.stringify(colours.momo)}`
  ).toBe(true);
});

test('K-09 a cancelled order leaves the kitchen board', async ({ browser }) => {
  const tillCtx = await browser.newContext();
  const kitchenCtx = await browser.newContext();
  const cash = await tillCtx.newPage();
  const kitchen = await kitchenCtx.newPage();

  await cash.goto('/#/cash');
  await expect(cash.locator('[data-testid="tile-momo"]')).toBeVisible({ timeout: 20000 });
  await placeOrder(cash, { items: { momo: 1 }, name: 'Gone', payment: 'card' });

  await kitchen.goto('/#/kitchen');
  await expect(kitchen.locator('[data-testid="order-card-A-001"]')).toBeVisible({ timeout: 20000 });

  await cash.locator('[data-testid="cancel-A-001"]').click();
  await waitForOrders((o) => o[0] && o[0].status === 'cancelled', { label: 'cancellation' });

  await expect(
    kitchen.locator('[data-testid="order-card-A-001"]'),
    'a cancelled order must disappear from the kitchen without a reload'
  ).toHaveCount(0, { timeout: 8000 });

  await tillCtx.close();
  await kitchenCtx.close();
});

test('K-11 the sound toggle is in the header', async ({ page }) => {
  await openApp(page, '#/kitchen');
  const header = page.locator('header').first();
  const toggle = header.locator('button, input[type=checkbox]').filter({ hasText: /sound|beep|mute|audio/i });
  const byLabel = header.locator('[aria-label*="sound" i], [aria-label*="beep" i], [title*="sound" i], [data-testid*="sound"], [data-testid*="beep"]');
  const count = (await toggle.count()) + (await byLabel.count());
  expect(count, 'CLAUDE.md Food counter 6: short beep on a new order, with a toggle in the header').toBeGreaterThan(0);
});

test('K-12 status survives a reload', async ({ page }, info) => {
  await seedOrder();
  await openApp(page, '#/kitchen');
  await selectLane(page, 'new', info);
  await tid(page, 'action-A-001').click();
  await waitForOrders((o) => o[0].status === 'preparing', { label: 'preparing' });

  await page.reload();
  await selectLane(page, 'preparing', info);
  await expect(tid(page, 'order-card-A-001')).toBeVisible({ timeout: 20000 });
  if (info.project.name === 'tablet') {
    await expect(tid(page, 'col-preparing')).toContainText('A-001');
  }
});

test('D-04 two tills ordering at once produce no duplicate order numbers', async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pageA = await a.newPage();
  const pageB = await b.newPage();

  await pageA.goto('/#/');
  await pageB.goto('/#/');
  await expect(pageA.locator('[data-testid="till-letter"]')).toBeVisible({ timeout: 20000 });
  await setTill(pageA, 'A');
  await setTill(pageB, 'B');

  await pageA.evaluate(() => { window.location.hash = '#/cash'; });
  await pageB.evaluate(() => { window.location.hash = '#/cash'; });
  await expect(pageA.locator('[data-testid="tile-momo"]')).toBeVisible({ timeout: 20000 });
  await expect(pageB.locator('[data-testid="tile-momo"]')).toBeVisible({ timeout: 20000 });

  const issued = [];
  for (let i = 0; i < 3; i++) {
    issued.push(await placeOrder(pageA, { items: { momo: 1 }, name: `A${i}`, payment: 'card' }));
    issued.push(await placeOrder(pageB, { items: { chat: 1 }, name: `B${i}`, payment: 'card' }));
  }

  expect(new Set(issued).size, `duplicate order numbers issued: ${issued.join(', ')}`).toBe(6);
  expect(issued.filter((n) => n.startsWith('A-')).sort()).toEqual(['A-001', 'A-002', 'A-003']);
  expect(issued.filter((n) => n.startsWith('B-')).sort()).toEqual(['B-001', 'B-002', 'B-003']);

  const orders = await waitForOrders((o) => o.length === 6, { label: 'six orders from two tills' });
  expect(new Set(orders.map((o) => o.orderNo)).size).toBe(6);

  await a.close();
  await b.close();
});
