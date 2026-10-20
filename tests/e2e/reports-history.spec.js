// P6-* — Phase VI "Order history in Reports" (#/reports/history, v1.5.0).
//
// Spec: CLAUDE.md -> "Phase VI: Order history in Reports (v1.5.0)" 1-10, the
// test ids in .claude/agents/neo.md, and the mock-ups
// design/ReportsHistory.dc.html (tablet) and design/ReportsHistoryMobile.dc.html
// (phone). Fixture and hand-calculated figures: helpers.historyFixture /
// historyExpect, the same table as tests/unit/history-fixtures.js and
// qa/test-plan.md section 58.
//
// Read-only screen, and deliberately not live: one getDocs per range change,
// no listener, no writes (P6-09, P6-10, P6-13 prove all three).
import { test, expect } from './session.js';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import {
  clearFirestore, openApp, gotoRoute, tid, londonDay, londonDayOffset, heightOf,
  textOf, parseCsv, shot, attachConsole, expectNoConsoleErrors, readCollection,
  seedHistoryRange, historyExpect, historyFixture, seedHistoryBulk, countOrders,
  seedEvent, placeOrder, watchFirestore, grantClipboard, breakFirestore,
  mendFirestore, slowFirestore
} from './helpers.js';

const isPhone = (info) => info.project.name === 'phone';

/* ------------------------------------------------------------- utilities */

/** Open the history screen and wait for the scripted range to be on screen. */
async function openHistory(page, query = '') {
  const errors = await openApp(page, '#/reports/history' + query);
  await expect(tid(page, 'history-from')).toBeVisible({ timeout: 20000 });
  await expect(tid(page, 'history-summary')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(700);
  return { errors, X: historyExpect() };
}

/** Document ids of the rows on screen, in the order they are rendered. */
async function listedIds(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-testid^="history-row-"]')]
    .map((n) => n.dataset.testid.replace('history-row-', '')));
}

/** The day headings on screen: day, label and the right-hand meta. */
async function dayHeaders(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-testid^="history-day-"]')].map((n) => ({
    day: n.dataset.testid.replace('history-day-', ''),
    label: (n.querySelector('.history-day__label') || {}).textContent?.trim() || '',
    meta: (n.querySelector('.history-day__meta') || {}).textContent?.trim() || ''
  })));
}

const summaryText = async (page) => (await textOf(tid(page, 'history-summary'))).replace(/\s+/g, ' ').trim();

async function kpi(page, name) {
  return tid(page, `history-kpi-${name}`).evaluate((el) => ({
    value: (el.querySelector('.kpi__value') || {}).textContent?.trim() || '',
    note: (el.querySelector('.kpi__note') || {}).textContent?.trim() || ''
  }));
}

async function openFilterSheet(page) {
  const button = tid(page, 'history-filters-open');
  if (await tid(page, 'history-filters-sheet').isVisible().catch(() => false)) return;
  await button.click();
  await expect(tid(page, 'history-filters-sheet')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(200);
}

async function closeFilterSheet(page) {
  if (!(await tid(page, 'history-filters-sheet').isVisible().catch(() => false))) return;
  await tid(page, 'history-filters-show').click();
  await page.waitForTimeout(300);
}

/**
 * Apply a set of filters at either size. On the phone every control except the
 * search box lives in the bottom sheet (CLAUDE.md Phase VI 4).
 */
async function setFilters(page, info, set) {
  const needsSheet = isPhone(info)
    && ['status', 'pay', 'till', 'item', 'edited', 'clear'].some((k) => k in set);
  if (needsSheet) await openFilterSheet(page);
  if (set.clear) await tid(page, 'history-clear').click();
  if (set.status) await tid(page, `history-status-${set.status}`).click();
  if (set.pay) await tid(page, `history-pay-${set.pay}`).click();
  if (set.till) await tid(page, 'history-till').selectOption(set.till);
  if (set.item) await tid(page, 'history-item').selectOption(set.item);
  if (set.edited) await tid(page, 'history-edited').click();
  if (needsSheet) await closeFilterSheet(page);
  if ('q' in set) {
    const box = tid(page, 'history-search');
    await box.fill(set.q);
    await box.dispatchEvent('input');
  }
  await page.waitForTimeout(450);
}

async function pickRange(page, key) {
  await tid(page, `history-range-${key}`).click();
  await page.waitForTimeout(900);
}

async function setRange(page, from, to) {
  if (from !== null) {
    await tid(page, 'history-from').fill(from);
    await tid(page, 'history-from').dispatchEvent('change');
    await page.waitForTimeout(500);
  }
  if (to !== null) {
    await tid(page, 'history-to').fill(to);
    await tid(page, 'history-to').dispatchEvent('change');
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(400);
}

async function openDetail(page, id) {
  await tid(page, `history-open-${id}`).click();
  await expect(tid(page, 'history-detail-no')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(300);
}

const detailField = async (page, name) => (await textOf(tid(page, `history-detail-${name}`))).trim();

test.describe('Phase VI — Order history', () => {
  test.beforeEach(async () => {
    await clearFirestore();
    await seedHistoryRange();
  });

  /* ---------------------------------------------------- 1. the fourth tab */

  test('P6-01/P6-02 the fourth tab is on all four report screens and navigates', async ({ page }, info) => {
    const label = isPhone(info) ? 'History' : 'Order history';
    const others = isPhone(info)
      ? { day: 'One day', days: 'By day', orders: 'Orders' }
      : { day: 'One day', days: 'Sales by day', orders: 'Orders' };

    for (const route of ['#/reports', '#/reports/days', '#/reports/orders', '#/reports/history']) {
      await openApp(page, route);
      await page.waitForTimeout(800);
      const pill = tid(page, 'report-view-history');
      await expect(pill, `CLAUDE.md Phase VI 1: the Order history tab is on ${route}`)
        .toBeVisible({ timeout: 20000 });
      expect((await pill.innerText()).trim(), 'CLAUDE.md Phase VI 1: the phone label is "History"')
        .toBe(label);
      expect(await heightOf(pill), 'the report tabs are at least 48 px').toBeGreaterThanOrEqual(47.5);
      for (const [key, text] of Object.entries(others)) {
        expect((await tid(page, `report-view-${key}`).innerText()).trim(), `${key} label on ${route}`)
          .toBe(text);
      }
    }

    // On its own screen the History pill is filled ink and marked current.
    const ink = async (name) => tid(page, `report-view-${name}`).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await ink('history'), 'CLAUDE.md Phase VI 1: the current tab is filled ink #1C1917')
      .toBe('rgb(28, 25, 23)');
    for (const other of ['day', 'days', 'orders']) {
      expect(await ink(other), 'only the current tab is filled').not.toBe('rgb(28, 25, 23)');
    }
    expect(await page.getAttribute('[data-testid="report-view-history"]', 'aria-current')).toBe('page');

    // And every tab navigates back out again.
    for (const [name, route] of [['day', '#/reports'], ['days', '#/reports/days'], ['orders', '#/reports/orders']]) {
      await gotoRoute(page, '#/reports/history');
      await page.waitForTimeout(500);
      await tid(page, `report-view-${name}`).click();
      await page.waitForTimeout(700);
      expect(await page.evaluate(() => location.hash)).toContain(route.slice(1));
    }
  });

  test('P6-03 the phone tab row scrolls sideways and the page never does', async ({ page }, info) => {
    test.skip(!isPhone(info), 'CLAUDE.md Phase VI 1 is about the phone tab row');
    await openHistory(page);
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 740 });
      await page.waitForTimeout(600);
      const row = await page.evaluate(() => {
        const nav = document.querySelector('.report-nav');
        const pills = [...nav.querySelectorAll('.report-nav__item')];
        return {
          tops: pills.map((p) => Math.round(p.getBoundingClientRect().top)),
          count: pills.length,
          scrolls: nav.scrollWidth > nav.clientWidth,
          overflowX: getComputedStyle(nav).overflowX,
          page: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }
        };
      });
      expect(row.count, 'four tabs').toBe(4);
      expect(Math.max(...row.tops) - Math.min(...row.tops),
        'CLAUDE.md Phase VI 1: one row, no wrapping').toBeLessThanOrEqual(2);
      expect(['auto', 'scroll'], 'the row scrolls sideways if it does not fit').toContain(row.overflowX);
      expect(row.page.scrollWidth, `no horizontal page scroll at ${width} px`)
        .toBeLessThanOrEqual(row.page.clientWidth + 1);
    }
  });

  /* ------------------------------------------------------------ 2. range */

  test('P6-04 the default range is Last 7 days, and the T-7 boundary is excluded', async ({ page }) => {
    const { X } = await openHistory(page);
    expect(await tid(page, 'history-from').inputValue(),
      'CLAUDE.md Phase VI 2: "Default Last 7 days"').toBe(X.defaultRange.from);
    expect(await tid(page, 'history-to').inputValue()).toBe(X.defaultRange.to);
    expect(await tid(page, 'history-range-7d').getAttribute('aria-pressed')).toBe('true');

    expect(await listedIds(page), 'the ten hand-counted orders, newest day and order first')
      .toEqual(X.defaultIds);
    expect(await listedIds(page), 'h11 is on T-7, one day outside the range').not.toContain('h11');
    expect(await summaryText(page)).toBe(X.summary.text);
  });

  test('P6-05 each quick range sets the inputs and loads its hand-counted orders', async ({ page }) => {
    const { X } = await openHistory(page);
    for (const key of ['today', '30d', '7d']) {
      await pickRange(page, key);
      const want = X.ranges[key];
      expect(await tid(page, 'history-from').inputValue(), `${key} from`).toBe(want.from);
      expect(await tid(page, 'history-to').inputValue(), `${key} to`).toBe(want.to);
      expect(await tid(page, `history-range-${key}`).getAttribute('aria-pressed')).toBe('true');
      expect((await listedIds(page)).sort(), `${key} rows`).toEqual(want.ids.slice().sort());
      expect(await summaryText(page), `${key} summary`).toBe(want.text);
    }

    // This year: 1 Jan to today. Computed, never a literal — in early January
    // the older fixture days fall in the previous year.
    await pickRange(page, 'year');
    const yearStart = `${X.days.t.slice(0, 4)}-01-01`;
    expect(await tid(page, 'history-from').inputValue()).toBe(yearStart);
    expect(await tid(page, 'history-to').inputValue()).toBe(X.days.t);
    const expected = historyFixture().filter(({ doc }) => doc.day >= yearStart).map(({ id }) => id);
    expect(expected.length, 'at least today\'s orders are always inside this year')
      .toBeGreaterThanOrEqual(3);
    expect((await listedIds(page)).sort(), 'every seeded order on a day inside this year')
      .toEqual(expected.sort());
  });

  test('P6-06 "This event" is hidden without settings/event and correct with it', async ({ page }) => {
    const { X } = await openHistory(page);
    expect(await tid(page, 'history-range-event').isVisible(),
      'CLAUDE.md Phase VI 2: hidden without settings/event').toBe(false);

    await seedEvent('Durga Puja 2026', X.days.t3, X.days.t1);
    await page.reload();
    await expect(tid(page, 'history-range-event')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(500);
    await pickRange(page, 'event');
    expect(await tid(page, 'history-from').inputValue()).toBe(X.days.t3);
    expect(await tid(page, 'history-to').inputValue()).toBe(X.days.t1);
    expect((await listedIds(page)).sort()).toEqual(X.ranges.event.ids.slice().sort());
    expect(await summaryText(page)).toBe(X.ranges.event.text);
  });

  test('P6-07/P6-08 To before From swaps, 366 days loads and 367 shows the error with no query',
    async ({ page }) => {
      const { X } = await openHistory(page);

      // Swap.
      await setRange(page, X.days.t, null);
      await setRange(page, null, X.days.t6);
      expect(await tid(page, 'history-from').inputValue(),
        'CLAUDE.md Phase VI 2: "To before From swaps them"').toBe(X.days.t6);
      expect(await tid(page, 'history-to').inputValue()).toBe(X.days.t);
      expect(await tid(page, 'history-range-error').isVisible()).toBe(false);
      expect(await listedIds(page)).toEqual(X.defaultIds);

      // 366 days is accepted and queries.
      const watch = watchFirestore(page);
      const longFrom = londonDayOffset(-365, X.days.t);
      await setRange(page, longFrom, X.days.t);
      expect(await tid(page, 'history-range-error').isVisible(),
        '366 days is the maximum, not one over it').toBe(false);
      expect(watch.queriesFor(longFrom).length, 'a valid range queries').toBeGreaterThan(0);
      expect((await listedIds(page)).length, 'the whole fixture is inside a year').toBe(15);

      // 367 days: the message, and no query at all.
      watch.reset();
      const tooFar = londonDayOffset(-366, X.days.t);
      await setRange(page, tooFar, null);
      await expect(tid(page, 'history-range-error')).toBeVisible();
      expect((await textOf(tid(page, 'history-range-error'))).trim(),
        'CLAUDE.md Phase VI 2: "Pick 366 days or fewer"').toBe('Pick 366 days or fewer');
      expect(await tid(page, 'history-range-error').getAttribute('role')).toBe('alert');
      await page.waitForTimeout(800);
      expect(watch.queriesFor(tooFar), 'a too-long range makes no query at all').toEqual([]);

      // Correcting it clears the error and queries again.
      await setRange(page, X.days.t6, null);
      expect(await tid(page, 'history-range-error').isVisible()).toBe(false);
      expect(await listedIds(page)).toEqual(X.defaultIds);
    });

  /* ----------------------------------- 3. one query, no listener, no writes */

  test('P6-09 one query per range change and none per filter change', async ({ page }, info) => {
    const X = historyExpect();
    const watch = watchFirestore(page);
    await openHistory(page);
    expect(watch.queriesFor(X.defaultRange.from).length,
      'CLAUDE.md Phase VI 3: one getDocs for the range on load').toBe(1);

    watch.reset();
    await pickRange(page, '30d');
    expect(watch.queriesFor(X.days.t29).length,
      'one quick button = one range change = one query').toBe(1);

    watch.reset();
    await setFilters(page, info, { status: 'collected' });
    await setFilters(page, info, { pay: 'cash' });
    await setFilters(page, info, { till: 'A' });
    await setFilters(page, info, { item: 'momo' });
    await setFilters(page, info, { edited: true });
    await setFilters(page, info, { q: 'a-0' });
    await page.waitForTimeout(600);
    expect(watch.queriesFor(X.days.t29),
      'CLAUDE.md Phase VI 3: "Filters and search run on the client"').toEqual([]);

    watch.reset();
    await tid(page, 'history-refresh').click();
    await page.waitForTimeout(1200);
    expect(watch.queriesFor(X.days.t29).length, 'Refresh reloads the range').toBe(1);
  });

  test('P6-10 the screen is not a live listener: new data needs Refresh', async ({ page, browser }) => {
    const X = historyExpect();
    const watch = watchFirestore(page);
    await openHistory(page);
    expect(await listedIds(page)).toEqual(X.defaultIds);

    // A new order and a status change, both made elsewhere while this screen
    // is open. Today is the only day the food counter can touch.
    const other = await browser.newContext();
    const cash = await other.newPage();
    await cash.goto('/#/cash');
    await expect(cash.locator('[data-testid="tile-momo"]')).toBeVisible({ timeout: 20000 });
    const no = await placeOrder(cash, { items: { momo: 1 }, name: 'Late', payment: 'cash' });
    const kitchen = await other.newPage();
    await kitchen.goto('/#/kitchen');
    await expect(kitchen.locator(`[data-testid="order-card-${no}"]`)).toBeVisible({ timeout: 20000 });
    await kitchen.locator(`[data-testid="action-${no}"]`).click();   // New → Preparing
    await page.waitForTimeout(3000);

    expect(await listedIds(page),
      'CLAUDE.md Phase VI 3: "One getDocs (not a live listener)"').toEqual(X.defaultIds);
    expect(await summaryText(page), 'the summary does not move either').toBe(X.summary.text);
    // Transport-level: the range target was opened and then closed again. A
    // live onSnapshot would still be holding it open.
    const targets = watch.targetsFor(X.defaultRange.from);
    expect(targets.length, 'the range was queried once').toBeGreaterThan(0);
    const removed = watch.removedTargets();
    for (const id of targets) {
      expect(removed, `CLAUDE.md Phase VI 3: target ${id} is a one-shot read, not a listener`)
        .toContain(id);
    }

    await tid(page, 'history-refresh').click();
    await page.waitForTimeout(1500);
    await expect.poll(async () => (await listedIds(page)).length,
      { timeout: 15000, message: 'Refresh picks the new order up' }).toBe(11);
    expect((await textOf(tid(page, 'history-summary'))).replace(/\s+/g, ' '))
      .toBe('11 orders · £100.00 (excludes 2 cancelled)');
    await expect(page.locator(`text=${no}`).first(), 'and it is Preparing, as the kitchen left it')
      .toBeVisible();

    await other.close();
  });

  test('P6-11 "Loading orders…" shows while the range is in flight', async ({ page }) => {
    // Loading: hold the query back and catch the note.
    await slowFirestore(page, 2500);
    const errors = attachConsole(page);
    await page.goto('/#/reports/history');
    await expect(tid(page, 'history-loading'), 'CLAUDE.md Phase VI 3: "Loading orders…"')
      .toBeVisible({ timeout: 10000 });
    expect((await textOf(tid(page, 'history-loading'))).trim()).toBe('Loading orders…');
    await mendFirestore(page);
    await expect(tid(page, 'history-loading')).toBeHidden({ timeout: 25000 });

    expect(errors.filter((e) => !/Failed to load resource|net::/i.test(e))).toEqual([]);
  });

  test('P6-12 the failure state is wired, and an unreachable backend never crashes the screen',
    async ({ browser }) => {
      // DECISIONS.md, 20 Oct 2026: "Offline is not an error. A getDocs served
      // from persistentLocalCache shows cached rows; history-error comes only
      // from a genuine query failure." With the Firestore cache in front of
      // every read, an unreachable emulator is served from the cache rather
      // than rejected, so the visible error state cannot be provoked over the
      // network here (recorded in qa/bugs.md as an observation). What is
      // asserted instead: the failure UI exists, carries the brief's exact
      // wording and role, is hidden on a healthy load, and an unreachable
      // backend leaves a working screen rather than a broken one.
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = attachConsole(page);

      await page.goto('/#/reports/history');
      await expect(tid(page, 'history-summary')).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(600);

      const box = tid(page, 'history-error');
      expect(await box.count(), 'CLAUDE.md Phase VI 3: the screen has a failure state').toBe(1);
      expect(await box.getAttribute('role'), 'it is a role="alert" box').toBe('alert');
      expect((await box.evaluate((el) => el.textContent || '')).replace(/[\u2019\']/g, "'").trim(),
        'CLAUDE.md Phase VI 3: "Couldn\'t load orders. Check the connection and tap Refresh."')
        .toBe("Couldn't load orders. Check the connection and tap Refresh.");
      expect(await box.isVisible(), 'and it is hidden while the range loads fine').toBe(false);

      // Backend pulled away: the screen stays usable and says something sane.
      await breakFirestore(page);
      await context.setOffline(true);
      await tid(page, 'history-refresh').click();
      await page.waitForTimeout(3000);
      await expect(tid(page, 'history-refresh'), 'Refresh is still usable').toBeEnabled();
      const rows = await listedIds(page);
      const errorShown = await box.isVisible();
      const emptyShown = await tid(page, 'history-empty').isVisible();
      expect(rows.length > 0 || errorShown || emptyShown,
        'cached rows, the empty message or the error box: never a blank, broken screen').toBe(true);

      // And it recovers.
      await context.setOffline(false);
      await mendFirestore(page);
      await tid(page, 'history-refresh').click();
      await expect(tid(page, 'history-row-h01')).toBeVisible({ timeout: 30000 });
      expect(await box.isVisible(), 'a healthy reload clears the failure state').toBe(false);

      expect(errors.filter((e) => !/history query failed|Failed to load resource|net::|transport|offline|could not reach|backend/i.test(e)))
        .toEqual([]);
      await context.close();
    });

  test('P6-13 the screen writes nothing to Firestore', async ({ page, context }, info) => {
    const fingerprint = async () => (await readCollection('orders'))
      .map((o) => [o._id, o.orderNo, o.status, o.total, o.day].join('|')).sort().join('\n');
    const before = await fingerprint();

    await grantClipboard(context);
    const watch = watchFirestore(page);
    await openHistory(page);
    await pickRange(page, '30d');
    await setFilters(page, info, { status: 'collected', q: 'a-0' });
    await setFilters(page, info, { clear: true, q: '' });
    await openDetail(page, 'h10');
    await tid(page, 'history-copy-link').click();
    await page.waitForTimeout(400);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      tid(page, 'history-export-csv').click()
    ]);
    await download.path();
    // The phone replaces the list with the detail, so step back to the list
    // before reaching for Refresh (CLAUDE.md Phase VI 7).
    await goBackToList(page, info);
    await tid(page, 'history-refresh').click();
    await page.waitForTimeout(1200);

    expect(watch.writesTo('orders'),
      'CLAUDE.md Phase VI: "Read-only: no writes, no change to how orders are stored"').toEqual([]);
    // The only writes an empty emulator ever sees from this screen are the
    // app-wide first-load menu seed (CLAUDE.md -> Menu), never an order.
    expect(watch.writtenDocs().filter((d) => !d.startsWith('menu/')),
      'nothing outside the documented menu seed is written').toEqual([]);
    expect(await fingerprint(), 'no order document changed').toBe(before);
    expect((await readCollection('orders')).length).toBe(15);
  });

  /* ---------------------------------------------------------- 4. filters */

  test('P6-14/P6-15/P6-16/P6-17 every filter, search, combination and Clear', async ({ page }, info) => {
    const { X } = await openHistory(page);

    for (const c of X.filters) {
      await setFilters(page, info, { clear: true, q: '' });
      await setFilters(page, info, c.set);
      expect((await listedIds(page)).sort(), `${c.label}: rows`).toEqual(c.ids.slice().sort());
      expect(await summaryText(page), `${c.label}: summary`).toBe(c.text);
      if (c.set.status && !isPhone(info)) {
        expect(await tid(page, `history-status-${c.set.status}`).getAttribute('aria-pressed'),
          `${c.label}: the chosen status is the pressed one`).toBe('true');
      }
    }

    // The empty state.
    await setFilters(page, info, { clear: true, q: 'zzz' });
    await expect(tid(page, 'history-empty')).toBeVisible();
    expect((await textOf(tid(page, 'history-empty'))).trim()).toBe('No orders match these filters.');
    expect(await listedIds(page)).toEqual([]);

    // An item name is not searchable: order number or name only.
    await setFilters(page, info, { q: 'fuchka' });
    expect(await listedIds(page), 'CLAUDE.md Phase VI 4: "matches order number or name"').toEqual([]);

    // A-001 exists on two days in range, and both show with their dates.
    await setFilters(page, info, { q: 'a-001' });
    expect((await listedIds(page)).sort()).toEqual(['h03', 'h09']);
    const headers = await dayHeaders(page);
    expect(headers.map((h) => h.day), 'every result shows its date')
      .toEqual([X.days.t, X.days.t6]);

    // Clear filters keeps the range.
    await pickRange(page, '30d');
    await setFilters(page, info, { status: 'collected', till: 'B' });
    await setFilters(page, info, { clear: true, q: '' });
    expect(await tid(page, 'history-from').inputValue(),
      'CLAUDE.md Phase VI 4: "Clear filters resets everything except the range"').toBe(X.days.t29);
    expect(await tid(page, 'history-to').inputValue()).toBe(X.days.t);
    expect((await listedIds(page)).length).toBe(13);
  });

  test('P6-15b the Till and Item lists are built from the loaded orders', async ({ page }, info) => {
    const { X } = await openHistory(page);
    if (isPhone(info)) await openFilterSheet(page);

    const options = async (name) => tid(page, `history-${name}`)
      .evaluate((sel) => [...sel.options].map((o) => `${o.value}|${o.textContent.trim()}`));

    expect((await options('till')).map((o) => o.split('|')[0]),
      'CLAUDE.md Phase VI 4: "every till letter found in the loaded orders"')
      .toEqual(['all', 'A', 'B', 'C']);
    expect((await options('item')).some((o) => o.startsWith('fountain|')),
      'nothing in the default range carries the retired id').toBe(false);

    if (isPhone(info)) await closeFilterSheet(page);
    await pickRange(page, '30d');
    if (isPhone(info)) await openFilterSheet(page);
    const item = (await options('item')).find((o) => o.startsWith('fountain|'));
    expect(item, 'an unknown id on a loaded line joins the list').toBeTruthy();
    expect(item.split('|')[1], 'shown by its stored name').toBe('Chocolate Fountain');

    if (isPhone(info)) await closeFilterSheet(page);
    await setFilters(page, info, { item: 'fountain' });
    expect(await listedIds(page)).toEqual(['h12']);

    // Today only: till B and C never traded.
    await setFilters(page, info, { clear: true });
    await pickRange(page, 'today');
    if (isPhone(info)) await openFilterSheet(page);
    expect((await options('till')).map((o) => o.split('|')[0])).toEqual(['all', 'A']);
    expect(X.days.t).toBe(londonDay());
  });

  test('P6-18 the phone Filters sheet: count, Show n orders, Clear and closing', async ({ page }, info) => {
    test.skip(!isPhone(info), 'CLAUDE.md Phase VI 4: the sheet is the phone layout');
    const { X } = await openHistory(page);

    // No filter controls on the list itself.
    expect(await tid(page, 'history-status-collected').isVisible()).toBe(false);
    expect(await tid(page, 'history-pay-cash').isVisible()).toBe(false);

    const button = tid(page, 'history-filters-open');
    expect((await button.innerText()).trim()).toBe('Filters');
    expect(await button.getAttribute('aria-expanded')).toBe('false');

    await openFilterSheet(page);
    const sheet = tid(page, 'history-filters-sheet');
    expect(await sheet.getAttribute('role')).toBe('dialog');
    expect(await sheet.getAttribute('aria-label')).toBe('Filters');
    expect(await button.getAttribute('aria-expanded')).toBe('true');
    expect(await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="history-filters-sheet"]');
      return sheet.contains(document.activeElement);
    }), 'focus moves into the sheet').toBe(true);

    await tid(page, 'history-status-collected').click();
    await tid(page, 'history-till').selectOption('A');
    await tid(page, 'history-edited').click();
    await page.waitForTimeout(300);
    expect((await button.innerText()).trim(),
      'CLAUDE.md Phase VI 4: "a Filters button showing the count of active filters"')
      .toBe('Filters (3)');
    // "Show <n> orders" (CLAUDE.md Phase VI 4). The mock-up renders a plain
    // count, so a singular "1 order" is the same requirement met more neatly;
    // the Phase IV plan (section 34.4) already accepts both.
    expect((await tid(page, 'history-filters-show').innerText()).trim()).toMatch(/^Show 1 orders?$/);

    await tid(page, 'history-filters-show').click();
    await page.waitForTimeout(400);
    expect(await sheet.isVisible()).toBe(false);
    expect(await listedIds(page), 'collected + till A + edited is h05').toEqual(['h05']);
    expect(await page.evaluate(() => document.activeElement?.dataset?.testid),
      'focus comes back to the Filters button').toBe('history-filters-open');

    // Clear inside the sheet.
    await openFilterSheet(page);
    await tid(page, 'history-clear').click();
    await page.waitForTimeout(300);
    expect((await tid(page, 'history-filters-show').innerText()).trim()).toBe('Show 10 orders');
    expect(await listedIds(page), 'and the list behind it is back to the whole range').toHaveLength(10);
    await closeFilterSheet(page);
    expect(await listedIds(page)).toEqual(X.defaultIds);

    // Escape and the backdrop both close it.
    await openFilterSheet(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await sheet.isVisible(), 'Escape closes the sheet').toBe(false);
    await openFilterSheet(page);
    await page.mouse.click(8, 8);
    await page.waitForTimeout(300);
    expect(await sheet.isVisible(), 'a backdrop tap closes the sheet').toBe(false);
  });

  /* -------------------------------------------------------- 5. the tiles */

  test('P6-19 the summary tiles and the phone line follow range and filters', async ({ page }, info) => {
    const { X } = await openHistory(page);

    if (isPhone(info)) {
      expect(await tid(page, 'history-kpi-orders').isVisible(),
        'CLAUDE.md Phase VI 5: the phone shows one line').toBe(false);
      expect(await summaryText(page)).toBe(X.summary.text);
    } else {
      expect(await kpi(page, 'orders')).toEqual({ value: '10', note: 'across 4 trading days' });
      expect(await kpi(page, 'sales')).toEqual({ value: '£95.00', note: 'excludes cancelled' });
      expect(await kpi(page, 'cancelled')).toEqual({ value: '2', note: '£10.00 not taken' });
      expect((await kpi(page, 'edited')).value, 'CLAUDE.md Phase VI 5: "Edited after sending"').toBe('2');
    }

    await pickRange(page, '30d');
    if (!isPhone(info)) {
      expect(await kpi(page, 'orders')).toEqual({ value: '13', note: 'across 7 trading days' });
      expect((await kpi(page, 'sales')).value).toBe('£130.00');
    }
    expect(await summaryText(page)).toBe(X.ranges['30d'].text);

    await pickRange(page, '7d');
    await setFilters(page, info, { status: 'cancelled' });
    if (!isPhone(info)) {
      expect((await kpi(page, 'sales')).value, 'cancelled orders never add to Sales').toBe('£0.00');
      expect((await kpi(page, 'cancelled')).value).toBe('2');
    }
    expect(await summaryText(page)).toBe('2 orders · £0.00 (excludes 2 cancelled)');

    await setFilters(page, info, { clear: true });
    await setFilters(page, info, { status: 'collected' });
    expect(await summaryText(page), 'no "(excludes …)" clause when nothing in view is cancelled')
      .toBe('5 orders · £60.00');

    // The large-range note only fires past 5,000 loaded orders.
    expect(await tid(page, 'history-large').isVisible(),
      'CLAUDE.md Phase VI 9: 15 orders is not a large range').toBe(false);
  });

  /* --------------------------------------------------------- 6. the list */

  test('P6-20/P6-21/P6-22 grouping, day totals and every row field', async ({ page }, info) => {
    const { X } = await openHistory(page);

    const headers = await dayHeaders(page);
    expect(headers.map((h) => h.day), 'CLAUDE.md Phase VI 6: newest day first')
      .toEqual(X.groups.map((g) => g.day));
    expect(headers.map((h) => h.meta), 'the day header totals, cancelled excluded')
      .toEqual(X.groups.map((g) => g.meta));
    expect(headers[0].label, 'the day label carries the year')
      .toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expect(await listedIds(page)).toEqual(X.defaultIds);

    // h10: edited twice, till B, cash, collected, £10.00.
    const row = tid(page, 'history-row-h10');
    const text = (await textOf(row)).replace(/\s+/g, ' ');
    for (const part of ['B-002', 'Sohini', '2× Sweet Box', '£10.00', 'Cash', 'Collected', 'Edited']) {
      expect(text, `the h10 row shows ${part}`).toContain(part);
    }
    if (!isPhone(info)) {
      expect(text, 'the Till column').toContain('B');
      const open = tid(page, 'history-open-h10');
      expect(await open.evaluate((el) => el.tagName.toLowerCase()), 'the order cell is a real button')
        .toBe('button');
      expect(await open.getAttribute('aria-label'), 'the label names the order and its day')
        .toMatch(/^View order B-002 on /);
      expect(await heightOf(open), 'the order button is at least 48 px').toBeGreaterThanOrEqual(47.5);
    } else {
      expect(text, 'the phone card foot: HH:MM · Pay · till X').toMatch(/\d{2}:\d{2} · Cash · till B/);
    }

    // Only the two edited orders carry the tag.
    const tagged = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="history-row-"]')]
      .filter((n) => !!n.querySelector('.edited-tag'))
      .map((n) => n.dataset.testid.replace('history-row-', '')));
    expect(tagged.sort(), 'CLAUDE.md Phase VI 6: an amber "Edited" tag when editCount > 0')
      .toEqual(['h05', 'h10']);

    // Cancelled totals are grey and struck through.
    const cancelled = await tid(page, 'history-row-h02').evaluate((n) => {
      const el = [...n.querySelectorAll('*')].find((x) => (x.textContent || '').trim() === '£5.00');
      const cs = el ? getComputedStyle(el) : null;
      return cs ? { colour: cs.color, line: cs.textDecorationLine } : null;
    });
    expect(cancelled.colour, 'CLAUDE.md Phase VI 6: grey when cancelled').toBe('rgb(120, 113, 108)');
    expect(cancelled.line).toContain('line-through');

    // The unknown item id keeps the name stored on the line.
    await pickRange(page, '30d');
    expect((await textOf(tid(page, 'history-row-h12'))).replace(/\s+/g, ' '))
      .toContain('Chocolate Fountain');
  });

  test('P6-23 the 100-row cap, "Show 100 more" and the whole-range export', async ({ page }, info) => {
    test.slow();
    await clearFirestore();
    const bulk = await seedHistoryBulk();
    expect(await countOrders(), 'the bulk fixture really landed').toBe(bulk.length);

    await openHistory(page);
    await expect.poll(async () => (await listedIds(page)).length, { timeout: 30000 }).toBe(100);
    const more = tid(page, 'history-more');
    await expect(more, 'CLAUDE.md Phase VI 6: "Show 100 more (<n> left)"').toBeVisible();
    expect((await more.innerText()).trim()).toBe('Show 100 more (130 left)');
    expect(await heightOf(more)).toBeGreaterThanOrEqual(47.5);
    // Money comparisons strip the thousands separator: the brief never fixes one.
    expect((await summaryText(page)).replace(/,/g, ''),
      'the summary counts every matched order, not the 100 shown')
      .toBe('230 orders · £1150.00');

    await more.click();
    await page.waitForTimeout(800);
    expect((await listedIds(page)).length).toBe(200);
    expect((await more.innerText()).trim()).toBe('Show 100 more (30 left)');

    await more.click();
    await page.waitForTimeout(800);
    expect((await listedIds(page)).length).toBe(230);
    expect(await more.isVisible(), 'the button goes when nothing is left').toBe(false);

    // And the export carries all 230, not the 100 that were on screen.
    await page.reload();
    await expect.poll(async () => (await listedIds(page)).length, { timeout: 30000 }).toBe(100);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      tid(page, 'history-export-csv').click()
    ]);
    const rows = parseCsv(readFileSync(await download.path(), 'utf8')).slice(1);
    expect(rows.length,
      'CLAUDE.md Phase VI 8: "all of them, not only the 100 shown"').toBe(230);
  });

  /* ------------------------------------------------------- 7. the detail */

  test('P6-24/P6-25/P6-27/P6-28 the detail: fields, timeline, Changes and the note',
    async ({ page }, info) => {
      const { X } = await openHistory(page);

      if (!isPhone(info)) {
        await expect(tid(page, 'history-detail-empty')).toBeVisible();
        expect((await textOf(tid(page, 'history-detail-empty'))).trim())
          .toBe('Select an order to see its items and history.');
      }

      await openDetail(page, 'h10');
      expect(await detailField(page, 'no')).toBe('B-002');
      expect(await detailField(page, 'name')).toBe('Sohini');
      expect(await detailField(page, 'status')).toBe('Collected');
      expect(await detailField(page, 'till')).toBe('B');
      expect(await detailField(page, 'pay')).toBe('Cash');
      expect(await detailField(page, 'wait')).toBe('6 min');
      expect(await detailField(page, 'total')).toBe('£10.00');
      expect(await detailField(page, 'day'), 'the detail names the day, not just the time')
        .toMatch(/\d{4}/);
      await expect(tid(page, 'history-line-sweet_box')).toBeVisible();
      expect((await textOf(tid(page, 'history-line-sweet_box'))).replace(/\s+/g, ' '))
        .toContain('2×');
      expect(await tid(page, 'history-line-sweet_box').locator('svg').count(),
        'each item line draws its icon').toBeGreaterThan(0);

      // Timeline: Placed, Edited, Started, Edited, Ready, Collected.
      const steps = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="history-step-"]')]
        .map((n) => ({
          key: n.dataset.testid.replace('history-step-', ''),
          text: (n.innerText || '').replace(/\s+/g, ' ').trim()
        })));
      expect(steps.map((s) => s.key))
        .toEqual(['placed', 'edited-1', 'started', 'edited-2', 'ready', 'collected']);
      expect(steps.map((s) => s.text.split(' ').pop()))
        .toEqual(['16:31', '16:33', '16:34', '16:36', '16:37', '16:39']);

      // Changes: one box per edit, in order, with the money line.
      await expect(tid(page, 'history-changes')).toBeVisible();
      const first = (await textOf(tid(page, 'history-change-1'))).replace(/\s+/g, ' ');
      expect(first).toContain('Edited 16:33 at till B while New');
      expect(first).toContain('1× Sweet Box · £5.00');
      expect(first).toContain('3× Sweet Box · £15.00');
      expect(first, 'the money line is past tense: the till moved the money').toContain('Took £10.00 more');
      const second = (await textOf(tid(page, 'history-change-2'))).replace(/\s+/g, ' ');
      expect(second).toContain('Edited 16:36 at till A while Preparing');
      expect(second).toContain('2× Sweet Box · £10.00');
      expect(second).toContain('Gave back £5.00');

      // The read-only note, verbatim.
      expect((await textOf(tid(page, 'history-detail'))).replace(/\s+/g, ' '))
        .toContain('Read-only history. Nothing here changes an order. '
          + 'Cancelled orders are listed but excluded from every total.');

      // An order edited once, with no money difference.
      await goBackToList(page, info);
      await openDetail(page, 'h05');
      expect(await page.locator('[data-testid^="history-change-"]').count()).toBe(1);
      expect((await textOf(tid(page, 'history-change-1'))).replace(/\s+/g, ' '))
        .toContain('No payment change');
    });

  test('P6-26 the cancelled box names the reason and the status before', async ({ page }, info) => {
    await openHistory(page);
    await openDetail(page, 'h08');
    const box = tid(page, 'history-detail-cancelled');
    await expect(box, 'CLAUDE.md Phase VI 7: a red box for a cancelled order').toBeVisible();
    expect((await textOf(box)).replace(/\s+/g, ' ').trim())
      .toBe('Cancelled 11:23 · Not collected · was Ready');
    const steps = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="history-step-"]')]
      .map((n) => n.dataset.testid.replace('history-step-', '')));
    expect(steps, 'Placed → Cancelled, and no Collected step').toEqual(['placed', 'cancelled']);
    expect(await detailField(page, 'wait'),
      'CLAUDE.md Phase IV 5: Wait is placed to ready, and h08 did reach Ready before it was cancelled')
      .toBe('6 min');

    await goBackToList(page, info);
    await openDetail(page, 'h02');
    expect((await textOf(tid(page, 'history-detail-cancelled'))).replace(/\s+/g, ' ').trim())
      .toBe('Cancelled 13:09 · Placed by mistake · was New');

    await goBackToList(page, info);
    await openDetail(page, 'h01');
    expect(await tid(page, 'history-detail-cancelled').count(),
      'no cancelled box on an order that was not cancelled').toBe(0);
  });

  test('P6-28b a pre-Phase-V order renders with no Changes section and no console error',
    async ({ page }, info) => {
      const errors = attachConsole(page);
      await page.goto('/#/reports/history');
      await expect(tid(page, 'history-from')).toBeVisible({ timeout: 20000 });
      await pickRange(page, '30d');
      await openDetail(page, 'h11');
      expect(await detailField(page, 'no')).toBe('A-007');
      expect(await detailField(page, 'total')).toBe('£10.00');
      expect(await tid(page, 'history-changes').count(),
        'CLAUDE.md Phase VI 7: "Orders from before Phase V … show no Changes section"').toBe(0);
      expect((await textOf(tid(page, 'history-detail'))).replace(/\s+/g, ' '),
        'the Phase I tendered value is never shown').not.toContain('£20.00');
      const steps = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="history-step-"]')]
        .map((n) => n.dataset.testid.replace('history-step-', '')));
      expect(steps).toEqual(['placed', 'started', 'ready', 'collected']);
      await expectNoConsoleErrors(errors, 'the detail of a pre-Phase-V order');
    });

  test('P6-29 Copy link puts a working link on the clipboard', async ({ page, context }, info) => {
    await grantClipboard(context);
    const { X } = await openHistory(page);
    await setFilters(page, info, { status: 'collected' });
    await openDetail(page, 'h10');

    const button = tid(page, 'history-copy-link');
    expect((await button.innerText()).trim()).toBe('Copy link to this order');
    await button.click();
    await expect(button, 'CLAUDE.md Phase VI 7: the label changes for 3 s')
      .toHaveText('Link copied', { timeout: 5000 });

    const link = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
      || await page.evaluate(() => location.href);
    expect(link, 'the link carries the selected order').toContain('order=h10');
    expect(link).toContain(`from=${X.defaultRange.from}`);
    expect(link).toContain('status=collected');

    await expect(button, 'and goes back after about 3 s')
      .toHaveText('Copy link to this order', { timeout: 8000 });

    // The link opens the same view in a new page.
    const twin = await context.newPage();
    await twin.goto(link);
    await expect(twin.locator('[data-testid="history-detail-no"]')).toBeVisible({ timeout: 20000 });
    await twin.waitForTimeout(600);
    expect(await twin.locator('[data-testid="history-detail-no"]').innerText()).toBe('B-002');
    expect(await twin.locator('[data-testid="history-from"]').inputValue()).toBe(X.defaultRange.from);
    expect(await twin.locator('[data-testid="history-status-collected"]').getAttribute('aria-pressed'))
      .toBe('true');
    await twin.close();
  });

  test('P6-30 "Open this day in Orders", the back button and the browser Back', async ({ page }, info) => {
    const { X } = await openHistory(page);
    await openDetail(page, 'h10');

    const openDay = tid(page, 'history-open-day');
    expect(await openDay.getAttribute('href'),
      'CLAUDE.md Phase VI 7: "Open this day in Orders"').toBe(`#/reports/orders?day=${X.days.t6}`);
    await openDay.click();
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => location.hash)).toBe(`#/reports/orders?day=${X.days.t6}`);
    await expect(tid(page, 'orders-day')).toHaveValue(X.days.t6);
    await expect(page.locator('text=B-002').first()).toBeVisible({ timeout: 15000 });

    await gotoRoute(page, '#/reports/history');
    await page.waitForTimeout(800);
    await openDetail(page, 'h10');
    if (isPhone(info)) {
      await expect(tid(page, 'history-back'), 'CLAUDE.md Phase VI 7: "‹ Order history"').toBeVisible();
      expect((await textOf(tid(page, 'history-back'))).trim()).toContain('Order history');
      await tid(page, 'history-back').click();
      await page.waitForTimeout(600);
      expect(await listedIds(page), 'the list comes back whole').toEqual(X.defaultIds);
      await openDetail(page, 'h05');
    }
    await page.goBack();
    await page.waitForTimeout(800);
    expect(await listedIds(page), 'the browser Back button returns to the list').toEqual(X.defaultIds);
  });

  test('P6-26b/P6-31 hash round trip and the history CSV', async ({ page }, info) => {
    const { X } = await openHistory(page);

    // Every parameter survives a reload.
    const hash = `#/reports/history?from=${X.days.t29}&to=${X.days.t}&status=open&pay=card`
      + '&till=A&item=marshmallow&edited=0&q=a-0&order=h09';
    await page.goto('/' + hash);
    await expect(tid(page, 'history-detail-no')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(600);
    expect(await tid(page, 'history-from').inputValue()).toBe(X.days.t29);
    expect(await tid(page, 'history-to').inputValue()).toBe(X.days.t);
    expect(await tid(page, 'history-search').inputValue()).toBe('a-0');
    expect(await listedIds(page), 'status=open + pay=card + till=A + item=marshmallow + q=a-0')
      .toEqual(['h09']);
    expect(await detailField(page, 'no')).toBe('A-001');
    await page.reload();
    await expect(tid(page, 'history-detail-no')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(600);
    expect(await listedIds(page), 'a reload keeps range, filters and selection').toEqual(['h09']);
    expect(await detailField(page, 'no')).toBe('A-001');

    // A hashchange with no from/to keeps the current range (DECISIONS.md,
    // 20 Oct 2026), and a bare hash on a cold load falls back to Last 7 days.
    await gotoRoute(page, '#/reports/history');
    await page.waitForTimeout(800);
    expect(await tid(page, 'history-from').inputValue(),
      'a hashchange with no range keeps the one on screen').toBe(X.days.t29);
    await page.goto('/#/reports/history');
    await page.reload();
    await expect(tid(page, 'history-summary')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(700);
    expect(await tid(page, 'history-from').inputValue(),
      'a bare hash on a cold load falls back to Last 7 days').toBe(X.defaultRange.from);

    // The CSV of the default range.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      tid(page, 'history-export-csv').click()
    ]);
    expect(download.suggestedFilename(),
      'CLAUDE.md Phase VI 8: nba-food-stall_history_<from>_<to>.csv')
      .toBe(`nba-food-stall_history_${X.defaultRange.from}_${X.defaultRange.to}.csv`);
    const text = readFileSync(await download.path(), 'utf8');
    const rows = parseCsv(text);
    expect(rows[0].join(','), 'the Orders columns, including edited and cancelReason').toBe(
      'day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds,edited,cancelReason');
    const body = rows.slice(1);
    expect(body.length, 'one row per order line of all ten matched orders').toBe(15);
    expect(body.every((r) => r.length === 15)).toBe(true);
    const col = (name) => rows[0].indexOf(name);
    expect(body.map((r) => r[col('orderNo')]).filter((v, i, a) => a.indexOf(v) === i),
      'the list order, newest first')
      .toEqual(['A-003', 'A-002', 'A-001', 'B-012', 'A-031', 'A-030', 'A-012', 'C-001', 'B-002']);
    for (const r of body) {
      expect(Number(r[col('lineTotal')])).toBe(Number(r[col('qty')]) * Number(r[col('price')]));
    }
    expect(body.find((r) => r[col('orderNo')] === 'A-031')[col('edited')]).toBe('yes');
    expect(body.find((r) => r[col('orderNo')] === 'A-003')[col('edited')]).toBe('no');
    expect(body.find((r) => r[col('orderNo')] === 'C-001')[col('cancelReason')]).toBe('not_collected');
    expect(body.find((r) => r[col('orderNo')] === 'A-002')[col('status')]).toBe('cancelled');
    expect(text, 'the Phase I tendered value is never exported').not.toContain('2000');

    // Filtered: only the matched orders.
    await setFilters(page, info, { status: 'cancelled' });
    const [second] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      tid(page, 'history-export-csv').click()
    ]);
    const only = parseCsv(readFileSync(await second.path(), 'utf8')).slice(1);
    expect(only.length, 'a Cancelled-only view exports its rows').toBe(2);
    expect(only.every((r) => r[col('status')] === 'cancelled')).toBe(true);
  });

  /* ------------------------------------------------------- 8. the quality */

  test('P6-33/P6-34/P6-35 touch targets, text size and no horizontal scroll', async ({ page }, info) => {
    await openHistory(page);

    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('main button, main a[href], main input, main select')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()}[${el.dataset.testid || (el.textContent || '').trim().slice(0, 18)}] = ${Math.round(r.height)}px`);
      }
      return out;
    });
    expect(small, `CLAUDE.md Design: nothing below 44 px\n${small.join('\n')}`).toEqual([]);

    for (const name of ['report-view-history', 'history-refresh', 'history-export-csv',
      'history-range-today', 'history-range-7d', 'history-range-30d', 'history-range-year']) {
      expect(await heightOf(tid(page, name)), `${name} is at least 48 px`).toBeGreaterThanOrEqual(47.5);
    }

    const bodySize = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    expect(bodySize, 'CLAUDE.md Design: body text at least 17 px').toBeGreaterThanOrEqual(17);

    await openDetail(page, 'h10');
    for (const name of ['history-copy-link', 'history-open-day']) {
      expect(await heightOf(tid(page, name)), `${name} is at least 48 px`).toBeGreaterThanOrEqual(47.5);
    }

    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(700);
    const overflow = async () => page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    let box = await overflow();
    expect(box.scrollWidth, 'no horizontal scroll at 360 px with the detail open')
      .toBeLessThanOrEqual(box.clientWidth + 1);

    await goBackToList(page, info);
    box = await overflow();
    expect(box.scrollWidth, 'no horizontal scroll at 360 px on the list')
      .toBeLessThanOrEqual(box.clientWidth + 1);

    if (isPhone(info)) {
      await openFilterSheet(page);
      box = await overflow();
      expect(box.scrollWidth, 'no horizontal scroll with the filter sheet open')
        .toBeLessThanOrEqual(box.clientWidth + 1);
      await closeFilterSheet(page);
    }
  });

  test('P6-36 axe finds nothing serious or critical', async ({ page }, info) => {
    await openHistory(page);
    const scan = async (where) => {
      const result = await new AxeBuilder({ page }).analyze();
      const bad = result.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
      expect(bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}`),
        `axe on the history screen: ${where}`).toEqual([]);
    };

    await scan('the list');
    await openDetail(page, 'h10');
    await scan('an order open');
    await goBackToList(page, info);
    if (isPhone(info)) {
      await openFilterSheet(page);
      await scan('the filter sheet');
      await closeFilterSheet(page);
    }
    await setFilters(page, info, { q: 'zzz' });
    await scan('the empty state');
  });

  test('P6-37 no console errors across the whole screen', async ({ page }, info) => {
    const errors = attachConsole(page);
    await page.goto('/#/reports/history');
    await expect(tid(page, 'history-summary')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(600);

    for (const key of ['today', '30d', 'year', '7d']) await pickRange(page, key);
    await setFilters(page, info, { status: 'collected', q: 'a' });
    await setFilters(page, info, { clear: true, q: '' });
    await openDetail(page, 'h10');
    await goBackToList(page, info);
    await openDetail(page, 'h08');
    await goBackToList(page, info);
    await pickRange(page, '30d');
    await openDetail(page, 'h11');          // the pre-Phase-V order, on T-7
    await goBackToList(page, info);
    await pickRange(page, '7d');
    await setRange(page, londonDayOffset(-366), null);
    await expect(tid(page, 'history-range-error')).toBeVisible();
    await pickRange(page, '7d');
    await tid(page, 'history-refresh').click();
    await page.waitForTimeout(1200);

    await expectNoConsoleErrors(errors, '#/reports/history');
  });

  test('P6-38 screenshots', async ({ page }, info) => {
    const project = info.project.name;
    await openHistory(page);
    await shot(page, project, 'reports-history', 'orders');
    await openDetail(page, 'h10');
    await shot(page, project, 'reports-history', 'detail');
    await goBackToList(page, info);
    if (isPhone(info)) {
      await openFilterSheet(page);
      await shot(page, project, 'reports-history', 'filters');
      await closeFilterSheet(page);
    }
    await setFilters(page, info, { q: 'zzz' });
    await expect(tid(page, 'history-empty')).toBeVisible();
    await shot(page, project, 'reports-history', 'empty-filters');
  });
});

/** Leave the detail: the phone replaces the list with it, the tablet does not. */
async function goBackToList(page, info) {
  if (isPhone(info) && await tid(page, 'history-back').isVisible().catch(() => false)) {
    await tid(page, 'history-back').click();
  } else {
    await page.goBack();
  }
  await page.waitForTimeout(600);
}
