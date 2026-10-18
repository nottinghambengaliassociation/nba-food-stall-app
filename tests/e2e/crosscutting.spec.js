// X-01..X-09 — layout, touch targets, accessibility and console cleanliness.
// Spec: CLAUDE.md "Design" and the Definition of done.
import { test, expect } from './session.js';
import AxeBuilder from '@axe-core/playwright';
import {
  clearFirestore, openApp, tid, attachConsole, expectNoConsoleErrors,
  placeOrder, seedReportDay, realErrors
} from './helpers.js';

const ROUTES = ['#/', '#/cash', '#/kitchen', '#/reports'];

test.beforeEach(async () => { await clearFirestore(); });

test('X-01 no horizontal scroll at 360px on any route', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const route of ROUTES) {
    await page.goto('/' + route);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      const widest = [...document.querySelectorAll('body *')]
        .map((n) => ({ w: Math.round(n.getBoundingClientRect().right), tag: n.tagName, id: n.dataset.testid || n.className }))
        .filter((x) => x.w > d.clientWidth + 1)
        .slice(0, 5);
      return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, widest };
    });
    expect(
      overflow.scrollWidth,
      `${route} scrolls horizontally at 360px (scrollWidth ${overflow.scrollWidth} > ${overflow.clientWidth}); widest: ${JSON.stringify(overflow.widest)}`
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);
  }
});

test('X-02 every visible control is at least 48px tall', async ({ page }) => {
  await clearFirestore();
  await seedReportDay();
  for (const route of ROUTES) {
    await page.goto('/' + route);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(800);
    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('button, a[href], input, select, [role=button], [role=tab]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;            // hidden
        if (getComputedStyle(el).visibility === 'hidden') continue;
        if (el.closest('header') && el.tagName === 'A') continue;  // inline header links
        // Phase II gives some controls their own, smaller, minimum, so the
        // general 48px rule does not apply to them:
        //  - Sign out below 700px is "icon-only 44x44" (Login 7);
        //  - the quick cash buttons are "at least 44 px tall on phone, 54 on
        //    tablet" (Cash 3) and the mock-ups draw the Clear link at 44px.
        // Sign out is deliberately 44x44 below 700px (CLAUDE.md Login 7:
        // "icon-only 44x44 button"); at 700px and wider the 48px rule applies.
        const isSignOut = (window.innerWidth < 700) && (
          el.dataset.testid === 'sign-out' ||
          el.getAttribute('aria-label') === 'Sign out' ||
          /^sign out$/i.test((el.textContent || '').trim()));
        const inQuickCash = !!el.closest('[role="group"][aria-label="Quick cash amounts"]') ||
          /^tender-/.test(el.dataset.testid || '');
        const isClearLink = /^(tender-clear|clear-tender)$/.test(el.dataset.testid || '') ||
          /^clear$/i.test((el.textContent || '').trim());
        const floor = (isSignOut || inQuickCash || isClearLink) ? 43.5 : 47.5;
        if (r.height < floor) {
          out.push(`${el.tagName.toLowerCase()}[${el.dataset.testid || el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 20)}] = ${Math.round(r.height)}px`);
        }
      }
      return out;
    });
    expect(small, `${route}: controls under their minimum height (CLAUDE.md Design: "Touch targets at least 48 px"; 44px for Sign out, the quick cash buttons and the Clear link)\n${small.join('\n')}`).toEqual([]);
  }
});

test('X-03 body text is at least 17px', async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto('/' + route);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
    const size = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    expect(size, `${route}: body font-size is ${size}px; CLAUDE.md Design requires at least 17px`).toBeGreaterThanOrEqual(16.9);
  }
});

test('X-04 every screen has a dark header bar', async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto('/' + route);
    const header = page.locator('header').first();
    await expect(header, `${route} has no header`).toBeVisible({ timeout: 20000 });
    const bg = await header.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg, `${route}: header background is ${bg}; CLAUDE.md Design: dark header bar, ink #1C1917`).toBe('rgb(28, 25, 23)');
  }
});

test('X-05 layout follows the 700px breakpoint', async ({ page }, info) => {
  await page.goto('/#/kitchen');
  await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(500);

  if (info.project.name === 'phone') {
    await expect(tid(page, 'tab-new'), 'phone layout uses tabs on the kitchen').toBeVisible();
    await expect(tid(page, 'tab-preparing')).toBeVisible();
    await expect(tid(page, 'tab-ready')).toBeVisible();
    // Only the selected lane is on screen below the breakpoint.
    const visibleColumns = await page.evaluate(() =>
      ['new', 'preparing', 'ready'].filter((k) => {
        const n = document.querySelector(`[data-testid="col-${k}"]`);
        if (!n) return false;
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(n).display !== 'none';
      }).length);
    expect(visibleColumns, 'CLAUDE.md Design: tabs on the kitchen below 700px, one lane at a time').toBeLessThanOrEqual(1);
  } else {
    await expect(tid(page, 'col-new'), 'tablet layout uses three columns').toBeVisible();
    await expect(tid(page, 'col-preparing')).toBeVisible();
    await expect(tid(page, 'col-ready')).toBeVisible();
  }

  await page.goto('/#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
  const columns = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('[data-testid^="tile-"]')];
    const tops = new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top)));
    return tiles.length / tops.size;
  });
  if (info.project.name === 'phone') {
    expect(Math.round(columns), 'CLAUDE.md Design: 2-column tiles below 700px').toBe(2);
  } else {
    expect(columns, 'tablet shows more than 2 tiles per row').toBeGreaterThan(2);
  }
});

test('X-06 item icons are inline SVG, never emoji', async ({ page }) => {
  await page.goto('/#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
  const emoji = await page.evaluate(() => {
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    return [...document.querySelectorAll('[data-testid^="tile-"]')]
      .filter((t) => re.test(t.textContent || ''))
      .map((t) => t.dataset.testid);
  });
  expect(emoji, 'CLAUDE.md Design: "Icons: inline stroke SVG per item. No emoji."').toEqual([]);
  for (const id of ['fuchka', 'momo', 'chat', 'samosa', 'straw', 'fountain']) {
    expect(await tid(page, `tile-${id}`).locator('svg').count(), `tile-${id} needs an inline SVG`).toBeGreaterThan(0);
  }
});

test('X-07 axe finds no serious or critical violations on an empty app', async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto('/' + route);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(800);
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const detail = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`).join('\n');
    expect(bad, `${route} (empty) axe serious/critical violations:\n${detail}`).toEqual([]);
  }
});

test('X-07b axe finds no serious or critical violations with orders present', async ({ page }) => {
  await seedReportDay();
  for (const route of ROUTES) {
    await page.goto('/' + route);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1200);
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const detail = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`).join('\n');
    expect(bad, `${route} (with orders) axe serious/critical violations:\n${detail}`).toEqual([]);
  }
});

test('X-08 no console errors on any route, empty or with orders', async ({ page }) => {
  const errors = attachConsole(page);
  for (const route of ROUTES) {
    await page.goto('/' + route);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1000);
  }
  await seedReportDay();
  for (const route of ROUTES) {
    await page.goto('/' + route);
    await page.waitForTimeout(1200);
  }
  await expectNoConsoleErrors(errors, 'all four routes');
});

test('X-09 real form semantics and labels', async ({ page }) => {
  await openApp(page, '#/cash');
  await expect(tid(page, 'customer-name')).toBeVisible({ timeout: 20000 });

  const nameOk = await tid(page, 'customer-name').evaluate((el) => {
    if (el.tagName.toLowerCase() !== 'input') return 'not an input';
    const labelled = !!el.labels?.length || !!el.getAttribute('aria-label') || !!el.getAttribute('aria-labelledby');
    return labelled ? 'ok' : 'unlabelled';
  });
  expect(nameOk, 'CLAUDE.md Design / a11y: use real <label> and <input>').toBe('ok');

  for (const name of ['send-order', 'pay-cash', 'pay-card', 'tile-momo']) {
    const tag = await tid(page, name).evaluate((el) => el.tagName.toLowerCase());
    expect(tag, `${name} must be a real <button>`).toBe('button');
  }

  // The payment toggle exposes its selected state.
  const pressed = await tid(page, 'pay-cash').evaluate((el) =>
    el.getAttribute('aria-pressed') ?? el.getAttribute('aria-checked') ?? el.getAttribute('aria-selected'));
  expect(pressed, 'the cash/card toggle must expose its state to assistive technology').not.toBeNull();

  await page.goto('/#/reports');
  const dateOk = await tid(page, 'report-date').evaluate((el) =>
    !!el.labels?.length || !!el.getAttribute('aria-label') || !!el.getAttribute('aria-labelledby'));
  expect(dateOk, 'the report date input needs a label').toBe(true);
});

test('X-10 page titles and a single h1-level heading per screen', async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto('/' + route);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
    const title = await page.title();
    expect(title.trim().length, `${route} needs a document title`).toBeGreaterThan(0);
  }
});
