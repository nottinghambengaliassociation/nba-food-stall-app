/**
 * P6L-* — Phase VI (v1.5.0) live verification against LIVE_URL.
 * STRICTLY READ-ONLY.
 *
 * Gated: skipped unless LIVE_P6=1, the same style as the other live specs, so
 * `npm run test:e2e` stays offline and deterministic. Run with:
 *
 *   LIVE_P6=1 EXPECT_BUILD=d834045 npx playwright test tests/e2e/live-p6.spec.js \
 *     --project=tablet --project=iphone13
 *
 * WRITE DISCIPLINE. Phase VI adds no control that writes — that is the point
 * of the screen — and this file adds none of its own:
 *   - no till tile is tapped, `send-order` is never clicked;
 *   - `save-changes`, `cancel-confirm`, `got-it-*` and `remove-*` are never
 *     clicked, and edit mode is never entered;
 *   - every Firestore check here is a REST GET.
 * The evidence is threefold: P6L-00 and P6L-09 bracket the run with a count and
 * a fingerprint of `orders` read over REST; and `watchFirestore` decodes the
 * Firestore WebChannel traffic the browser itself sends and asserts that not
 * one document write left the page for the whole signed-in session.
 *
 * NOT ALWAYS TESTABLE LIVE. The H3 reset emptied `orders` and the stall may not
 * have traded since, so a range can legitimately hold nothing. Every data case
 * reads what is actually there, asserts the empty state when that is what the
 * brief calls for, and **records the gap** naming the emulator case that covers
 * it. No order is created to make a check pass.
 *
 * CREDENTIALS: read at run time from the gitignored .secrets/app-login.env by
 * ./creds.js. Never written into a test file, a log line or a screenshot. The
 * Show/Hide toggle is never pressed, so the password stays masked in captures.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROOT, SHOTS, attachConsole, realErrors, parseCsv, textOf,
  loginUserField, loginPassField, loginSubmit, signOutButton,
  tid, heightOf, watchFirestore
} from './helpers.js';
import { creds } from './creds.js';

const LIVE = process.env.LIVE_URL || 'https://nottinghambengaliassociation.github.io/nba-food-stall-app/';
const C = creds();
const PKG_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
const EXPECT_BUILD = process.env.EXPECT_BUILD || '';

const CLEAN_BUILD = /^[0-9a-f]{7}$/;
const DATE_SHAPE = /^\d{1,2} [A-Z][a-z]{2} \d{4}$/;
const CSV_HEADER_15 =
  'day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds,edited,cancelReason';

const ROUTES = [
  ['landing', '#/'],
  ['cash', '#/cash'],
  ['kitchen', '#/kitchen'],
  ['reports', '#/reports'],
  ['reports-days', '#/reports/days'],
  ['reports-orders', '#/reports/orders'],
  ['reports-history', '#/reports/history']
];

const LIVE_FIRESTORE = /firestore\.googleapis\.com/;
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

test.skip(!process.env.LIVE_P6, 'set LIVE_P6=1 to run the read-only Phase VI live check');
test.describe.configure({ mode: 'serial' });

function record(line) {
  // eslint-disable-next-line no-console
  console.log(`[LIVE-P6] ${line}`);
  try { appendFileSync(resolve(SHOTS, '../live-smoke-record.txt'), line + '\n'); } catch { /* ignore */ }
}

const shot = (page, name, full = true) =>
  page.screenshot({ path: resolve(SHOTS, `live-p6-${name}.png`), fullPage: full });

async function disableCache(page) {
  try {
    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    return true;
  } catch {
    return false;
  }
}

/** Read live Firestore over REST with the key the deployed app already serves. */
async function liveFirestore(path) {
  const cfg = await (await fetch(LIVE + 'js/firebase-config.js')).text();
  const apiKey = (cfg.match(/apiKey:\s*["']([^"']+)["']/) || [])[1];
  const projectId = (cfg.match(/projectId:\s*["']([^"']+)["']/) || [])[1];
  if (!apiKey || !projectId) throw new Error('could not read the deployed firebase config');
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents${path}` +
    `${path.includes('?') ? '&' : '?'}key=${apiKey}`;
  const res = await fetch(url);
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`live Firestore ${path} -> ${res.status}`);
  return res.json();
}

function plain(fields = {}) {
  const val = (v) => {
    if ('nullValue' in v) return null;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('stringValue' in v) return v.stringValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
    if ('mapValue' in v) return plain(v.mapValue.fields);
    return null;
  };
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = val(v);
  return out;
}

const docIds = (body) => (body.documents || []).map((d) => d.name.split('/').pop()).sort();
const fingerprint = (orders) => JSON.stringify(
  orders.map((o) => `${o.id}|${o.orderNo}|${o.status}|${o.total}|${o.day}|${o.editCount || 0}`).sort()
);

const londonParts = () => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
}).formatToParts(new Date()).reduce((a, p) => (a[p.type] = p.value, a), {});
const TODAY = (() => { const p = londonParts(); return `${p.year}-${p.month}-${p.day}`; })();
const dayOffset = (n, from = TODAY) => {
  const d = new Date(Date.parse(from + 'T00:00:00Z') + n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

/* Shared state across the serial run. */
let ORDERS_BEFORE = [];
let MENU_BEFORE = null;
let HAS_EVENT = false;
let IN_30 = [];
let DAYS_IN_30 = [];
/** Accumulated document writes seen in the browser, across every test. */
const WRITES_SEEN = [];

async function signInLive(page) {
  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  await (await loginSubmit(page)).waitFor({ state: 'visible', timeout: 30000 });
  await expect(page.getByText(/login not configured/i), 'the live login must be configured').toHaveCount(0);
  await (await loginUserField(page)).fill(C.user);
  await (await loginPassField(page)).fill(C.password);
  await (await loginSubmit(page)).click();
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 30000 }).toBe('#/');
}

/** Sign in, watch the live Firestore traffic, and land on the history screen. */
async function openLiveHistory(page, query = '') {
  await disableCache(page);
  const watch = watchFirestore(page, LIVE_FIRESTORE);
  await signInLive(page);
  await page.goto(LIVE + '#/reports/history' + query, { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'history-from')).toBeVisible({ timeout: 30000 });
  await expect(tid(page, 'history-summary')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2500);
  return watch;
}

const isPhone = (info) => info.project.name !== 'tablet';

async function listedIds(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-testid^="history-row-"]')]
    .map((n) => n.dataset.testid.replace('history-row-', '')));
}

async function pickRange(page, key) {
  await tid(page, `history-range-${key}`).click();
  await page.waitForTimeout(2500);
}

/** Collect any write the browser made, for the end-of-run assertion. */
function harvest(watch, where) {
  const writes = watch.writtenDocs();
  for (const doc of writes) WRITES_SEEN.push(`${where}: ${doc}`);
  return writes;
}

/* ---------------------------------------------------------------- P6L-00 */

test('P6L-00 the live collections before anything is opened', async ({}, info) => {
  const body = await liveFirestore('/orders?pageSize=300');
  ORDERS_BEFORE = (body.documents || []).map((d) => ({ id: d.name.split('/').pop(), ...plain(d.fields) }));
  MENU_BEFORE = docIds(await liveFirestore('/menu?pageSize=50'));

  const from30 = dayOffset(-29);
  IN_30 = ORDERS_BEFORE.filter((o) => o.day >= from30 && o.day <= TODAY);
  DAYS_IN_30 = [...new Set(IN_30.map((o) => o.day))].sort().reverse();

  const event = await liveFirestore('/settings/event');
  HAS_EVENT = !!(event && event.fields);

  const days = [...new Set(ORDERS_BEFORE.map((o) => o.day).filter(Boolean))].sort();
  record(`P6L-00 ${info.project.name}: live orders = ${ORDERS_BEFORE.length} document(s) over days [${days.join(', ') || 'none'}]; ` +
    `menu = ${MENU_BEFORE.length} document(s); settings/event ${HAS_EVENT ? 'exists' : 'absent'}`);
  record(`P6L-00 ${info.project.name}: Last 30 days (${from30}..${TODAY}) holds ${IN_30.length} order(s) over ${DAYS_IN_30.length} trading day(s); ` +
    `cancelled = ${IN_30.filter((o) => o.status === 'cancelled').length}, edited = ${IN_30.filter((o) => Number(o.editCount) > 0).length}, ` +
    `tills [${[...new Set(IN_30.map((o) => o.till).filter(Boolean))].sort().join(', ') || 'none'}]`);

  expect(MENU_BEFORE.length, 'the live menu is the eight-item table').toBe(8);
  record(`P6L-00 ${info.project.name}: PASS - snapshot taken`);
});

/* ---------------------------------------------------------------- P6L-01 */

test('P6L-01 the deployed version.js and the signed-out guard on #/reports/history', async ({ page }, info) => {
  const src = await (await fetch(LIVE + 'js/version.js')).text();
  const version = (src.match(/APP_VERSION\s*=\s*["']([^"']+)["']/) || [])[1];
  const build = (src.match(/APP_BUILD\s*=\s*["']([^"']+)["']/) || [])[1];
  const date = (src.match(/APP_DATE\s*=\s*["']([^"']+)["']/) || [])[1];
  record(`P6L-01 ${info.project.name}: published js/version.js -> ${version} / ${build} / ${date}`);

  expect(version, 'CLAUDE.md Phase III part 2, 1: package.json is the single source of truth').toBe(PKG_VERSION);
  expect(version, 'CLAUDE.md Phase VI 10: package.json version 1.5.0').toBe('1.5.0');
  expect(build, 'a clean 7-character SHA').toMatch(CLEAN_BUILD);
  expect(build).not.toContain('-dirty');
  expect(date, 'APP_DATE is YYYY-MM-DD').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  if (EXPECT_BUILD) expect(build, `the deploy pinned build ${EXPECT_BUILD}`).toBe(EXPECT_BUILD);

  const errors = attachConsole(page);
  await disableCache(page);
  await page.goto(LIVE + '#/reports/history', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 30000 }).toMatch(/^#\/login/);
  await expect(await loginSubmit(page), 'the login form is there, not "Login not configured"').toBeVisible();
  expect(await tid(page, 'history-from').count(), 'no history content leaks through the guard').toBe(0);

  const line = tid(page, 'login-version');
  await expect(line).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => norm(await line.innerText()), { timeout: 20000 }).not.toMatch(/Version dev/);
  const text = norm(await line.innerText());
  const m = text.match(/^Version\s+(\S+)\s+·\s+build\s+(\S+)\s+·\s+updated\s+(.+)$/);
  expect(m, `the login card must read "Version x.y.z · build <sha> · updated <date>"; got "${text}"`).toBeTruthy();
  expect(m[1]).toBe('1.5.0');
  if (EXPECT_BUILD) expect(m[2]).toBe(EXPECT_BUILD);
  expect(m[3]).toMatch(DATE_SHAPE);
  expect(norm(await line.getAttribute('title'))).toBe(`Version ${m[1]}, build ${m[2]}, updated ${m[3]}`);
  expect(norm(await line.getAttribute('aria-label'))).toBe(norm(await line.getAttribute('title')));

  await shot(page, `${info.project.name}-login-version`);
  const real = realErrors(errors);
  expect(real, `console errors on #/login:\n${real.join('\n')}`).toEqual([]);
  record(`P6L-01 ${info.project.name}: PASS - #/reports/history redirects to #/login; card reads "${text}"`);
});

/* ---------------------------------------------------------- P6L-02, P6L-03 */

test('P6L-02/P6L-03 every route loads clean and Online, with the v1.5.0 label in each header',
  async ({ page }, info) => {
    test.skip(!C.available, 'no .secrets/app-login.env on this machine');
    const errors = attachConsole(page);
    await disableCache(page);
    const watch = watchFirestore(page, LIVE_FIRESTORE);
    await signInLive(page);

    for (const [name, route] of ROUTES) {
      await page.goto(LIVE + route, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('header').first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1600);

      expect(await page.getByText(/storage not configured/i).count(), `${route}: no storage banner`).toBe(0);

      const pill = tid(page, 'conn-pill');
      if (await pill.count()) {
        await expect.poll(async () => norm(await pill.innerText()), { timeout: 20000 })
          .toMatch(/online/i);
      }

      // The version label: in the header on every route; on the small cash
      // counter it lives in the ☰ menu (CLAUDE.md H3 1).
      const label = tid(page, 'app-version');
      if (await label.count() && await label.isVisible().catch(() => false)) {
        const text = norm(await label.innerText());
        expect(text, `${route}: the header pill reads v1.5.0`).toBe('v1.5.0');
        const title = norm(await label.getAttribute('title'));
        expect(title, `${route}: title names version, build and date`).toMatch(/^Version 1\.5\.0, build [0-9a-f]{7}, updated /);
        if (EXPECT_BUILD) expect(title).toContain(EXPECT_BUILD);
        expect(norm(await label.getAttribute('aria-label'))).toBe(title);
      } else if (name === 'cash' && isPhone(info)) {
        await tid(page, 'menu-button').click();
        await page.waitForTimeout(500);
        expect(norm(await tid(page, 'app-version').innerText()), 'the ☰ menu carries the version').toContain('1.5.0');
        await page.keyboard.press('Escape');
      } else {
        throw new Error(`${route}: no app-version label found`);
      }

      if (name === 'reports-history' || name === 'landing') {
        await shot(page, `${info.project.name}-${name}`);
      }
    }

    harvest(watch, 'P6L-02/03 route tour');
    const real = realErrors(errors);
    record(`P6L-02/03 ${info.project.name}: PASS - ${ROUTES.length} routes, Online pill, v1.5.0 in every header, ${real.length} console error(s)`);
    expect(real, `console errors across the live routes:\n${real.join('\n')}`).toEqual([]);
  });

/* ---------------------------------------------------------------- P6L-04 */

test('P6L-04 the fourth tab on all four report screens, and the phone tab row', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await disableCache(page);
  await signInLive(page);

  const label = isPhone(info) ? 'History' : 'Order history';
  for (const route of ['#/reports', '#/reports/days', '#/reports/orders', '#/reports/history']) {
    await page.goto(LIVE + route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const pill = tid(page, 'report-view-history');
    await expect(pill, `CLAUDE.md Phase VI 1: the fourth tab is on ${route}`).toBeVisible({ timeout: 30000 });
    expect(norm(await pill.innerText()), `the ${info.project.name} label`).toBe(label);
    expect(await heightOf(pill), 'the report tabs are at least 48 px').toBeGreaterThanOrEqual(47.5);
  }

  const ink = async (name) => tid(page, `report-view-${name}`).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await ink('history'), 'the current tab is filled ink #1C1917').toBe('rgb(28, 25, 23)');
  for (const other of ['day', 'days', 'orders']) {
    expect(await ink(other), 'only the current tab is filled').not.toBe('rgb(28, 25, 23)');
  }
  expect(await page.getAttribute('[data-testid="report-view-history"]', 'aria-current')).toBe('page');

  const row = await page.evaluate(() => {
    const nav = document.querySelector('.report-nav');
    const pills = [...nav.querySelectorAll('.report-nav__item')];
    return {
      count: pills.length,
      tops: pills.map((p) => Math.round(p.getBoundingClientRect().top)),
      page: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }
    };
  });
  expect(row.count, 'four tabs').toBe(4);
  if (isPhone(info)) {
    expect(Math.max(...row.tops) - Math.min(...row.tops), 'one row, no wrapping').toBeLessThanOrEqual(2);
  }
  expect(row.page.scrollWidth, 'no horizontal page scroll').toBeLessThanOrEqual(row.page.clientWidth + 1);

  const real = realErrors(errors);
  expect(real, `console errors on the report tabs:\n${real.join('\n')}`).toEqual([]);
  record(`P6L-04 ${info.project.name}: PASS - "${label}" on all four report screens, filled ink on its own, no sideways page scroll`);
});

/* ---------------------------------------------------------------- P6L-05 */

test('P6L-05 Last 30 days against what live actually holds', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  const watch = await openLiveHistory(page);

  // Default range first: Last 7 days (CLAUDE.md Phase VI 2).
  expect(await tid(page, 'history-from').inputValue(), 'the default range is Last 7 days')
    .toBe(dayOffset(-6));
  expect(await tid(page, 'history-to').inputValue()).toBe(TODAY);

  await pickRange(page, '30d');
  const from30 = dayOffset(-29);
  expect(await tid(page, 'history-from').inputValue(), 'Last 30 days sets From').toBe(from30);
  expect(await tid(page, 'history-to').inputValue(), 'and To is today').toBe(TODAY);
  expect(await tid(page, 'history-range-30d').getAttribute('aria-pressed')).toBe('true');

  const rows = await listedIds(page);
  const live = IN_30.filter((o) => o.status !== 'cancelled');
  const salesText = '£' + (live.reduce((s, o) => s + (o.total || 0), 0) / 100).toFixed(2);
  const summary = norm(await textOf(tid(page, 'history-summary')));

  if (!IN_30.length) {
    // Recorded gap, not a worked-around pass.
    await expect(tid(page, 'history-empty'), 'CLAUDE.md Phase VI 6: the empty message').toBeVisible();
    expect(norm(await textOf(tid(page, 'history-empty')))).toBe('No orders match these filters.');
    expect(rows, 'nothing to list').toEqual([]);
    expect(summary).toBe('0 orders · £0.00');
    record(`P6L-05 ${info.project.name}: GAP - live holds no orders in the last 30 days, so the grouped list, ` +
      'the day headers and the summary maths could not be exercised against real data. The empty state was ' +
      'asserted instead. Emulator cover: P6-04/P6-05 (ranges), P6-19 (tiles), P6-20/P6-21/P6-22 (grouping and ' +
      'day totals) in tests/e2e/reports-history.spec.js.');
  } else {
    // CLAUDE.md Phase VI 6: the first 100, then "Show 100 more (<n> left)".
    const firstPage = Math.min(IN_30.length, 100);
    expect(rows.length, 'the first page is 100 orders, or all of them if fewer').toBe(firstPage);
    if (IN_30.length > 100) {
      const more = tid(page, 'history-more');
      await expect(more, 'CLAUDE.md Phase VI 6: "Show 100 more (<n> left)"').toBeVisible();
      expect(norm(await textOf(more))).toBe(`Show 100 more (${IN_30.length - 100} left)`);
      expect(await heightOf(more), 'at least 48 px').toBeGreaterThanOrEqual(47.5);
      for (let guard = 0; guard < 10 && await more.isVisible().catch(() => false); guard += 1) {
        await more.click();
        await page.waitForTimeout(900);
      }
    }
    const allRows = await listedIds(page);
    expect(allRows.length, 'paging through reaches every order in range').toBe(IN_30.length);
    expect(new Set(allRows), 'every live order in range is listed').toEqual(new Set(IN_30.map((o) => o.id)));
    expect(summary, 'the summary counts every matched order, not the page on screen')
      .toContain(`${IN_30.length} order${IN_30.length === 1 ? '' : 's'}`);
    expect(summary.replace(/,/g, ''), 'and carries the live sales total').toContain(salesText);

    const headers = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="history-day-"]')]
      .map((n) => n.dataset.testid.replace('history-day-', '')));
    expect(headers, 'grouped by day, newest first').toEqual(DAYS_IN_30);

    if (!isPhone(info)) {
      const value = async (name) => norm(await tid(page, `history-kpi-${name}`)
        .evaluate((el) => (el.querySelector('.kpi__value') || {}).textContent || ''));
      expect(await value('orders')).toBe(String(IN_30.length));
      expect((await value('sales')).replace(/,/g, '')).toBe(salesText);
      expect(await value('cancelled')).toBe(String(IN_30.filter((o) => o.status === 'cancelled').length));
      expect(await value('edited')).toBe(String(IN_30.filter((o) => Number(o.editCount) > 0).length));
    }
    record(`P6L-05 ${info.project.name}: PASS - ${IN_30.length} live order(s) over ${DAYS_IN_30.length} day(s), ` +
      `first page ${firstPage}${IN_30.length > 100 ? `, then "Show 100 more (${IN_30.length - 100} left)" to all ${IN_30.length}` : ''}, summary "${summary}"`);
  }

  // "This event" follows settings/event, exactly as in Phase III.
  const eventVisible = await tid(page, 'history-range-event').isVisible().catch(() => false);
  expect(eventVisible, `CLAUDE.md Phase VI 2: "This event" is ${HAS_EVENT ? 'shown with' : 'hidden without'} settings/event`)
    .toBe(HAS_EVENT);

  // The 366-day rule, live, and that it makes no query.
  watch.reset();
  const tooFar = dayOffset(-366);
  await tid(page, 'history-from').fill(tooFar);
  await tid(page, 'history-from').dispatchEvent('change');
  await page.waitForTimeout(2000);
  await expect(tid(page, 'history-range-error')).toBeVisible();
  expect(norm(await textOf(tid(page, 'history-range-error')))).toBe('Pick 366 days or fewer');
  expect(watch.queriesFor(tooFar), 'a too-long range makes no query').toEqual([]);
  await pickRange(page, '30d');

  await shot(page, `${info.project.name}-reports-history-list`);
  harvest(watch, 'P6L-05 Last 30 days');
  const real = realErrors(errors);
  expect(real, `console errors on #/reports/history:\n${real.join('\n')}`).toEqual([]);
  record(`P6L-05 ${info.project.name}: range rules PASS - default Last 7 days, Last 30 days ${from30}..${TODAY}, ` +
    `"This event" ${eventVisible ? 'shown' : 'hidden'}, 367 days blocked with no query`);
});

/* ---------------------------------------------------------------- P6L-06 */

test('P6L-06 open one live order, or record the gap', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  const watch = await openLiveHistory(page);
  await pickRange(page, '30d');

  if (!IN_30.length) {
    if (!isPhone(info)) {
      await expect(tid(page, 'history-detail-empty'), 'nothing selected').toBeVisible();
      expect(norm(await textOf(tid(page, 'history-detail-empty'))))
        .toBe('Select an order to see its items and history.');
    }
    record(`P6L-06 ${info.project.name}: GAP - no live order in range to open, so the detail panel, the timeline, ` +
      'the Changes list, Copy link and "Open this day in Orders" could not be exercised live. The ' +
      '"Select an order…" state was asserted instead. Emulator cover: P6-24/P6-25/P6-27/P6-28, P6-26, ' +
      'P6-29 and P6-30 in tests/e2e/reports-history.spec.js.');
  } else {
    // Prefer an order that exercises the most of Phase VI 7: an edited one
    // (the Changes boxes), then a cancelled one (the red box), then the newest.
    const newestFirst = IN_30.slice().sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    const target = newestFirst.find((o) => Number(o.editCount) > 0)
      || newestFirst.find((o) => o.status === 'cancelled')
      || newestFirst[0];
    // It may be past the first page of 100, so page the list out first.
    for (let guard = 0; guard < 10; guard += 1) {
      if (await tid(page, `history-open-${target.id}`).count()) break;
      const more = tid(page, 'history-more');
      if (!(await more.isVisible().catch(() => false))) break;
      await more.click();
      await page.waitForTimeout(900);
    }
    await tid(page, `history-open-${target.id}`).click();
    await expect(tid(page, 'history-detail-no')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(600);

    expect(norm(await textOf(tid(page, 'history-detail-no')))).toBe(target.orderNo);
    expect(norm(await textOf(tid(page, 'history-detail-name')))).toBe(target.name || 'Guest');
    expect(norm(await textOf(tid(page, 'history-detail-till')))).toBe(target.till || 'A');
    expect(norm(await textOf(tid(page, 'history-detail-pay'))))
      .toBe(target.payment === 'card' ? 'Card' : 'Cash');
    expect(norm(await textOf(tid(page, 'history-detail-total'))).replace(/,/g, ''))
      .toBe('£' + ((target.total || 0) / 100).toFixed(2));
    expect(norm(await textOf(tid(page, 'history-detail-day'))), 'the detail names the day')
      .toMatch(/\d{4}/);

    const steps = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="history-step-"]')]
      .map((n) => n.dataset.testid.replace('history-step-', '')));
    expect(steps[0], 'the timeline always starts at Placed').toBe('placed');
    if (target.status === 'cancelled') {
      expect(steps, 'a cancelled order is Placed → Cancelled').toContain('cancelled');
      await expect(tid(page, 'history-detail-cancelled')).toBeVisible();
    }
    const edited = Number(target.editCount) > 0;
    expect(await tid(page, 'history-changes').count(),
      'CLAUDE.md Phase VI 7: Changes appears for an edited order and for no other')
      .toBe(edited ? 1 : 0);
    if (edited) {
      const boxes = await page.locator('[data-testid^="history-change-"]').count();
      expect(boxes, 'one box per edit in the order history').toBeGreaterThan(0);
      const first = norm(await textOf(page.locator('[data-testid="history-change-1"]')));
      expect(first, 'the box heads "Edited HH:MM at till X while <status>"')
        .toMatch(/^Edited \d{2}:\d{2} at till \S+( while \S+)?/);
      expect(first, 'and carries Before, After and the money line').toContain('Before:');
      expect(first).toContain('After:');
      expect(first).toMatch(/Took £\d|Gave back £\d|No payment change/);
      const steps2 = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="history-step-"]')]
        .map((n) => n.dataset.testid.replace('history-step-', '')));
      expect(steps2.some((k) => k.startsWith('edited-')), 'and the timeline gains an Edited step').toBe(true);
      record(`P6L-06 ${info.project.name}: Changes verified on a real edited order -> "${first.slice(0, 120)}"`);
    } else {
      record(`P6L-06 ${info.project.name}: GAP - no edited or cancelled order in range, so the Changes boxes and ` +
        'the cancelled red box were not exercised live. Emulator cover: P6-26 and P6-28 in ' +
        'tests/e2e/reports-history.spec.js.');
    }

    if (!IN_30.some((o) => o.status === 'cancelled')) {
      record(`P6L-06 ${info.project.name}: GAP - no cancelled order in range, so the red "Cancelled HH:MM · reason · ` +
        'was <status>" box could not be seen live. Nothing was cancelled to make it appear. Emulator cover: P6-26 ' +
        'in tests/e2e/reports-history.spec.js.');
    }

    const lines = await page.locator('[data-testid^="history-line-"]').count();
    expect(lines, 'every item line is drawn').toBe((target.items || []).length);
    expect(norm(await textOf(tid(page, 'history-detail'))), 'the read-only note, verbatim')
      .toContain('Read-only history. Nothing here changes an order. Cancelled orders are listed but excluded from every total.');

    const openDay = tid(page, 'history-open-day');
    expect(await openDay.getAttribute('href')).toBe(`#/reports/orders?day=${target.day}`);
    await tid(page, 'history-copy-link').click();
    await expect(tid(page, 'history-copy-link')).toHaveText('Link copied', { timeout: 6000 });

    await shot(page, `${info.project.name}-reports-history-detail`);

    if (isPhone(info)) {
      // Back to the list, which renders its first page again (CLAUDE.md Phase
      // VI 6 fixes the 100-row cap; it says nothing about keeping a paged-out
      // position across a detail, so the first page is the expectation).
      const firstPage = Math.min(IN_30.length, 100);
      await tid(page, 'history-back').click();
      await page.waitForTimeout(900);
      expect((await listedIds(page)).length, 'the back button returns to the list').toBe(firstPage);
      await tid(page, `history-open-${target.id}`).click();
      await page.waitForTimeout(700);
      await page.goBack();
      await page.waitForTimeout(900);
      expect((await listedIds(page)).length, 'and so does the browser Back button').toBe(firstPage);
    }
    record(`P6L-06 ${info.project.name}: PASS - opened ${target.orderNo} (${target.day}), every field matched its document`);
  }

  harvest(watch, 'P6L-06 detail');
  const real = realErrors(errors);
  expect(real, `console errors opening a live order:\n${real.join('\n')}`).toEqual([]);
});

/* ---------------------------------------------------------------- P6L-07 */

test('P6L-07 the history CSV downloads, is named for the range and parses', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  const watch = await openLiveHistory(page);
  await pickRange(page, '30d');

  const from = await tid(page, 'history-from').inputValue();
  const to = await tid(page, 'history-to').inputValue();

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    tid(page, 'history-export-csv').click()
  ]);
  const name = download.suggestedFilename();
  expect(name, 'CLAUDE.md Phase VI 8: nba-food-stall_history_<from>_<to>.csv')
    .toBe(`nba-food-stall_history_${from}_${to}.csv`);

  const text = readFileSync(await download.path(), 'utf8');
  const rows = parseCsv(text);
  expect(rows[0].join(','), 'the Orders columns, ending edited and cancelReason').toBe(CSV_HEADER_15);
  const body = rows.slice(1);
  const expectedLines = IN_30.reduce((n, o) => n + (o.items || []).length, 0);
  expect(body.length, 'one row per order line of every matched order').toBe(expectedLines);
  const col = (c) => rows[0].indexOf(c);
  for (const r of body) {
    expect(r.length, 'every row has 15 fields').toBe(15);
    expect(Number(r[col('lineTotal')])).toBe(Number(r[col('qty')]) * Number(r[col('price')]));
    expect(['yes', 'no']).toContain(r[col('edited')]);
    if (r[col('status')] !== 'cancelled') expect(r[col('cancelReason')], 'blank unless cancelled').toBe('');
  }
  expect(text, 'the Phase I tendered field is never exported').not.toContain('tendered');

  await shot(page, `${info.project.name}-reports-history-csv`);
  harvest(watch, 'P6L-07 CSV');
  const real = realErrors(errors);
  expect(real, `console errors exporting the live CSV:\n${real.join('\n')}`).toEqual([]);
  record(`P6L-07 ${info.project.name}: PASS - "${name}", ${rows[0].length} columns, ${body.length} body row(s)` +
    (expectedLines ? '' : ' (header only: live holds no orders in range — emulator cover: P6-31, P6-23)'));
});

/* ---------------------------------------------------------------- P6L-08 */

test('P6L-08 axe and the phone filter sheet on the live history screen', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  const watch = await openLiveHistory(page);
  await pickRange(page, '30d');

  const scan = async (where) => {
    const result = await new AxeBuilder({ page }).analyze();
    const bad = result.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    record(`P6L-08 ${info.project.name}: axe ${where} -> ${bad.length} serious/critical`);
    expect(bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`),
      `axe on the live history screen: ${where}`).toEqual([]);
  };

  await scan('the list');

  if (isPhone(info)) {
    const open = tid(page, 'history-filters-open');
    await expect(open, 'CLAUDE.md Phase VI 4: the phone Filters button').toBeVisible();
    expect(await heightOf(open)).toBeGreaterThanOrEqual(43.5);
    await open.click();
    await expect(tid(page, 'history-filters-sheet')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);
    expect(await tid(page, 'history-filters-sheet').getAttribute('role')).toBe('dialog');
    expect(norm(await textOf(tid(page, 'history-filters-show')))).toMatch(/^Show \d+ orders?$/);
    await shot(page, `${info.project.name}-reports-history-filters`);
    await scan('the filter sheet');
    await tid(page, 'history-filters-show').click();
    await page.waitForTimeout(500);
    expect(await tid(page, 'history-filters-sheet').isVisible(), 'the sheet closes again').toBe(false);
  } else {
    // Filters live on the screen itself at tablet width.
    await tid(page, 'history-status-collected').click();
    await page.waitForTimeout(800);
    expect(await tid(page, 'history-status-collected').getAttribute('aria-pressed')).toBe('true');
    await tid(page, 'history-clear').click();
    await page.waitForTimeout(800);
    expect(await tid(page, 'history-status-all').getAttribute('aria-pressed'),
      'Clear filters resets the status').toBe('true');
    expect(await tid(page, 'history-from').inputValue(), 'and keeps the range').toBe(dayOffset(-29));
  }

  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('main button, main a[href], main input, main select')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()}[${el.dataset.testid || norm(el.textContent).slice(0, 16)}] = ${Math.round(r.height)}px`);
    }
    return out;
  });
  expect(small, `nothing below 44 px on the live history screen\n${small.join('\n')}`).toEqual([]);

  harvest(watch, 'P6L-08 axe and filters');
  const real = realErrors(errors);
  expect(real, `console errors during the axe pass:\n${real.join('\n')}`).toEqual([]);
  record(`P6L-08 ${info.project.name}: PASS - zero serious/critical axe violations, no control under 44 px`);
});

/* ---------------------------------------------------------------- P6L-09 */

test('P6L-09 Sign out, and this verification wrote nothing to live Firestore', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  const watch = await openLiveHistory(page);
  await pickRange(page, '30d');

  await (await signOutButton(page)).click();
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 20000 }).toMatch(/^#\/login/);
  expect(await page.evaluate(() => window.localStorage.getItem('nba.session')), 'Sign out clears the session').toBeNull();
  await page.goto(LIVE + '#/reports/history', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 20000 }).toMatch(/^#\/login/);
  await shot(page, `${info.project.name}-signed-out`);

  harvest(watch, 'P6L-09 sign out');

  // 1. What the browser sent: not one document write, all session long.
  record(`P6L-09 ${info.project.name}: write classifier -> ${WRITES_SEEN.length} document write(s) seen in the browser` +
    (WRITES_SEEN.length ? `: ${WRITES_SEEN.join('; ')}` : ''));
  expect(WRITES_SEEN, 'CLAUDE.md Phase VI: read-only — no write may leave this screen').toEqual([]);

  // 2. What the database holds: unchanged, by count and by fingerprint.
  const after = (await liveFirestore('/orders?pageSize=300')).documents || [];
  const orders = after.map((d) => ({ id: d.name.split('/').pop(), ...plain(d.fields) }));
  expect(orders.length, 'the orders count must be unchanged').toBe(ORDERS_BEFORE.length);
  expect(fingerprint(orders), 'the orders collection changed during a read-only check')
    .toBe(fingerprint(ORDERS_BEFORE));
  const menu = docIds(await liveFirestore('/menu?pageSize=50'));
  expect(menu, 'the menu must be the same documents afterwards').toEqual(MENU_BEFORE);

  const real = realErrors(errors);
  expect(real, `console errors signing out:\n${real.join('\n')}`).toEqual([]);
  record(`P6L-09 ${info.project.name}: PASS - signed out, zero writes, orders (${orders.length}) and menu (${menu.length}) unchanged`);
});
