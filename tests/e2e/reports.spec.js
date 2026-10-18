// R-01..R-09 — reports. Spec: CLAUDE.md "Reports" FR 1..6.
// Fixture and hand-calculated expectations: qa/test-plan.md section 8.
import { test, expect } from './session.js';
import {
  clearFirestore, openApp, tid, expectNoConsoleErrors,
  seedReportDay, londonDay, parseCsv
} from './helpers.js';
import { readFileSync } from 'node:fs';

const norm = (s) => (s || '').replace(/\s+/g, ' ').replace(/,/g, '').trim();

test.beforeEach(async () => {
  await clearFirestore();
  await seedReportDay();
});

test('R-01 the date input defaults to today in Europe/London', async ({ page }) => {
  const errors = await openApp(page, '#/reports');
  const date = tid(page, 'report-date');
  await expect(date).toBeVisible({ timeout: 15000 });
  await expect(date).toHaveValue(londonDay());
  expect(await date.evaluate((el) => el.tagName.toLowerCase() + ':' + (el.type || ''))).toBe('input:date');
  await expectNoConsoleErrors(errors, '#/reports');
});

test('R-02 every KPI matches the hand-calculated figures', async ({ page }) => {
  await openApp(page, '#/reports');
  await expect(tid(page, 'kpi-sales')).toBeVisible({ timeout: 15000 });
  await expect
    .poll(async () => norm(await tid(page, 'kpi-sales').innerText()), { timeout: 20000, message: 'total sales, cancelled A-006 excluded' })
    .toContain('£60.00');

  expect(norm(await tid(page, 'kpi-sales').innerText()), 'total sales, cancelled A-006 excluded').toContain('£60.00');
  expect(norm(await tid(page, 'kpi-orders').innerText()), 'five non-cancelled orders').toMatch(/\b5\b/);
  expect(norm(await tid(page, 'kpi-items').innerText()), '2+2+3+1+4 = 12 items').toMatch(/\b12\b/);
  expect(norm(await tid(page, 'kpi-avg-order').innerText()), '6000p / 5 = £12.00').toContain('£12.00');

  const wait = norm(await tid(page, 'kpi-avg-wait').innerText());
  expect(wait, `average wait should be 210s (3m 30s); got "${wait}"`).toMatch(/3\s*m\s*30|3:30|210/);
});

test('R-03 sales by item shows units, revenue and a bar', async ({ page }) => {
  await openApp(page, '#/reports');
  await expect(tid(page, 'item-row-fuchka')).toBeVisible({ timeout: 15000 });
  await expect
    .poll(async () => norm(await tid(page, 'item-row-fuchka').innerText()), { timeout: 20000 })
    .toContain('£25.00');

  const expected = {
    fuchka: { units: 5, revenue: '£25.00' },
    momo: { units: 5, revenue: '£25.00' },
    chat: { units: 1, revenue: '£5.00' },
    samosa: { units: 1, revenue: '£5.00' }
  };
  for (const [id, exp] of Object.entries(expected)) {
    const row = tid(page, `item-row-${id}`);
    await expect(row, `item-row-${id} is missing`).toBeVisible();
    const text = norm(await row.innerText());
    expect(text, `${id} units`).toMatch(new RegExp(`\\b${exp.units}\\b`));
    expect(text, `${id} revenue`).toContain(exp.revenue);
  }

  // The cancelled Chocolate Fountain order must not create a row with sales.
  const fountain = tid(page, 'item-row-fountain');
  if (await fountain.count()) {
    const text = norm(await fountain.innerText());
    expect(text, 'the cancelled fountain order must not appear as revenue').not.toMatch(/£50\.00|\b10\b/);
  }

  // Every row carries a bar whose width reflects its units.
  const bars = await tid(page, 'item-row-fuchka').evaluate((el) =>
    [...el.querySelectorAll('*')].filter((n) => {
      const r = n.getBoundingClientRect();
      return r.height > 0 && r.height <= 24 && r.width > 2;
    }).length
  );
  expect(bars, 'CLAUDE.md Reports 3: units, revenue, bar').toBeGreaterThan(0);
});

test('R-04 the 30-minute chart highlights the peak and names the busiest 2 hours', async ({ page }) => {
  await openApp(page, '#/reports');
  await expect(tid(page, 'peak-slot')).toBeVisible({ timeout: 15000 });
  await expect
    .poll(async () => norm(await tid(page, 'peak-slot').innerText()), { timeout: 20000 })
    .not.toMatch(/No orders|^—$/);

  const peak = norm(await tid(page, 'peak-slot').innerText());
  expect(peak, `peak 30 min should be 12:00-12:30 with 2 orders; got "${peak}"`).toMatch(/12:00/);
  expect(peak).toMatch(/12:30/);
  expect(peak).toMatch(/\b2\b/);

  const window = norm(await tid(page, 'busiest-window').innerText());
  expect(window, `busiest 2 hours should be 12:00-14:00 with 5 orders; got "${window}"`).toMatch(/12:00/);
  expect(window).toMatch(/14:00/);
  expect(window).toMatch(/\b5\b/);

  // One bar is visually distinct from the rest.
  const fills = await page.evaluate(() => {
    const roots = [...document.querySelectorAll('[data-testid^="bar-"], [data-slot], [class*="bar"]')];
    return roots
      .map((n) => getComputedStyle(n).backgroundColor)
      .filter((c) => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent');
  });
  if (fills.length) {
    expect(new Set(fills).size, 'CLAUDE.md Reports 4: the peak bar is highlighted').toBeGreaterThan(1);
  }
});

test('R-05 show-as-table toggle swaps the chart for a table with the same numbers', async ({ page }) => {
  await openApp(page, '#/reports');
  const toggle = tid(page, 'chart-toggle');
  await expect(toggle, 'CLAUDE.md Reports 4: "Show as table" toggle').toBeVisible({ timeout: 15000 });
  await expect
    .poll(async () => norm(await tid(page, 'peak-slot').innerText()), { timeout: 20000 })
    .not.toMatch(/No orders|^—$/);

  const labelBefore = norm(await toggle.innerText());
  await toggle.click();
  await page.waitForTimeout(300);

  const table = page.locator('table');
  await expect(table.first(), 'a table of slots and order counts must appear').toBeVisible();
  const body = norm(await table.first().innerText());
  expect(body, 'the table must carry the peak slot').toMatch(/12:00/);
  expect(body).toMatch(/12:30/);

  const labelAfter = norm(await toggle.innerText());
  expect(labelAfter, 'the toggle label must flip').not.toBe(labelBefore);

  await toggle.click();
  await page.waitForTimeout(300);
  expect(norm(await toggle.innerText())).toBe(labelBefore);
});

test('R-06 cash vs card split with amounts and percentages', async ({ page }) => {
  await openApp(page, '#/reports');
  const split = tid(page, 'pay-split');
  await expect(split).toBeVisible({ timeout: 15000 });
  await expect
    .poll(async () => norm(await split.innerText()), { timeout: 20000 })
    .not.toContain('£0.00');
  const text = norm(await split.innerText());

  expect(text, 'cash = A-001 1000 + A-003 1500 + A-005 2000 = £45.00').toContain('£45.00');
  expect(text, 'card = A-002 1000 + A-004 500 = £15.00 (the cancelled £50 card order is excluded)').toContain('£15.00');
  expect(text, 'percentages must be shown').toMatch(/75\s*%/);
  expect(text).toMatch(/25\s*%/);
  expect(text, 'the cancelled £50 card order must not be counted').not.toContain('£65.00');
});

test('R-07 Export CSV downloads a file with the exact header and one row per line', async ({ page }) => {
  await openApp(page, '#/reports');
  const button = tid(page, 'export-csv');
  await expect(button).toBeVisible({ timeout: 15000 });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    button.click()
  ]);
  const path = await download.path();
  expect(path, 'the CSV must actually download').toBeTruthy();
  const text = readFileSync(path, 'utf8');

  const header = text.split(/\r?\n/)[0];
  expect(header, 'CLAUDE.md Reports 6 fixes the column list and its order')
    .toBe('day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds');

  const rows = parseCsv(text);
  const col = (n) => rows[0].indexOf(n);
  const body = rows.slice(1);
  const cancelled = body.filter((r) => r[col('status')] === 'cancelled');
  expect(body.length - cancelled.length, 'six non-cancelled order lines on the fixture day').toBe(6);

  for (const r of body) {
    expect(r, `row has ${r.length} fields: ${r.join('|')}`).toHaveLength(13);
    expect(Number(r[col('lineTotal')])).toBe(Number(r[col('qty')]) * Number(r[col('price')]));
    expect(r[col('day')]).toBe(londonDay());
  }

  const a001 = body.find((r) => r[col('orderNo')] === 'A-001');
  expect(a001[col('name')]).toBe('Priya');
  expect(a001[col('waitSeconds')]).toBe('120');

  // Cash received is screen-only (requirement change 2026-10-18): the CSV keeps
  // the Phase I columns and gains no tendered/changeGiven column.
  expect(rows[0], 'no cash-received columns in the CSV').not.toContain('tendered');
  expect(rows[0], 'no cash-received columns in the CSV').not.toContain('changeGiven');
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
});

test('R-08 a day with no orders shows zeroes, not NaN', async ({ page }) => {
  const errors = await openApp(page, '#/reports');
  const date = tid(page, 'report-date');
  await expect(date).toBeVisible({ timeout: 15000 });
  await date.fill('2020-01-01');
  await date.dispatchEvent('change');
  await page.waitForTimeout(1200);

  const body = norm(await page.locator('main, body').first().innerText());
  expect(body, 'an empty day must not render NaN').not.toMatch(/NaN|Infinity|undefined/);
  expect(norm(await tid(page, 'kpi-sales').innerText())).toContain('£0.00');
  expect(norm(await tid(page, 'kpi-orders').innerText())).toMatch(/\b0\b/);
  await expectNoConsoleErrors(errors, '#/reports on an empty day');
});

test('R-09 changing the date re-queries and coming back restores the figures', async ({ page }) => {
  await openApp(page, '#/reports');
  const date = tid(page, 'report-date');
  await expect(date).toBeVisible({ timeout: 15000 });
  await expect
    .poll(async () => norm(await tid(page, 'kpi-sales').innerText()), { timeout: 20000 })
    .toContain('£60.00');
  const today = norm(await tid(page, 'kpi-sales').innerText());

  await date.fill('2020-01-01');
  await date.dispatchEvent('change');
  await expect
    .poll(async () => norm(await tid(page, 'kpi-sales').innerText()), { timeout: 20000 })
    .toContain('£0.00');

  await date.fill(londonDay());
  await date.dispatchEvent('change');
  await expect
    .poll(async () => norm(await tid(page, 'kpi-sales').innerText()), { timeout: 20000 })
    .toBe(today);
});
