// H-07..H-18 — Hotfix H1 (18 Oct 2026): the split menu items.
// Spec: CLAUDE.md -> "Menu" (ten-row table) and "Hotfix H1: split menu items".
// Plan: qa/test-plan.md sections 21 and 23.
//
// The weight of this file is backwards compatibility: the live database holds
// real trading records whose lines carry the retired ids `samosa` and `straw`.
// Those orders must keep rendering, reporting and exporting under their
// ORIGINAL names, and must never be rewritten.
//
// Everything here runs against the Firestore emulator. Nothing in this hotfix
// writes to live Firestore.
import { test, expect } from './session.js';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import {
  clearFirestore, openApp, tid, heightOf, expectNoConsoleErrors,
  addItem, placeOrder, readCollection, seedDoc, londonDay, londonTimeToday,
  parseCsv, shot
} from './helpers.js';

const ACTIVE_IDS = ['fuchka', 'momo', 'chat', 'sweet_box', 'samosa_only', 'choc_strawberry', 'marshmallow', 'fountain'];
const NEW_IDS = ['sweet_box', 'samosa_only', 'choc_strawberry', 'marshmallow'];
const RETIRED_IDS = ['samosa', 'straw'];

const NEW_NAMES = {
  sweet_box: 'Sweet Box',
  samosa_only: 'Samosa',
  choc_strawberry: 'Chocolate Strawberry',
  marshmallow: 'Marshmallow (V)'
};
const LEGACY_NAMES = {
  samosa: 'Sweets Box Samosa / Shingara',
  straw: 'Chocolate Strawberry & Marshmallow (V)'
};

const isPhone = (info) => info.project.name === 'phone';
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

test.beforeEach(async () => { await clearFirestore(); });

/** Make a kitchen column/tab visible before looking inside it. */
async function selectLane(page, lane, info) {
  if (isPhone(info)) {
    const tab = tid(page, `tab-${lane}`);
    if (await tab.count()) await tab.click();
    await page.waitForTimeout(200);
  }
}

/**
 * A real order from the 17 Oct service: lines carry the retired ids and the
 * names they were written with. Seeded straight into the emulator, exactly as
 * the live documents look.
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

/** An 18 Oct order placed after the split. */
function newOrder(over = {}) {
  return {
    orderNo: 'A-018', name: 'Dev', till: 'A', day: londonDay(),
    items: [
      { id: 'samosa_only', name: NEW_NAMES.samosa_only, qty: 3, price: 500 },
      { id: 'choc_strawberry', name: NEW_NAMES.choc_strawberry, qty: 1, price: 500 }
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

test('H-07 the seed writes ten menu documents, eight active, matching the brief table', async ({ page }) => {
  const BRIEF = {
    fuchka: { name: 'Fuchka / Gol Gappa', short: 'Fuchka', colour: '#FDE68A', station: 'chaat', active: true, sort: 1 },
    momo: { name: 'Momo', short: 'Momo', colour: '#BFDBFE', station: 'momo', active: true, sort: 2 },
    chat: { name: 'Papri Chat', short: 'Papri Chat', colour: '#FECACA', station: 'chaat', active: true, sort: 3 },
    sweet_box: { name: 'Sweet Box', short: 'Sweet Box', colour: '#FED7AA', station: 'sweets', active: true, sort: 4 },
    samosa_only: { name: 'Samosa', short: 'Samosa', colour: '#D9F99D', station: 'sweets', active: true, sort: 5 },
    choc_strawberry: { name: 'Chocolate Strawberry', short: 'Choc Strawberry', colour: '#E9D5FF', station: 'sweets', active: true, sort: 6 },
    marshmallow: { name: 'Marshmallow (V)', short: 'Marshmallow', colour: '#FBCFE8', station: 'sweets', active: true, sort: 7 },
    fountain: { name: 'Chocolate Fountain', short: 'Choc Fountain', colour: '#E7D3BF', station: 'sweets', active: true, sort: 8 },
    samosa: { name: 'Sweets Box Samosa / Shingara', short: 'Sweets Box', colour: '#FED7AA', station: 'sweets', active: false, sort: 90 },
    straw: { name: 'Chocolate Strawberry & Marshmallow (V)', short: 'Choc Strawberry', colour: '#E9D5FF', station: 'sweets', active: false, sort: 91 }
  };

  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fountain')).toBeVisible({ timeout: 20000 });

  const menu = await (async () => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const m = await readCollection('menu');
      if (m.length >= 10) return m;
      await new Promise((r) => setTimeout(r, 250));
    }
    return readCollection('menu');
  })();

  expect(menu.map((m) => m._id).sort(), 'CLAUDE.md Menu: ten rows after H1').toEqual(Object.keys(BRIEF).sort());

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

  await expectNoConsoleErrors(errors, '#/cash');
});

/* ------------------------------------------------------------------ H-08 */

test('H-08 the till shows exactly the eight active tiles, in sort order', async ({ page }) => {
  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(600);

  const rendered = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="tile-"]')]
    .map((t) => t.dataset.testid.replace(/^tile-/, '')));
  expect(rendered, 'CLAUDE.md H1 5: eight tiles, in menu sort order').toEqual(ACTIVE_IDS);

  for (const id of RETIRED_IDS) {
    expect(await tid(page, `tile-${id}`).count(), `retired "${id}" must not be sellable`).toBe(0);
  }

  for (const id of NEW_IDS) {
    const tile = tid(page, `tile-${id}`);
    await expect(tile, `tile-${id} is missing`).toBeVisible();
    expect(await tile.locator('svg').count(), `tile-${id} needs its own inline SVG icon (H1 2)`).toBeGreaterThan(0);
    const text = norm(await tile.innerText());
    expect(text, `tile-${id} must show the name`).toContain(NEW_NAMES[id]);
    expect(text, `tile-${id} must show £5`).toMatch(/£5(\.00)?/);
    expect(await heightOf(tile), `tile-${id} height`).toBeGreaterThanOrEqual(47.5);
  }

  await expectNoConsoleErrors(errors, '#/cash');
});

/* ------------------------------------------------------------------ H-09 */

test('H-09 every one of the eight tiles takes its own tap, the order bar covers none', async ({ page }, info) => {
  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });

  // Put an order in the panel so the sticky bottom bar is at its tallest.
  await addItem(page, 'fuchka', 2);
  await tid(page, 'customer-name').fill('Bar Tall');
  await page.waitForTimeout(400);

  for (const id of ACTIVE_IDS) {
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
      // Name the nearest covering ancestor so a bug report says what covers it.
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
      `CLAUDE.md H1 5: the bottom order bar must not cover a tile. ` +
      `At the centre of tile-${id} (${hit.x},${hit.y}) the element is ${hit.at} inside ${hit.covering}, not the tile.`
    ).toBe(true);
  }

  // Prove it for real on the eighth tile: tap by coordinate, badge must move.
  const eighth = tid(page, `tile-${ACTIVE_IDS[7]}`);
  await eighth.scrollIntoViewIfNeeded();
  const box = await eighth.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(
    tid(page, `qty-${ACTIVE_IDS[7]}`),
    `a tap at the centre of the eighth tile (${ACTIVE_IDS[7]}) must add one, not land on the order bar`
  ).toHaveText(/1/, { timeout: 5000 });

  await expectNoConsoleErrors(errors, '#/cash');
});

/* ------------------------------------------------------------------ H-10 */

test('H-10 no horizontal scroll at 360px with eight tiles', async ({ page }) => {
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
  await expect(tid(page, 'tile-fountain')).toBeVisible({ timeout: 20000 });
  const spill = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="tile-"]')]
    .filter((t) => t.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
    .map((t) => t.dataset.testid));
  expect(spill, 'no tile may spill past the right edge at 360px').toEqual([]);

  await expectNoConsoleErrors(errors, '360px');
});

/* ------------------------------------------------------------------ H-11 */

test('H-11 an order holding the retired ids still renders on the kitchen board', async ({ page }, info) => {
  await seedDoc('orders', legacyOrder());
  const errors = await openApp(page, '#/kitchen');
  await selectLane(page, 'new', info);

  const card = tid(page, 'order-card-A-017');
  await expect(card, 'a 17 Oct order must still appear on the board').toBeVisible({ timeout: 20000 });

  const text = norm(await card.innerText());
  expect(text, 'the legacy samosa line keeps its original name').toContain(LEGACY_NAMES.samosa);
  expect(text, 'the legacy straw line keeps its original name').toContain(LEGACY_NAMES.straw);
  expect(text, 'the new names must not be substituted into an old order').not.toContain('Sweet Box');
  expect(text, 'no placeholder for an unknown item').not.toMatch(/unknown|undefined|\[object/i);
  expect(await card.locator('svg').count(), 'H1 2: the samosa and straw icons are kept for old orders').toBeGreaterThan(0);

  // The card is still workable: Start -> Ready -> Collected.
  await tid(page, 'action-A-017').click();
  await page.waitForTimeout(600);
  await selectLane(page, 'preparing', info);
  await expect(tid(page, 'order-card-A-017')).toBeVisible({ timeout: 10000 });
  const after = (await readCollection('orders')).find((o) => o.orderNo === 'A-017');
  expect(after.status, 'a legacy order must still move through the flow').toBe('preparing');

  await expectNoConsoleErrors(errors, '#/kitchen with a legacy order');
  await shot(page, info.project.name, 'kitchen', 'legacy');
});

/* ------------------------------------------------------------------ H-16 */

test('H-16 the station filter greys by station for new and retired ids alike', async ({ page }, info) => {
  await seedDoc('orders', {
    orderNo: 'A-019', name: 'Mix', till: 'A', day: londonDay(),
    items: [
      { id: 'fuchka', name: 'Fuchka / Gol Gappa', qty: 1, price: 500 },
      { id: 'momo', name: 'Momo', qty: 1, price: 500 },
      { id: 'marshmallow', name: NEW_NAMES.marshmallow, qty: 1, price: 500 },
      { id: 'straw', name: LEGACY_NAMES.straw, qty: 1, price: 500 }
    ],
    total: 2000, payment: 'cash', status: 'new', createdAtMs: Date.now()
  });

  await openApp(page, '#/kitchen');
  await selectLane(page, 'new', info);
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
  await selectLane(page, 'new', info);
  let text = norm(await card.innerText());
  for (const needle of ['Fuchka', 'Momo', NEW_NAMES.marshmallow, LEGACY_NAMES.straw]) {
    expect(text, `CLAUDE.md Food counter 4: "${needle}" is greyed, never hidden`).toContain(needle);
  }
  const sweetsNew = await styleOf(NEW_NAMES.marshmallow);
  const sweetsOld = await styleOf('Chocolate Strawberry & Marshmallow');
  const chaatLine = await styleOf('Fuchka');
  expect(greyedAgainst(chaatLine, sweetsNew),
    `under Sweets the marshmallow line must read live and the fuchka line greyed: ${JSON.stringify({ chaatLine, sweetsNew })}`
  ).toBe(true);
  expect(sweetsOld,
    'the retired straw line must still resolve to the sweets station (H1 3), not a default'
  ).not.toBeNull();
  expect(sweetsOld.color, 'a retired-id line is in Sweets too, so it is styled like the new sweets line')
    .toBe(sweetsNew.color);

  await tid(page, 'station-chaat').click();
  await page.waitForTimeout(400);
  await selectLane(page, 'new', info);
  const chaatOn = await styleOf('Fuchka');
  const sweetsOff = await styleOf(NEW_NAMES.marshmallow);
  expect(greyedAgainst(sweetsOff, chaatOn),
    `under Chaat the fuchka line must read live and the sweets lines greyed: ${JSON.stringify({ chaatOn, sweetsOff })}`
  ).toBe(true);
  text = norm(await card.innerText());
  expect(text, 'greyed lines are still shown').toContain(NEW_NAMES.marshmallow);
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
    samosa_only: { name: NEW_NAMES.samosa_only, units: 3, revenue: '£15.00' },
    choc_strawberry: { name: NEW_NAMES.choc_strawberry, units: 1, revenue: '£5.00' }
  };

  for (const [id, want] of Object.entries(rows)) {
    const row = tid(page, `item-row-${id}`);
    await expect(row, `item-row-${id} must be its own row — old and new ids are never merged`).toBeVisible({ timeout: 15000 });
    const text = norm(await row.innerText());
    expect(text, `item-row-${id} must show "${want.name}"`).toContain(want.name);
    expect(text, `item-row-${id} units`).toMatch(new RegExp(`\\b${want.units}\\b`));
    expect(text.replace(/,/g, ''), `item-row-${id} revenue`).toContain(want.revenue);
  }

  // A legacy row must never be relabelled with the new short name.
  const samosaText = norm(await tid(page, 'item-row-samosa').innerText());
  expect(samosaText, 'the 17 Oct combined item must not be renamed "Samosa"').toContain('Sweets Box Samosa / Shingara');

  await expect(tid(page, 'kpi-orders')).toHaveText(/\b2\b/);
  await expect(tid(page, 'kpi-items')).toHaveText(/\b7\b/);

  await expectNoConsoleErrors(errors, '#/reports mixed day');
  await shot(page, info.project.name, 'reports', 'mixed');
});

test('H-13 the CSV exports legacy lines under their original names', async ({ page }) => {
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
  expect(body, 'one row per order line: 2 legacy + 2 new').toHaveLength(4);

  const items = body.map((r) => r[col('item')]);
  expect(items, 'the retired samosa keeps its stored name').toContain(LEGACY_NAMES.samosa);
  expect(items, 'the retired straw keeps its stored name').toContain(LEGACY_NAMES.straw);
  expect(items, 'new lines export under the new names').toContain(NEW_NAMES.samosa_only);
  expect(items, 'new lines export under the new names').toContain(NEW_NAMES.choc_strawberry);

  const legacyRows = body.filter((r) => r[col('orderNo')] === 'A-017').map((r) => r[col('item')]).sort();
  expect(legacyRows, 'nothing in the legacy order is rewritten')
    .toEqual([LEGACY_NAMES.straw, LEGACY_NAMES.samosa].sort());
});

test('H-15 opening the kitchen and the reports never rewrites a legacy order', async ({ page }, info) => {
  await seedDoc('orders', legacyOrder());
  const find = async () => (await readCollection('orders')).find((o) => o.orderNo === 'A-017');
  const before = await find();
  expect(before, 'the legacy order must be seeded').toBeTruthy();
  expect(before.items.map((i) => i.id)).toEqual(['samosa', 'straw']);

  await openApp(page, '#/kitchen');
  await selectLane(page, 'new', info);
  await expect(tid(page, 'order-card-A-017')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500);

  await page.goto('/#/reports');
  await expect(tid(page, 'kpi-sales')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(2000);

  await page.goto('/#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500);

  const after = await find();
  expect(after, 'the legacy order must still exist').toBeTruthy();
  expect(after.items, 'CLAUDE.md H1 6: "Nothing is migrated in old orders"').toEqual(before.items);
  expect(after.total).toBe(before.total);
  expect(after.orderNo).toBe(before.orderNo);
  expect(after.status, 'no screen may change a status on its own').toBe('new');
});

/* ------------------------------------------------------------------ H-14 */

test('H-14 a new order is written with the new ids and the new names', async ({ page }) => {
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
    expect(byId[id].name, `${id} must be written with its new name`).toBe(NEW_NAMES[id]);
    expect(byId[id].price, `${id} price`).toBe(500);
  }
  expect(byId.samosa_only.qty).toBe(2);
  expect(order.total).toBe(2500);
  for (const id of RETIRED_IDS) {
    expect(Object.keys(byId), `a new order must never carry the retired id "${id}"`).not.toContain(id);
  }

  await expectNoConsoleErrors(errors, '#/cash new ids');
});

/* ------------------------------------------------------------------ H-17 */

test('H-17 the eight-tile till is still accessible and correctly sized', async ({ page }) => {
  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-marshmallow')).toBeVisible({ timeout: 20000 });
  await addItem(page, 'marshmallow', 1);
  await addItem(page, 'sweet_box', 1);
  await page.waitForTimeout(400);

  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`), 'axe on the eight-tile till').toEqual([]);

  expect(await heightOf(tid(page, 'send-order')), 'send-order ≥ 72px').toBeGreaterThanOrEqual(71.5);
  for (const id of ['marshmallow', 'sweet_box']) {
    expect(await heightOf(tid(page, `line-inc-${id}`)), `line-inc-${id} ≥ 52px`).toBeGreaterThanOrEqual(51.5);
    expect(await heightOf(tid(page, `line-dec-${id}`)), `line-dec-${id} ≥ 52px`).toBeGreaterThanOrEqual(51.5);
  }

  await expectNoConsoleErrors(errors, '#/cash a11y');
});
