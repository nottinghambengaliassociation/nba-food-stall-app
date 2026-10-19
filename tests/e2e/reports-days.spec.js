// P3-* — Phase III "Sales by day" (#/reports/days).
// Spec: CLAUDE.md "Phase III: Sales by day report" 1–10 and the mock-ups
// design/ReportsByDay.dc.html and design/Reports.dc.html (the toggle).
// Fixture and hand-calculated figures: helpers.rangeFixture / rangeExpect.
import { test, expect } from './session.js';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import {
  clearFirestore, openApp, gotoRoute, tid, londonDay, londonDayOffset,
  seedRangeDays, seedEvent, rangeExpect, dayLabelOf, weekdayOf, gbp, textOf,
  attachConsole, expectNoConsoleErrors, parseCsv, shot, heightOf
} from './helpers.js';

const BEST = 'rgb(180, 83, 9)';      // #B45309
const OTHER = 'rgb(251, 191, 36)';   // #FBBF24
const BEST_CELL = 'rgb(254, 243, 199)'; // #FEF3C7

/** The computed fill colour of a chart bar: the bar button is transparent. */
async function barColour(page, day) {
  return tid(page, `day-bar-${day}`).evaluate((bar) => {
    for (const node of bar.querySelectorAll('*')) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(0, 0, 0, 0\)/.test(bg)) return bg;
    }
    return getComputedStyle(bar).backgroundColor;
  });
}

/** Rows of the "Items sold by day" matrix, read straight out of the table. */
async function readMatrix(page) {
  return tid(page, 'items-by-day-table').evaluate((table) => {
    const head = [...table.querySelectorAll('thead th')].map((th) => (th.textContent || '').trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) => {
      const cells = [...tr.children];
      return {
        name: (cells[0].textContent || '').trim(),
        values: cells.slice(1).map((td) => (td.textContent || '').trim()),
        backgrounds: cells.slice(1).map((td) => getComputedStyle(td).backgroundColor)
      };
    });
    return { head, rows };
  });
}

/**
 * Requests the page makes to the Firestore emulator while the collector is
 * attached. Used to prove a too-long range makes no query at all.
 */
function collectQueries(page) {
  const seen = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.includes('127.0.0.1:8080') && !url.includes('localhost:8080')) return;
    let body = '';
    try { body = req.postData() || ''; } catch { body = ''; }
    seen.push(url + ' ' + body);
  });
  return seen;
}

async function setRange(page, from, to) {
  if (from !== null) {
    await tid(page, 'range-from').fill(from);
    await tid(page, 'range-from').dispatchEvent('change');
    await page.waitForTimeout(250);
  }
  if (to !== null) {
    await tid(page, 'range-to').fill(to);
    await tid(page, 'range-to').dispatchEvent('change');
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(500);
}

/** Open #/reports/days with the scripted range already seeded and rendered. */
async function openDaysWithFixture(page) {
  const errors = await openApp(page, '#/reports/days');
  const X = rangeExpect();
  await expect(tid(page, `day-row-${X.totals.bestDay}`)).toBeVisible({ timeout: 20000 });
  return { errors, X };
}

test.describe('Phase III — Sales by day', () => {
  test.beforeEach(async () => {
    await clearFirestore();
    await seedRangeDays();
  });

  /* ------------------------------------------------------------- toggle */

  test('P3-01 the One day / Sales by day toggle works both ways and is 48px', async ({ page }) => {
    await openApp(page, '#/reports');
    const dayPill = tid(page, 'report-toggle-day');
    const daysPill = tid(page, 'report-toggle-days');
    await expect(dayPill, 'CLAUDE.md Phase III 1: both report screens carry the toggle').toBeVisible({ timeout: 20000 });
    await expect(daysPill).toBeVisible();

    for (const pill of [dayPill, daysPill]) {
      expect(await heightOf(pill), 'CLAUDE.md Phase III 1: pill buttons at least 48 px').toBeGreaterThanOrEqual(47.5);
    }

    // On #/reports, "One day" is the filled ink pill.
    const inkOnDay = await dayPill.evaluate((el) => {
      const node = el.querySelector('a, button') || el;
      return getComputedStyle(node).backgroundColor;
    });
    expect(inkOnDay, 'the current view is filled ink #1C1917').toBe('rgb(28, 25, 23)');

    await daysPill.click();
    await page.waitForTimeout(600);
    expect(page.url()).toContain('#/reports/days');
    await expect(tid(page, 'days-table')).toBeVisible({ timeout: 20000 });

    const inkOnDays = await tid(page, 'report-toggle-days').evaluate((el) => {
      const node = el.querySelector('a, button') || el;
      return getComputedStyle(node).backgroundColor;
    });
    expect(inkOnDays, 'on #/reports/days the "Sales by day" pill is filled ink').toBe('rgb(28, 25, 23)');
    const otherPill = await tid(page, 'report-toggle-day').evaluate((el) => {
      const node = el.querySelector('a, button') || el;
      return getComputedStyle(node).backgroundColor;
    });
    expect(otherPill, 'only the current view is filled').not.toBe('rgb(28, 25, 23)');

    await tid(page, 'report-toggle-day').click();
    await page.waitForTimeout(600);
    expect(page.url()).toMatch(/#\/reports(\?|$)/);
    await expect(tid(page, 'report-date')).toBeVisible({ timeout: 15000 });
  });

  test('P3-02 #/reports/days loads directly and defaults to the last 7 days ending today', async ({ page }) => {
    await openApp(page, '#/reports/days');
    const from = tid(page, 'range-from');
    const to = tid(page, 'range-to');
    await expect(from).toBeVisible({ timeout: 20000 });
    expect(await from.getAttribute('type'), 'From is a date input').toBe('date');
    expect(await to.getAttribute('type'), 'To is a date input').toBe('date');
    expect(await to.inputValue(), 'default range ends today').toBe(londonDay());
    expect(await from.inputValue(), 'default range is the last 7 days').toBe(londonDayOffset(-6));
  });

  /* ------------------------------------------------- trading days / tiles */

  test('P3-03 only trading days appear and cancelled orders count nowhere', async ({ page }) => {
    const { X } = await openDaysWithFixture(page);

    for (const day of X.trading) {
      await expect(tid(page, `day-row-${day}`), `${day} traded and must have a row`).toBeVisible();
      await expect(tid(page, `day-bar-${day}`), `${day} needs a bar`).toBeVisible();
    }
    for (const day of X.quiet) {
      await expect(tid(page, `day-row-${day}`), `CLAUDE.md Phase III 4: ${day} had no orders and must be absent`).toHaveCount(0);
      await expect(tid(page, `day-bar-${day}`)).toHaveCount(0);
    }
    expect(await tid(page, 'days-table').locator('tbody tr').count(),
      'five trading days plus the totals row').toBe(X.totals.tradingDays + 1);

    // The cancelled £10 order on the second trading day is excluded everywhere.
    const row = await textOf(tid(page, `day-row-${X.days.d1}`));
    expect(row).toContain(gbp(2500));
    expect(row, 'the cancelled order must not be in the day row').not.toContain(gbp(3500));
  });

  test('P3-04 the five totals tiles and their notes match the hand-calculated figures', async ({ page }) => {
    const { X } = await openDaysWithFixture(page);
    const t = X.totals;

    const sales = await textOf(tid(page, 'tile-total-sales'));
    expect(sales).toContain('Total sales');
    expect(sales, 'total sales = £165.00').toContain(gbp(t.sales));

    const orders = await textOf(tid(page, 'tile-orders'));
    expect(orders).toContain('Orders');
    expect(orders).toMatch(new RegExp(`\\b${t.orders}\\b`));
    expect(orders, 'CLAUDE.md Phase III 5: the Orders tile is noted "excludes cancelled"').toContain('excludes cancelled');

    const items = await textOf(tid(page, 'tile-items'));
    expect(items).toContain('Items sold');
    expect(items).toMatch(new RegExp(`\\b${t.items}\\b`));
    expect(items, 'note "x.x per order"').toContain(`${t.itemsPerOrder} per order`);

    const best = await textOf(tid(page, 'tile-best-day'));
    expect(best).toContain('Best day');
    expect(best, 'the best day is named').toContain(dayLabelOf(t.bestDay));
    expect(best, 'and shows its sales').toContain(gbp(t.bestSales));

    const avg = await textOf(tid(page, 'tile-avg-day'));
    expect(avg).toContain('Average per trading day');
    expect(avg, '£165.00 over 5 trading days = £33.00').toContain(gbp(t.averagePerDay));
    expect(avg, 'note "n orders a day"').toContain(`${t.ordersPerDay} orders a day`);
  });

  /* -------------------------------------------------------------- chart */

  test('P3-05 the bar chart: one real button per day, best day shaded, readout on hover, focus and tap', async ({ page }) => {
    const { X } = await openDaysWithFixture(page);
    await expect(tid(page, 'days-chart')).toBeVisible();

    const bars = page.locator('[data-testid^="day-bar-"]');
    expect(await bars.count(), 'one bar per trading day').toBe(X.trading.length);

    for (const row of X.rows) {
      const bar = tid(page, `day-bar-${row.day}`);
      expect(await bar.evaluate((el) => el.tagName.toLowerCase()),
        'CLAUDE.md Phase III 6: each bar is a real <button>').toBe('button');
      const aria = await bar.getAttribute('aria-label');
      expect(aria, `bar ${row.day} needs an aria-label`).toBeTruthy();
      expect(aria).toContain(dayLabelOf(row.day));
      expect(aria).toContain(gbp(row.sales));
      expect(aria).toContain(String(row.orders));
      // The value label rides on the bar.
      expect(await textOf(bar)).toContain(gbp(row.sales));
    }

    expect(await barColour(page, X.totals.bestDay), 'the best day is #B45309').toBe(BEST);
    for (const row of X.rows.filter((r) => r.day !== X.totals.bestDay)) {
      expect(await barColour(page, row.day), `${row.day} is #FBBF24`).toBe(OTHER);
    }

    // Weekday and date under every bar.
    const labels = await textOf(page.locator('.days-chart__labels').first()).catch(() => '');
    for (const day of X.trading) {
      expect(labels || await textOf(tid(page, 'days-chart'))).toContain(weekdayOf(day));
    }

    const readout = tid(page, 'days-readout');
    const expected = (day) => {
      const row = X.rows.find((r) => r.day === day);
      return `${dayLabelOf(day)} · ${gbp(row.sales)} · ${row.orders} orders`;
    };
    // Park the pointer off the chart between interactions: a mouse left
    // hovering one bar would keep answering for it when the page scrolls.
    const parkPointer = async () => { await page.mouse.move(2, 2); await page.waitForTimeout(150); };

    await tid(page, 'days-chart').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    // Hover
    await tid(page, `day-bar-${X.days.d0}`).hover();
    await page.waitForTimeout(250);
    expect(await textOf(readout), 'hover readout format from design/ReportsByDay.dc.html').toBe(expected(X.days.d0));

    // Focus
    await parkPointer();
    await tid(page, `day-bar-${X.days.d3}`).focus();
    await page.waitForTimeout(250);
    expect(await textOf(readout), 'focusing a bar must show its readout too').toBe(expected(X.days.d3));

    // Tap
    await parkPointer();
    await tid(page, `day-bar-${X.days.d6}`).tap();
    await page.waitForTimeout(400);
    expect(await textOf(readout), 'tapping a bar must show its readout too').toBe(expected(X.days.d6));
  });

  /* ---------------------------------------------------------- day table */

  test('P3-06 the Day by day table: columns, every row and the totals row', async ({ page }) => {
    const { X } = await openDaysWithFixture(page);

    const headers = await tid(page, 'days-table').locator('thead th').allInnerTexts();
    const clean = headers.map((h) => h.replace(/\s+/g, ' ').trim());
    for (const col of ['Day', 'Orders', 'Items', 'Sales', 'Cash', 'Card', 'Avg order', 'Peak 30 min']) {
      expect(clean, `CLAUDE.md Phase III 7 column "${col}"`).toContain(col);
    }

    for (const row of X.rows) {
      const cells = (await tid(page, `day-row-${row.day}`).locator('td').allInnerTexts())
        .map((c) => c.replace(/\s+/g, ' ').trim());
      expect(cells[0], `${row.day} label`).toBe(dayLabelOf(row.day));
      expect(cells[1]).toBe(String(row.orders));
      expect(cells[2]).toBe(String(row.items));
      expect(cells[3]).toBe(gbp(row.sales));
      expect(cells[4]).toBe(gbp(row.cash));
      expect(cells[5]).toBe(gbp(row.card));
      expect(cells[6]).toBe(gbp(row.avgOrder));
      expect(cells[7], `${row.day} peak 30 minutes`).toBe(row.peak);
    }

    const totals = (await tid(page, 'days-totals-row').locator('td').allInnerTexts())
      .map((c) => c.replace(/\s+/g, ' ').trim());
    expect(totals[1]).toBe(String(X.totals.orders));
    expect(totals[2]).toBe(String(X.totals.items));
    expect(totals[3]).toBe(gbp(X.totals.sales));
    expect(totals[4]).toBe(gbp(X.totals.cash));
    expect(totals[5]).toBe(gbp(X.totals.card));
    expect(totals[6]).toBe(gbp(X.totals.avgOrder));
  });

  test('P3-07 "Open day" opens the One day report on that date with matching figures', async ({ page }) => {
    const { X } = await openDaysWithFixture(page);
    const day = X.totals.bestDay;
    const link = tid(page, `open-day-${day}`);
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href'), 'CLAUDE.md Phase III 7').toBe(`#/reports?day=${day}`);

    await link.click();
    await page.waitForTimeout(1200);
    expect(page.url()).toContain(`#/reports?day=${day}`);
    await expect(tid(page, 'report-date')).toBeVisible({ timeout: 20000 });
    expect(await tid(page, 'report-date').inputValue(), 'the One day report opens on that date').toBe(day);

    const row = X.rows.find((r) => r.day === day);
    await expect(tid(page, 'kpi-sales')).toHaveText(gbp(row.sales), { timeout: 15000 });
    await expect(tid(page, 'kpi-orders')).toHaveText(String(row.orders));
    await expect(tid(page, 'kpi-items')).toHaveText(String(row.items));
  });

  /* -------------------------------------------------------- item matrix */

  test('P3-08 the Items sold by day matrix, retired ids under their original names, best cells shaded', async ({ page }) => {
    const { X } = await openDaysWithFixture(page);
    await expect(tid(page, 'items-by-day-table')).toBeVisible();

    const { head, rows } = await readMatrix(page);
    expect(head[0]).toBe('Item');
    expect(head.slice(-2), 'then Total and Sales (CLAUDE.md Phase III 8)').toEqual(['Total', 'Sales']);
    expect(head.length, 'Item + one column per trading day + Total + Sales')
      .toBe(X.trading.length + 3);
    for (let i = 0; i < X.trading.length; i++) {
      expect(head[i + 1], 'a column per trading day').toBe(weekdayOf(X.trading[i]));
    }

    expect(rows.map((r) => r.name), 'one row per item that sold, in menu order')
      .toEqual(X.items.map((i) => i.name));

    for (let i = 0; i < X.items.length; i++) {
      const expected = X.items[i];
      const got = rows[i];
      const perDay = X.trading.map((d) => String(expected.units[d]));
      expect(got.values.slice(0, X.trading.length), `${expected.id} units by day`).toEqual(perDay);
      expect(got.values[X.trading.length], `${expected.id} total`).toBe(String(expected.total));
      expect(got.values[X.trading.length + 1], `${expected.id} sales`).toBe(gbp(expected.sales));

      // Each item's best day cell is shaded #FEF3C7 and no other day cell is.
      const shaded = X.trading.filter((d, j) => got.backgrounds[j] === BEST_CELL);
      expect(shaded, `CLAUDE.md Phase III 8: ${expected.id} shades only its best day`).toEqual([expected.bestDay]);
    }

    // Retired ids keep their original names and are never merged.
    const names = rows.map((r) => r.name);
    expect(names, 'Hotfix H1 6: a legacy samosa line reports under its original name')
      .toContain('Sweets Box Samosa / Shingara');
    expect(names).toContain('Chocolate Strawberry & Marshmallow (V)');
    expect(names).toContain('Chocolate Strawberry');

    const note = await textOf(page.locator('text=Shading marks').first());
    expect(note).toBe("Shading marks each item's best day.");
  });

  /* ----------------------------------------------------------- range CSV */

  test('P3-09 Export CSV for Sheets: file name, columns and one row per order line', async ({ page }) => {
    const { X } = await openDaysWithFixture(page);
    const button = tid(page, 'export-days-csv');
    await expect(button, 'CLAUDE.md Phase III 9').toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      button.click()
    ]);
    expect(download.suggestedFilename(),
      'CLAUDE.md Phase III 9: nba-food-stall_<from>_<to>.csv')
      .toBe(`nba-food-stall_${londonDayOffset(-6)}_${londonDay()}.csv`);

    const text = readFileSync(await download.path(), 'utf8');
    expect(text.split(/\r?\n/)[0], 'same columns as the One day CSV')
      .toBe('day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds');

    const rows = parseCsv(text);
    const col = (n) => rows[0].indexOf(n);
    const body = rows.slice(1);
    // 14 live order lines across the five trading days; the cancelled order is out.
    // (1 + 1) + (1 + 2) + (1 + 1) + (1 + 1 + 1) + (3 + 1) = 14
    const liveLines = 14;
    expect(body.length, 'one row per order line in range').toBe(liveLines);
    expect(body.some((r) => r[col('orderNo')] === 'B-003'), 'the cancelled order is excluded').toBe(false);
    expect(new Set(body.map((r) => r[col('day')])).size).toBe(X.trading.length);
    for (const r of body) {
      expect(r).toHaveLength(13);
      expect(Number(r[col('lineTotal')])).toBe(Number(r[col('qty')]) * Number(r[col('price')]));
    }
    expect(rows[0], 'CLAUDE.md Phase III 10: the legacy tendered field never appears').not.toContain('tendered');
    expect(text).not.toMatch(/tendered/i);
    const legacy = body.find((r) => r[col('orderNo')] === 'A-010');
    expect(legacy[col('item')]).toBe('Sweets Box Samosa / Shingara');
    expect(legacy, 'the legacy tender amount is not exported').not.toContain('2000');
  });

  /* -------------------------------------------------------- range rules */

  test('P3-10 To before From swaps; Today and Last 7 days set the inputs', async ({ page }) => {
    const { X } = await openDaysWithFixture(page);

    await setRange(page, londonDay(), X.days.d0);
    expect(await tid(page, 'range-from').inputValue(), 'CLAUDE.md Phase III 2: To before From swaps them').toBe(X.days.d0);
    expect(await tid(page, 'range-to').inputValue()).toBe(londonDay());
    await expect(tid(page, 'range-error')).toBeHidden();

    await tid(page, 'quick-today').click();
    await page.waitForTimeout(800);
    expect(await tid(page, 'range-from').inputValue()).toBe(londonDay());
    expect(await tid(page, 'range-to').inputValue()).toBe(londonDay());
    // Only today's figures remain.
    await expect(tid(page, `day-row-${londonDay()}`)).toBeVisible({ timeout: 15000 });
    await expect(tid(page, `day-row-${X.days.d4}`)).toHaveCount(0);
    expect(await textOf(tid(page, 'tile-total-sales'))).toContain(gbp(3000));

    await tid(page, 'quick-7days').click();
    await page.waitForTimeout(800);
    expect(await tid(page, 'range-from').inputValue()).toBe(londonDayOffset(-6));
    expect(await tid(page, 'range-to').inputValue()).toBe(londonDay());
    await expect(tid(page, `day-row-${X.days.d0}`)).toBeVisible({ timeout: 15000 });
    expect(await textOf(tid(page, 'tile-total-sales'))).toContain(gbp(X.totals.sales));
  });

  test('P3-11 31 days is allowed, 32 shows "Pick 31 days or fewer" and makes no query', async ({ page }) => {
    await openApp(page, '#/reports/days');
    await expect(tid(page, 'range-from')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1500);

    // Exactly 31 days is fine and still queries.
    await setRange(page, londonDayOffset(-30), londonDay());
    await expect(tid(page, 'range-error'), '31 days is inside the maximum').toBeHidden();
    await expect(tid(page, `day-row-${londonDay()}`)).toBeVisible({ timeout: 15000 });

    const queries = collectQueries(page);
    const tooFar = londonDayOffset(-31); // 32 days inclusive
    await setRange(page, tooFar, londonDay());

    const error = tid(page, 'range-error');
    await expect(error, 'CLAUDE.md Phase III 2').toBeVisible();
    expect(await textOf(error)).toBe('Pick 31 days or fewer');

    await page.waitForTimeout(1500);
    const hits = queries.filter((q) => q.includes(tooFar));
    expect(hits, `a too-long range must not be queried; saw ${hits.length} request(s) carrying ${tooFar}`).toEqual([]);

    // Going back inside the limit recovers.
    await setRange(page, londonDayOffset(-6), londonDay());
    await expect(error).toBeHidden();
    await expect(tid(page, 'days-table')).toBeVisible({ timeout: 15000 });
  });

  test('P3-12 an empty range says "No sales in this range"', async ({ page }) => {
    await openApp(page, '#/reports/days');
    await expect(tid(page, 'range-from')).toBeVisible({ timeout: 20000 });
    await setRange(page, '2020-01-01', '2020-01-07');
    const empty = tid(page, 'days-empty');
    await expect(empty, 'CLAUDE.md Phase III 4').toBeVisible({ timeout: 15000 });
    expect(await textOf(empty)).toContain('No sales in this range');
    await expect(tid(page, 'days-table')).toBeHidden();
    const tiles = await textOf(tid(page, 'tile-total-sales'));
    expect(tiles, 'an empty range shows zero, not NaN').toContain('£0.00');
    expect(tiles).not.toMatch(/NaN|Infinity|undefined/);
  });

  test('P3-13 "This event" is hidden without settings/event and uses its dates with it', async ({ page }) => {
    await openApp(page, '#/reports/days');
    await expect(tid(page, 'range-from')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await expect(tid(page, 'quick-event'),
      'CLAUDE.md Phase III 2: hidden when settings/event does not exist').toBeHidden();

    const X = rangeExpect();
    await seedEvent('Durga Puja 2026', X.days.d1, X.days.d4);
    await page.reload();
    await expect(tid(page, 'range-from')).toBeVisible({ timeout: 20000 });
    const quick = tid(page, 'quick-event');
    await expect(quick, 'visible once settings/event exists').toBeVisible({ timeout: 15000 });

    await quick.click();
    await page.waitForTimeout(900);
    expect(await tid(page, 'range-from').inputValue()).toBe(X.days.d1);
    expect(await tid(page, 'range-to').inputValue()).toBe(X.days.d4);
    // d1, d3 and d4 traded inside the event; d0 and d6 are outside it.
    await expect(tid(page, `day-row-${X.days.d1}`)).toBeVisible({ timeout: 15000 });
    await expect(tid(page, `day-row-${X.days.d3}`)).toBeVisible();
    await expect(tid(page, `day-row-${X.days.d4}`)).toBeVisible();
    await expect(tid(page, `day-row-${X.days.d0}`)).toHaveCount(0);
    await expect(tid(page, `day-row-${X.days.d6}`)).toHaveCount(0);
    expect(await textOf(tid(page, 'tile-total-sales')),
      'event sales = £25.00 + £15.00 + £80.00').toContain(gbp(2500 + 1500 + 8000));
  });

  /* ------------------------------------------------------------ quality */

  test('P3-14 no horizontal scroll at 360px, touch targets and no console errors', async ({ page }) => {
    const errors = attachConsole(page);
    await page.goto('/#/reports/days');
    await expect(tid(page, 'days-table')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(800);

    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('main button, main a[href], main input, main select')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (el.classList.contains('day-bar')) continue; // a chart bar, sized by its value
        if (r.height < 47.5) out.push(`${el.tagName.toLowerCase()}[${el.dataset.testid || (el.textContent || '').trim().slice(0, 16)}] = ${Math.round(r.height)}px`);
      }
      return out;
    });
    expect(small, `CLAUDE.md Design: touch targets at least 48 px\n${small.join('\n')}`).toEqual([]);

    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(overflow.scrollWidth,
      'CLAUDE.md Design: no horizontal scroll at 360 px').toBeLessThanOrEqual(overflow.clientWidth + 1);

    await expectNoConsoleErrors(errors, '#/reports/days');
  });

  test('P3-16 axe finds no serious or critical violations on #/reports/days', async ({ page }) => {
    await page.goto('/#/reports/days');
    await expect(tid(page, 'days-table')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(800);
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const detail = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`).join('\n');
    expect(bad, `#/reports/days axe serious/critical violations:\n${detail}`).toEqual([]);
  });

  test('P3-17 "Open day" is named from its visible text and the scrolling table cards take the keyboard', async ({ page }) => {
    const { X } = await openDaysWithFixture(page);

    // BUG-6 guard, independent of axe: WCAG 2.5.3 Label in Name. A speech-input
    // user says what they see, so the accessible name must contain "Open day".
    const links = await page.locator('[data-testid^="open-day-"]').evaluateAll((els) =>
      els.map((el) => ({
        testid: el.dataset.testid,
        visible: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        name: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim()
      })));
    expect(links.length, 'one Open day link per trading day').toBe(X.trading.length);
    for (const link of links) {
      expect(link.visible, `${link.testid} visible text`).toBe('Open day');
      expect(
        link.name.toLowerCase().includes(link.visible.toLowerCase()),
        `WCAG 2.5.3: ${link.testid} is named "${link.name}", which does not contain its visible text "${link.visible}"`
      ).toBe(true);
    }

    // BUG-7 guard: CLAUDE.md Phase III 7 puts the wide tables in a card that
    // scrolls sideways on narrow screens. A scroller that only a mouse can
    // reach locks a keyboard user out of the columns past the fold.
    const scrollers = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('main .table-wrap, main [style*="overflow"]')) {
        if (el.scrollWidth <= el.clientWidth + 1) continue;  // does not scroll here
        out.push({
          name: (el.getAttribute('aria-label') || '').trim(),
          role: el.getAttribute('role') || '',
          tabIndex: el.tabIndex,
          table: (el.querySelector('table') || {}).dataset?.testid || ''
        });
      }
      return out;
    });
    for (const scroller of scrollers) {
      expect(scroller.tabIndex, `the ${scroller.table || 'table'} scroller must be keyboard reachable`).toBeGreaterThanOrEqual(0);
      expect(scroller.name, `the ${scroller.table || 'table'} scroller needs an accessible name`).not.toBe('');
    }
    expect(new Set(scrollers.map((s) => s.name)).size,
      'each scrolling card needs its own name, not a shared one').toBe(scrollers.length);

    // And the keyboard really moves them.
    if (scrollers.length) {
      const moved = await page.evaluate(async () => {
        const el = [...document.querySelectorAll('main .table-wrap')].find((n) => n.scrollWidth > n.clientWidth + 1);
        el.focus();
        const focused = document.activeElement === el;
        const before = el.scrollLeft;
        el.scrollLeft = before + 60;   // what ArrowRight does on a focused scroller
        const after = el.scrollLeft;
        el.scrollLeft = before;
        return { focused, moved: after > before };
      });
      expect(moved.focused, 'the scrolling card must accept focus').toBe(true);
      expect(moved.moved, 'the scrolling card must actually scroll').toBe(true);
    }
  });

  test('P3-15 screenshots of the by-day report, with orders and empty', async ({ page }, info) => {
    await openApp(page, '#/reports/days');
    await expect(tid(page, 'days-table')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(900);
    await shot(page, info.project.name, 'reports-days', 'orders');

    await setRange(page, '2020-01-01', '2020-01-07');
    await expect(tid(page, 'days-empty')).toBeVisible({ timeout: 15000 });
    await shot(page, info.project.name, 'reports-days', 'empty');
  });
});
