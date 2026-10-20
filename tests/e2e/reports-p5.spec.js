/**
 * P5-R-* — Phase V (v1.4.0): what the reports show for an edited or cancelled
 * order.
 *
 * Spec: CLAUDE.md -> "Phase V" item 5:
 *   "Totals already use the order as stored, so edits are counted at their
 *    final value and cancelled orders stay excluded. Orders list: a small
 *    'Edited' tag after the status pill when editCount > 0. Order detail:
 *    timeline adds 'Edited HH:MM' steps and 'Cancelled HH:MM · <reason>'; a
 *    'Changes' list shows each edit's before and after items and totals.
 *    Update the detail note ... All CSVs gain two last columns: edited (yes/no)
 *    and cancelReason (blank unless cancelled)."
 * Plan: qa/test-plan.md section 51.
 *
 * This file tests the brief. Where the app disagrees with it, the app is wrong.
 *
 * Emulator only. Nothing here touches live Firestore.
 */
import { test, expect } from './session.js';
import {
  clearFirestore, openApp, gotoRoute, tid, expectNoConsoleErrors, seedDoc,
  readCollection, londonDay, londonDayOffset, londonTimeOn, parseCsv,
  viewportWidth, openOrder, orderEntry, ordersExport, detailText, shot
} from './helpers.js';
import { readFileSync } from 'node:fs';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const isPhone = (page) => viewportWidth(page) < 700;
const l = (id, name, qty) => ({ id, name, qty, price: 500 });

const DAY = londonDay();
const t = (h, m) => londonTimeOn(DAY, h, m);

/**
 * One scripted day:
 *   A-041 edited once (placed 2× Momo + 1× Papri Chat £15.00, now 3× Momo £15.00)
 *   A-042 untouched, £10.00
 *   A-043 cancelled from preparing with a reason, £10.00 (excluded from totals)
 * Hand-calculated: 2 live orders, £25.00, 5 items.
 */
const FIXTURE = [
  {
    orderNo: 'A-041', name: 'Ahmed', till: 'A', day: DAY, payment: 'cash', status: 'collected',
    items: [l('momo', 'Momo', 3)], total: 1500,
    createdAtMs: t(14, 1), startedAtMs: t(14, 2), readyAtMs: t(14, 5), collectedAtMs: t(14, 6),
    editCount: 1, editedAtMs: t(14, 3),
    history: [{
      atMs: t(14, 3), action: 'edit', till: 'A', fromStatus: 'preparing', deltaPence: 0,
      before: { items: [l('momo', 'Momo', 2), l('chat', 'Papri Chat', 1)], total: 1500, name: 'Ahmed', payment: 'cash' }
    }]
  },
  {
    orderNo: 'A-042', name: 'Sam', till: 'A', day: DAY, payment: 'card', status: 'ready',
    items: [l('fuchka', 'Fuchka / Gol Gappa', 1), l('samosa_chat', 'Samosa Chat', 1)], total: 1000,
    createdAtMs: t(14, 10), startedAtMs: t(14, 11), readyAtMs: t(14, 14)
  },
  {
    orderNo: 'A-043', name: 'Meera', till: 'B', day: DAY, payment: 'card', status: 'cancelled',
    items: [l('chat', 'Papri Chat', 2)], total: 1000,
    createdAtMs: t(14, 20), startedAtMs: t(14, 21), cancelledAtMs: t(14, 22),
    cancelReason: 'changed_mind', cancelledFrom: 'preparing',
    history: [{
      atMs: t(14, 22), action: 'cancel', till: 'B', fromStatus: 'preparing', reason: 'changed_mind', deltaPence: 0,
      before: { items: [l('chat', 'Papri Chat', 2)], total: 1000, name: 'Meera', payment: 'card' }
    }]
  }
];

async function seedDay() {
  for (const o of FIXTURE) await seedDoc('orders', o);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if ((await readCollection('orders')).length === FIXTURE.length) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('the Phase V reports fixture did not land');
}

/** Read a download to text. */
async function download(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), trigger()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), text: readFileSync(path, 'utf8') };
}

const HEADER_15 = 'day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds,edited,cancelReason';

test.beforeEach(async () => { await clearFirestore(); await seedDay(); });

/* ===================================================== P5-R-01 the Edited tag */

test('P5-R-01 the orders list tags an edited order', async ({ page }) => {
  const errors = await openApp(page, '#/reports/orders');
  await expect(orderEntry(page, 'A-041')).toBeVisible({ timeout: 20000 });

  const row = orderEntry(page, 'A-041');
  expect(norm(await row.innerText()),
    'CLAUDE.md Phase V 5: "a small \\"Edited\\" tag after the status pill when editCount > 0"'
  ).toMatch(/Edited/);

  expect(norm(await orderEntry(page, 'A-042').innerText()),
    'an order that was never edited carries no tag'
  ).not.toMatch(/Edited/);

  // The tag follows the status pill, not the other way round.
  const order = await row.evaluate((el) => {
    const text = (el.innerText || '').replace(/\s+/g, ' ');
    return { status: text.indexOf('Collected'), edited: text.indexOf('Edited') };
  });
  if (order.status >= 0 && order.edited >= 0) {
    expect(order.edited, 'the tag comes after the status pill').toBeGreaterThan(order.status);
  }

  await expectNoConsoleErrors(errors, '#/reports/orders with an edited order');
});

/* ================================================ P5-R-02/03/04 the detail */

test('P5-R-02 the detail timeline shows the edit and the cancel reason', async ({ page }) => {
  await openApp(page, '#/reports/orders');
  await expect(orderEntry(page, 'A-041')).toBeVisible({ timeout: 20000 });

  await openOrder(page, 'A-041');
  const detail = norm(await detailText(page));
  expect(detail, 'CLAUDE.md Phase V 5: an "Edited HH:MM" step').toMatch(/Edited\s*14:03/);
  expect(detail, 'the rest of the timeline is unchanged').toMatch(/Placed\s*14:01/);
  expect(detail).toMatch(/Ready\s*14:05/);

  if (isPhone(page)) {
    const back = tid(page, 'order-back').or(tid(page, 'orders-back')).first();
    if (await back.count()) await back.click();
    await page.waitForTimeout(400);
  }

  await openOrder(page, 'A-043');
  const cancelled = norm(await detailText(page));
  expect(cancelled,
    'CLAUDE.md Phase V 5: "Cancelled HH:MM · <reason>"'
  ).toMatch(/Cancelled\s*14:22[^A-Za-z]*·?\s*Customer changed mind/i);
});

test('P5-R-03 the Changes list shows before and after', async ({ page }) => {
  await openApp(page, '#/reports/orders');
  await expect(orderEntry(page, 'A-041')).toBeVisible({ timeout: 20000 });
  await openOrder(page, 'A-041');

  const detail = norm(await detailText(page));
  expect(detail, 'CLAUDE.md Phase V 5: "a \\"Changes\\" list"').toMatch(/Changes/);
  expect(detail, 'it names what the order was').toMatch(/2× Momo, 1× Papri Chat/);
  expect(detail, 'and its total then').toMatch(/£15\.00/);
  expect(detail, 'and what it became').toMatch(/3× Momo/);
  expect(detail, 'with the time of the edit').toMatch(/14:03/);
});

test('P5-R-04 the detail note is the Phase V wording', async ({ page }) => {
  await openApp(page, '#/reports/orders');
  await expect(orderEntry(page, 'A-041')).toBeVisible({ timeout: 20000 });
  await openOrder(page, 'A-041');

  const note = tid(page, 'order-detail-note');
  const text = norm(await (await note.count() ? note.innerText() : detailText(page)));
  expect(text,
    'CLAUDE.md Phase V 5: "Read-only. Orders are edited and cancelled from the cash counter; ' +
    'status changes happen on the food counter."'
  ).toMatch(/Read-only\.\s*Orders are edited and cancelled from the cash counter;\s*status changes happen on the food counter\./i);
  expect(text, 'the cancelled-orders sentence stays').toMatch(/Cancelled orders are listed but excluded from every total\./i);
});

/* ============================================= P5-R-05 totals use the stored order */

test('P5-R-05 the one-day report counts the edited order at its stored value', async ({ page }) => {
  const errors = await openApp(page, '#/reports');
  await expect(tid(page, 'kpi-sales')).toBeVisible({ timeout: 20000 });

  // The tiles render empty and fill from the day's snapshot, so poll rather
  // than read once (the same pattern the Phase I reports cases use).
  await expect
    .poll(async () => norm(await tid(page, 'kpi-sales').innerText()),
      { timeout: 20000, message: 'CLAUDE.md Phase V 5: £15.00 (edited) + £10.00, the cancelled £10.00 excluded' })
    .toContain('£25.00');
  expect(norm(await tid(page, 'kpi-orders').innerText()), 'two live orders').toMatch(/\b2\b/);
  expect(norm(await tid(page, 'kpi-items').innerText()), '3 + 2 items').toMatch(/\b5\b/);

  // Per item: the edited order's Momo line, not the Papri Chat it used to hold.
  await expect(tid(page, 'item-row-momo')).toContainText('3');
  expect(await tid(page, 'item-row-chat').count(),
    'the cancelled order\'s Papri Chat is excluded, and the edited-away line is gone'
  ).toBe(0);
  await expect(tid(page, 'item-row-samosa_chat'), 'Samosa Chat reports like any other item').toBeVisible();

  await expectNoConsoleErrors(errors, '#/reports with an edited order');
});

test('P5-R-05b Sales by day agrees', async ({ page }) => {
  await openApp(page, '#/reports/days');
  const row = tid(page, `day-row-${DAY}`);
  await expect(row).toBeVisible({ timeout: 20000 });
  expect(norm(await row.innerText()), 'the same £25.00 total for the day').toContain('£25.00');
});

/* ======================================================== P5-R-06 the CSVs */

test('P5-R-06 all three exports end with edited and cancelReason', async ({ page }) => {
  // (a) One day.
  await openApp(page, '#/reports');
  await expect(tid(page, 'kpi-sales')).toBeVisible({ timeout: 20000 });
  const one = await download(page, () => tid(page, 'export-csv').click());
  const oneRows = parseCsv(one.text);
  expect(oneRows[0].join(','), 'CLAUDE.md Phase V 5: two last columns on the One day CSV').toBe(HEADER_15);
  const oneCol = (r, n) => r[oneRows[0].indexOf(n)];
  const oneBody = oneRows.slice(1);
  expect(oneBody.every((r) => r.length === 15), 'every row has fifteen fields').toBe(true);
  for (const r of oneBody.filter((r) => oneCol(r, 'orderNo') === 'A-041')) {
    expect(oneCol(r, 'edited'), 'the edited order reads yes').toBe('yes');
    expect(oneCol(r, 'cancelReason'), 'and has no cancel reason').toBe('');
  }
  for (const r of oneBody.filter((r) => oneCol(r, 'orderNo') === 'A-042')) {
    expect(oneCol(r, 'edited')).toBe('no');
  }
  expect(oneBody.some((r) => oneCol(r, 'orderNo') === 'A-043'),
    'the One day export still leaves cancelled orders out'
  ).toBe(false);

  // (b) Sales by day.
  await gotoRoute(page, '#/reports/days');
  await expect(tid(page, 'range-kpi-sales')).toBeVisible({ timeout: 20000 });
  const range = await download(page, () => tid(page, 'range-export-csv').click());
  expect(parseCsv(range.text)[0].join(','), 'the range CSV has the same fifteen columns').toBe(HEADER_15);

  // (c) Orders.
  await gotoRoute(page, '#/reports/orders');
  await expect(orderEntry(page, 'A-041')).toBeVisible({ timeout: 20000 });
  const orders = await download(page, async () => (await ordersExport(page)).click());
  const rows = parseCsv(orders.text);
  expect(rows[0].join(','), 'and so does the Orders CSV').toBe(HEADER_15);
  const col = (r, n) => r[rows[0].indexOf(n)];
  const cancelled = rows.slice(1).find((r) => col(r, 'orderNo') === 'A-043');
  expect(cancelled, 'the Orders export lists cancelled orders (Phase IV 8)').toBeTruthy();
  expect(col(cancelled, 'cancelReason'),
    'CLAUDE.md Phase V 5: cancelReason is the stored reason on a cancelled order'
  ).toBe('changed_mind');
  expect(col(cancelled, 'edited')).toBe('no');
  expect(orders.name, 'the file name is unchanged').toBe(`nba-food-stall_orders_${DAY}.csv`);
});

test('P5-R-07 screenshot of the detail with an edit history', async ({ page }, info) => {
  await openApp(page, '#/reports/orders');
  await expect(orderEntry(page, 'A-041')).toBeVisible({ timeout: 20000 });
  await openOrder(page, 'A-041');
  await shot(page, info.project.name, 'reports-orders', 'edited');
});
