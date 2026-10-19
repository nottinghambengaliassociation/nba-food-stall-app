// H-07..H-18 — the menu, end to end.
//
// Spec: CLAUDE.md -> "Menu" (the seven-row table) and "Hotfix H3: phone cash
// counter layout (v1.3.1)" 7, which supersedes hotfix H1's ten-row menu:
// `fountain` is removed, `marshmallow` is renamed, and `samosa` / `straw` are
// gone from the seed entirely ("Don't reuse those ids"). The live database is
// reset in the same release, so there is no retired-row special casing left.
//
// What survives from H1 is the GENERIC rule, which this file still carries the
// weight of: "Any item id the app doesn't know still renders with the name
// stored on the order line and the plate icon." Those are the H-11, H-12,
// H-13, H-15 and H-16 cases below, now driven by the deleted ids.
//
// Everything here runs against the Firestore emulator.
import { test, expect } from './session.js';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import {
  clearFirestore, openApp, tid, heightOf, expectNoConsoleErrors,
  addItem, placeOrder, readCollection, seedDoc, londonDay, londonTimeToday,
  parseCsv, shot, isSmallCash, openCashPanel, closeCashPanel
} from './helpers.js';

/** CLAUDE.md -> Menu: the seven rows, in sort order. */
const MENU_IDS = ['fuchka', 'momo', 'chat', 'sweet_box', 'samosa_only', 'choc_strawberry', 'marshmallow'];
const NEW_IDS = ['sweet_box', 'samosa_only', 'choc_strawberry', 'marshmallow'];
/** Deleted by H3; an order line may still carry one. */
const GONE_IDS = ['fountain', 'samosa', 'straw'];

const NAMES = {
  fuchka: 'Fuchka / Gol Gappa',
  momo: 'Momo',
  chat: 'Papri Chat',
  sweet_box: 'Sweet Box',
  samosa_only: 'Samosa',
  choc_strawberry: 'Chocolate Strawberry',
  marshmallow: 'Chocolate Marshmallow (V)'
};
const SHORTS = {
  fuchka: 'Fuchka',
  momo: 'Momo',
  chat: 'Papri Chat',
  sweet_box: 'Sweet Box',
  samosa_only: 'Samosa',
  choc_strawberry: 'Choc Strawberry',
  marshmallow: 'Choc Marshmallow'
};
/** Names stored on older order lines whose ids no longer exist. */
const LEGACY_NAMES = {
  samosa: 'Sweets Box Samosa / Shingara',
  straw: 'Chocolate Strawberry & Marshmallow (V)',
  fountain: 'Chocolate Fountain'
};

const isPhone = (page) => isSmallCash(page);
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

test.beforeEach(async () => { await clearFirestore(); });

/** Make a kitchen column/tab visible before looking inside it. */
async function selectLane(page, lane) {
  const tab = tid(page, `tab-${lane}`);
  if (await tab.count()) {
    if (await tab.isVisible().catch(() => false)) await tab.click();
  }
  await page.waitForTimeout(200);
}

/**
 * An order from before the H3 reset: its lines carry ids the app no longer
 * knows, with the names they were written with. Seeded straight into the
 * emulator, exactly as such a document would look.
 */
function legacyOrder(over = {}) {
  return {
    orderNo: 'A-017', name: 'Lucy', till: 'A', day: londonDay(),
    items: [
      { id: 'samosa', name: LEGACY_NAMES.samosa, qty: 2, price: 500 },
      { id: 'straw', name: LEGACY_NAMES.straw, qty: 1, price: 500 }
    ],
    total: 1500, payment: 'cash', status: 'new',
    createdAtMs: londonTimeToday(12, 0),
    ...over
  };
}

/** An order placed on the current menu. */
function newOrder(over = {}) {
  return {
    orderNo: 'A-018', name: 'Dev', till: 'A', day: londonDay(),
    items: [
      { id: 'samosa_only', name: NAMES.samosa_only, qty: 3, price: 500 },
      { id: 'choc_strawberry', name: NAMES.choc_strawberry, qty: 1, price: 500 }
    ],
    total: 2000, payment: 'card', status: 'collected',
    createdAtMs: londonTimeToday(12, 30),
    startedAtMs: londonTimeToday(12, 31),
    readyAtMs: londonTimeToday(12, 34),
    collectedAtMs: londonTimeToday(12, 35),
    ...over
  };
}

/* ------------------------------------------------------------------ H-07 */

test('H-07 the seed writes seven menu documents, matching the brief table', async ({ page }) => {
  const BRIEF = {
    fuchka: { name: NAMES.fuchka, short: SHORTS.fuchka, colour: '#FDE68A', station: 'chaat', active: true, sort: 1 },
    momo: { name: NAMES.momo, short: SHORTS.momo, colour: '#BFDBFE', station: 'momo', active: true, sort: 2 },
    chat: { name: NAMES.chat, short: SHORTS.chat, colour: '#FECACA', station: 'chaat', active: true, sort: 3 },
    sweet_box: { name: NAMES.sweet_box, short: SHORTS.sweet_box, colour: '#FED7AA', station: 'sweets', active: true, sort: 4 },
    samosa_only: { name: NAMES.samosa_only, short: SHORTS.samosa_only, colour: '#D9F99D', station: 'sweets', active: true, sort: 5 },
    choc_strawberry: { name: NAMES.choc_strawberry, short: SHORTS.choc_strawberry, colour: '#E9D5FF', station: 'sweets', active: true, sort: 6 },
    marshmallow: { name: NAMES.marshmallow, short: SHORTS.marshmallow, colour: '#FBCFE8', station: 'sweets', active: true, sort: 7 }
  };

  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-marshmallow')).toBeVisible({ timeout: 20000 });

  const menu = await (async () => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const m = await readCollection('menu');
      if (m.length >= 7) return m;
      await new Promise((r) => setTimeout(r, 250));
    }
    return readCollection('menu');
  })();

  expect(menu.map((m) => m._id).sort(), 'CLAUDE.md Menu: seven rows after H3').toEqual(Object.keys(BRIEF).sort());

  for (const [id, want] of Object.entries(BRIEF)) {
    const got = menu.find((m) => m._id === id);
    expect(got, `menu/${id} is missing`).toBeTruthy();
    expect(got.name, `menu/${id} name`).toBe(want.name);
    expect(got.short, `menu/${id} short`).toBe(want.short);
    expect(got.price, `menu/${id} price`).toBe(500);
    expect(String(got.colour).toUpperCase(), `menu/${id} colour`).toBe(want.colour);
    expect(got.station, `menu/${id} station`).toBe(want.station);
    expect(got.active, `menu/${id} active`).toBe(want.active);
    expect(got.sort, `menu/${id} sort`).toBe(want.sort);
  }
  for (const id of GONE_IDS) {
    expect(menu.find((m) => m._id === id), `CLAUDE.md H3 7: "${id}" is deleted, never reseeded`).toBeUndefined();
  }

  await expectNoConsoleErrors(errors, '#/cash');
});

/* ------------------------------------------------------------------ H-08 */

test('H-08 the till shows exactly the seven tiles, in sort order', async ({ page }) => {
  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(600);

  const rendered = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="tile-"]')]
    .map((t) => t.dataset.testid.replace(/^tile-/, '')));
  expect(rendered, 'CLAUDE.md Menu: seven tiles, in menu sort order').toEqual(MENU_IDS);

  for (const id of GONE_IDS) {
    expect(await tid(page, `tile-${id}`).count(), `deleted "${id}" must not be sellable`).toBe(0);
  }

  for (const id of MENU_IDS) {
    const tile = tid(page, `tile-${id}`);
    await expect(tile, `tile-${id} is missing`).toBeVisible();
    expect(await tile.locator('svg').count(), `tile-${id} needs its own inline SVG icon`).toBeGreaterThan(0);
    const text = norm(await tile.innerText());
    // The tile names the item: the small layout uses the `short` name
    // (CLAUDE.md H3 2), the tablet one the full name (Cash 1), which also
    // carries the £5.
    const wanted = isPhone(page) ? SHORTS[id] : NAMES[id];
    expect(text, `tile-${id} must name the item ("${wanted}")`).toContain(wanted);
    if (!isPhone(page)) expect(text, `tile-${id} must show £5`).toMatch(/£5(\.00)?/);
    expect(await heightOf(tile), `tile-${id} height`).toBeGreaterThanOrEqual(47.5);
  }

  await expectNoConsoleErrors(errors, '#/cash');
});

/* ------------------------------------------------------------------ H-09 */

test('H-09 every one of the seven tiles takes its own tap, the order bar covers none', async ({ page }, info) => {
  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });

  // Put an order in the panel so the bottom bar is at its tallest.
  await addItem(page, 'fuchka', 2);
  await openCashPanel(page);
  await tid(page, 'customer-name').fill('Bar Tall');
  await closeCashPanel(page);
  await page.waitForTimeout(400);

  for (const id of MENU_IDS) {
    const tile = tid(page, `tile-${id}`);
    await expect(tile, `tile-${id} must exist`).toHaveCount(1);
    await tile.scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);

    const hit = await tile.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const inViewport = r.top >= 0 && r.bottom <= window.innerHeight
        && r.left >= 0 && r.right <= window.innerWidth;
      const top = document.elementFromPoint(x, y);
      const onTile = !!top && (top === el || el.contains(top));
      const describe = (n) => {
        if (!n) return 'nothing';
        const bits = [n.tagName.toLowerCase()];
        if (n.dataset && n.dataset.testid) bits.push(`[testid=${n.dataset.testid}]`);
        if (n.className && typeof n.className === 'string') bits.push('.' + n.className.trim().split(/\s+/).join('.'));
        return bits.join('');
      };
      let coverer = top;
      while (coverer && !(coverer.dataset && coverer.dataset.testid) && coverer.parentElement) coverer = coverer.parentElement;
      return {
        onTile, inViewport, x, y,
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) },
        at: describe(top),
        covering: describe(coverer)
      };
    });

    expect(hit.inViewport,
      `tile-${id} could not be scrolled fully into the ${info.project.name} viewport: ${JSON.stringify(hit.rect)}`
    ).toBe(true);
    expect(hit.onTile,
      `CLAUDE.md H3 2: the bottom order bar must not cover a tile. ` +
      `At the centre of tile-${id} (${hit.x},${hit.y}) the element is ${hit.at} inside ${hit.covering}, not the tile.`
    ).toBe(true);
  }

  // Prove it for real on the last tile: tap by coordinate, badge must move.
  const last = MENU_IDS[MENU_IDS.length - 1];
  const el = tid(page, `tile-${last}`);
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(
    tid(page, `qty-${last}`),
    `a tap at the centre of the last tile (${last}) must add one, not land on the order bar`
  ).toHaveText(/1/, { timeout: 5000 });

  await expectNoConsoleErrors(errors, '#/cash');
});

/* ------------------------------------------------------------------ H-10 */

test('H-10 no horizontal scroll at 360px with the full menu', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
  await addItem(page, 'momo', 2);
  await page.waitForTimeout(400);

  for (const route of ['#/', '#/cash', '#/kitchen', '#/reports']) {
    await page.goto('/' + route);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(600);
    const over = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(over.scrollWidth,
      `CLAUDE.md Design: no horizontal scroll at 360px (${route}: ${over.scrollWidth} > ${over.clientWidth})`
    ).toBeLessThanOrEqual(over.clientWidth + 1);
  }

  await page.goto('/#/cash');
  await expect(tid(page, 'tile-marshmallow')).toBeVisible({ timeout: 20000 });
  const spill = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="tile-"]')]
    .filter((t) => t.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
    .map((t) => t.dataset.testid));
  expect(spill, 'no tile may spill past the right edge at 360px').toEqual([]);

  await expectNoConsoleErrors(errors, '360px');
});

/* ------------------------------------------------------- H-11 (H3-k) ---- */

test('H-11 an order holding deleted ids still renders on the kitchen board', async ({ page }, info) => {
  await seedDoc('orders', legacyOrder());
  const errors = await openApp(page, '#/kitchen');
  await selectLane(page, 'new');

  const card = tid(page, 'order-card-A-017');
  await expect(card, 'an older order must still appear on the board').toBeVisible({ timeout: 20000 });

  const text = norm(await card.innerText());
  expect(text, 'CLAUDE.md Menu: an unknown id renders with the name stored on the line')
    .toContain(LEGACY_NAMES.samosa);
  expect(text, 'the second unknown id keeps its stored name').toContain(LEGACY_NAMES.straw);
  expect(text, 'a current menu name must not be substituted into an old order').not.toContain('Sweet Box');
  expect(text, 'no placeholder for an unknown item').not.toMatch(/unknown|undefined|\[object/i);
  expect(await card.locator('svg').count(), 'the plate fallback icon is drawn for an unknown id').toBeGreaterThan(0);

  // The card is still workable: Start -> Ready -> Collected.
  await tid(page, 'action-A-017').click();
  await page.waitForTimeout(600);
  await selectLane(page, 'preparing');
  await expect(tid(page, 'order-card-A-017')).toBeVisible({ timeout: 10000 });
  const after = (await readCollection('orders')).find((o) => o.orderNo === 'A-017');
  expect(after.status, 'an older order must still move through the flow').toBe('preparing');

  await expectNoConsoleErrors(errors, '#/kitchen with an unknown item id');
  await shot(page, info.project.name, 'kitchen', 'legacy');
});

/* ------------------------------------------------------------------ H-16 */

test('H-16 the station filter greys by station, and an unknown id belongs to none', async ({ page }) => {
  await seedDoc('orders', {
    orderNo: 'A-019', name: 'Mix', till: 'A', day: londonDay(),
    items: [
      { id: 'fuchka', name: NAMES.fuchka, qty: 1, price: 500 },
      { id: 'momo', name: NAMES.momo, qty: 1, price: 500 },
      { id: 'marshmallow', name: NAMES.marshmallow, qty: 1, price: 500 },
      { id: 'straw', name: LEGACY_NAMES.straw, qty: 1, price: 500 }
    ],
    total: 2000, payment: 'cash', status: 'new', createdAtMs: Date.now()
  });

  await openApp(page, '#/kitchen');
  await selectLane(page, 'new');
  const card = tid(page, 'order-card-A-019');
  await expect(card).toBeVisible({ timeout: 20000 });

  /** Resolved colour and opacity of the row that holds a given text. */
  const styleOf = async (needle) => card.evaluate((el, text) => {
    for (const n of el.querySelectorAll('*')) {
      if (n.children.length) continue;
      if ((n.textContent || '').includes(text)) {
        let node = n;
        for (let i = 0; i < 3 && node; i++) {
          const c = getComputedStyle(node);
          if (c.color) return { color: c.color, opacity: Number(c.opacity) };
          node = node.parentElement;
        }
      }
    }
    return null;
  }, needle);

  const greyedAgainst = (off, on) =>
    !!off && !!on && (off.color !== on.color || off.opacity < on.opacity);

  await tid(page, 'station-sweets').click();
  await page.waitForTimeout(400);
  await selectLane(page, 'new');
  let text = norm(await card.innerText());
  for (const needle of ['Fuchka', 'Momo', 'Marshmallow', LEGACY_NAMES.straw]) {
    expect(text, `CLAUDE.md Food counter 4: "${needle}" is greyed, never hidden`).toContain(needle);
  }
  const sweetsLine = await styleOf(NAMES.marshmallow);
  const chaatLine = await styleOf('Fuchka');
  expect(greyedAgainst(chaatLine, sweetsLine),
    `under Sweets the marshmallow line must read live and the fuchka line greyed: ${JSON.stringify({ chaatLine, sweetsLine })}`
  ).toBe(true);

  await tid(page, 'station-chaat').click();
  await page.waitForTimeout(400);
  await selectLane(page, 'new');
  const chaatOn = await styleOf('Fuchka');
  const sweetsOff = await styleOf(NAMES.marshmallow);
  expect(greyedAgainst(sweetsOff, chaatOn),
    `under Chaat the fuchka line must read live and the sweets lines greyed: ${JSON.stringify({ chaatOn, sweetsOff })}`
  ).toBe(true);
  text = norm(await card.innerText());
  expect(text, 'greyed lines are still shown').toContain('Marshmallow');
  expect(text, 'the unknown-id line is still shown too').toContain(LEGACY_NAMES.straw);
});

/* ------------------------------------------------------- H-12 / H-13 / H-15 */

test('H-12 reports keep old and new items apart, each under its own name', async ({ page }, info) => {
  await seedDoc('orders', legacyOrder({ status: 'collected', startedAtMs: londonTimeToday(12, 1), readyAtMs: londonTimeToday(12, 3), collectedAtMs: londonTimeToday(12, 4) }));
  await seedDoc('orders', newOrder());

  const errors = await openApp(page, '#/reports');
  await expect(tid(page, 'kpi-sales')).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => norm(await tid(page, 'kpi-sales').innerText()), { timeout: 20000 })
    .toMatch(/£35(\.00)?/);

  const rows = {
    samosa: { name: LEGACY_NAMES.samosa, units: 2, revenue: '£10.00' },
    straw: { name: LEGACY_NAMES.straw, units: 1, revenue: '£5.00' },
    samosa_only: { name: NAMES.samosa_only, units: 3, revenue: '£15.00' },
    choc_strawberry: { name: NAMES.choc_strawberry, units: 1, revenue: '£5.00' }
  };

  for (const [id, want] of Object.entries(rows)) {
    const row = tid(page, `item-row-${id}`);
    await expect(row, `item-row-${id} must be its own row — old and new ids are never merged`).toBeVisible({ timeout: 15000 });
    const text = norm(await row.innerText());
    expect(text, `item-row-${id} must show "${want.name}"`).toContain(want.name);
    expect(text, `item-row-${id} units`).toMatch(new RegExp(`\\b${want.units}\\b`));
    expect(text.replace(/,/g, ''), `item-row-${id} revenue`).toContain(want.revenue);
  }

  // A row on a deleted id must never be relabelled with a current name.
  const samosaText = norm(await tid(page, 'item-row-samosa').innerText());
  expect(samosaText, 'the old combined item must not be renamed "Samosa"').toContain(LEGACY_NAMES.samosa);

  await expect(tid(page, 'kpi-orders')).toHaveText(/\b2\b/);
  await expect(tid(page, 'kpi-items')).toHaveText(/\b7\b/);

  await expectNoConsoleErrors(errors, '#/reports mixed day');
  await shot(page, info.project.name, 'reports', 'mixed');
});

test('H-13 the CSV exports older lines under their stored names', async ({ page }) => {
  await seedDoc('orders', legacyOrder({ status: 'collected', readyAtMs: londonTimeToday(12, 3) }));
  await seedDoc('orders', newOrder());

  await openApp(page, '#/reports');
  const button = tid(page, 'export-csv');
  await expect(button).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1200);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    button.click()
  ]);
  const text = readFileSync(await download.path(), 'utf8');
  const rows = parseCsv(text);
  const col = (n) => rows[0].indexOf(n);
  const body = rows.slice(1);

  expect(rows[0]).toEqual([
    'day', 'orderNo', 'till', 'name', 'item', 'qty', 'price',
    'lineTotal', 'payment', 'status', 'createdAt', 'readyAt', 'waitSeconds'
  ]);
  expect(body, 'one row per order line: 2 old + 2 new').toHaveLength(4);

  const items = body.map((r) => r[col('item')]);
  expect(items, 'an unknown id keeps its stored name').toContain(LEGACY_NAMES.samosa);
  expect(items, 'and so does the second one').toContain(LEGACY_NAMES.straw);
  expect(items, 'new lines export under the current names').toContain(NAMES.samosa_only);
  expect(items, 'new lines export under the current names').toContain(NAMES.choc_strawberry);

  const legacyRows = body.filter((r) => r[col('orderNo')] === 'A-017').map((r) => r[col('item')]).sort();
  expect(legacyRows, 'nothing in an older order is rewritten')
    .toEqual([LEGACY_NAMES.straw, LEGACY_NAMES.samosa].sort());
});

test('H-15 opening the kitchen and the reports never rewrites an older order', async ({ page }) => {
  await seedDoc('orders', legacyOrder());
  const find = async () => (await readCollection('orders')).find((o) => o.orderNo === 'A-017');
  const before = await find();
  expect(before, 'the older order must be seeded').toBeTruthy();
  expect(before.items.map((i) => i.id)).toEqual(['samosa', 'straw']);

  await openApp(page, '#/kitchen');
  await selectLane(page, 'new');
  await expect(tid(page, 'order-card-A-017')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500);

  await page.goto('/#/reports');
  await expect(tid(page, 'kpi-sales')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(2000);

  await page.goto('/#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500);

  const after = await find();
  expect(after, 'the older order must still exist').toBeTruthy();
  expect(after.items, 'nothing is migrated in old orders').toEqual(before.items);
  expect(after.total).toBe(before.total);
  expect(after.orderNo).toBe(before.orderNo);
  expect(after.status, 'no screen may change a status on its own').toBe('new');
});

/* ------------------------------------------------------------------ H-14 */

test('H-14 a new order is written with the current ids and names', async ({ page }) => {
  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-sweet_box')).toBeVisible({ timeout: 20000 });

  const orderNo = await placeOrder(page, {
    items: { sweet_box: 1, samosa_only: 2, choc_strawberry: 1, marshmallow: 1 },
    name: 'Split', payment: 'card'
  });
  expect(orderNo).toBe('A-001');

  const deadline = Date.now() + 15000;
  let order = null;
  while (Date.now() < deadline) {
    order = (await readCollection('orders')).find((o) => o.orderNo === orderNo);
    if (order) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  expect(order, 'the order must reach Firestore').toBeTruthy();

  const byId = Object.fromEntries(order.items.map((i) => [i.id, i]));
  expect(Object.keys(byId).sort()).toEqual([...NEW_IDS].sort());
  for (const id of NEW_IDS) {
    expect(byId[id].name, `${id} must be written with its current name`).toBe(NAMES[id]);
    expect(byId[id].price, `${id} price`).toBe(500);
  }
  expect(byId.samosa_only.qty).toBe(2);
  expect(order.total).toBe(2500);
  for (const id of GONE_IDS) {
    expect(Object.keys(byId), `a new order must never carry the deleted id "${id}"`).not.toContain(id);
  }

  await expectNoConsoleErrors(errors, '#/cash current ids');
});

/* ------------------------------------------------------------------ H-17 */

test('H-17 the seven-tile till is still accessible and correctly sized', async ({ page }) => {
  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-marshmallow')).toBeVisible({ timeout: 20000 });
  await addItem(page, 'marshmallow', 1);
  await addItem(page, 'sweet_box', 1);
  await openCashPanel(page);
  await page.waitForTimeout(400);

  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`), 'axe on the seven-tile till').toEqual([]);

  // CLAUDE.md Cash 4 ("at least 72 px") on tablet; CLAUDE.md H3 4 pins a 60 px
  // footer button and 48 px steppers in the small Review & send sheet.
  const small = isPhone(page);
  const sendFloor = small ? 56 : 71.5;
  const stepFloor = small ? 47.5 : 51.5;
  expect(await heightOf(tid(page, 'send-order')), `send-order ≥ ${sendFloor}px`).toBeGreaterThanOrEqual(sendFloor);
  for (const id of ['marshmallow', 'sweet_box']) {
    expect(await heightOf(tid(page, `line-inc-${id}`)), `line-inc-${id} ≥ ${stepFloor}px`).toBeGreaterThanOrEqual(stepFloor);
    expect(await heightOf(tid(page, `line-dec-${id}`)), `line-dec-${id} ≥ ${stepFloor}px`).toBeGreaterThanOrEqual(stepFloor);
  }

  await expectNoConsoleErrors(errors, '#/cash a11y');
});
