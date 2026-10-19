// P4L-* — Phase IV (Orders list and order detail) live verification against
// LIVE_URL. STRICTLY READ-ONLY.
//
// Gated: skipped unless LIVE_P4=1, the same style as the S-*, H-20, H-22 and
// P3L-* live specs, so `npm run test:e2e` stays offline and deterministic.
// Run only AFTER v1.3.0 is deployed:
//
//   LIVE_P4=1 LIVE_BUILD=<short sha> npx playwright test tests/e2e/live-p4.spec.js
//
// WRITE DISCIPLINE. Nothing here writes to live Firestore. Every Firestore
// call in this file is a GET over the REST API. No order is placed
// (`send-order` is never clicked and no till tile is tapped), no status is
// changed, nothing is cancelled, no menu or settings document is touched.
// The Orders screen is itself read-only (CLAUDE.md Phase IV), and exporting
// its CSV is a download of data already fetched, not a write. P4L-00 and
// P4L-11 bracket the run with a fingerprint of the orders collection to prove
// it. Live `orders` may hold real trading records, including the leftover
// QA smoke order, which must be left exactly where it is.
//
// CREDENTIALS: read at run time from the gitignored .secrets/app-login.env by
// ./creds.js. Never written into a test file, a log line, a screenshot or
// qa/live-smoke-record.txt (all committed to a public repo). The Show/Hide
// toggle is never pressed, so the password stays masked in every screenshot.
//
// CACHE DISCIPLINE. Static assets are served with `cache-control: max-age=600`,
// so a context that loaded the previous build in the last ten minutes could
// read a stale version.js against a correctly deployed origin. Guards: a fresh
// Playwright context per test, and the browser HTTP cache switched off over
// CDP (`Network.setCacheDisabled`) before the first navigation. The version is
// read through the UI, never by fetching version.js: the labels are what
// Phase IV ships.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';
import { appendFileSync, readFileSync } from 'node:fs';
import {
  attachConsole, realErrors, SHOTS, ROOT,
  loginUserField, loginPassField, loginSubmit, signOutButton, parseCsv
} from './helpers.js';
import { creds } from './creds.js';
import { MENU } from '../../public/js/logic.js';

const LIVE = process.env.LIVE_URL || 'https://nottinghambengaliassociation.github.io/nba-food-stall-app/';
const C = creds();

const PKG_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
const EXPECTED_BUILD = (process.env.LIVE_BUILD || '').trim();

const BUILD_SHAPE = /^[0-9a-f]{7}$/;
const DATE_SHAPE = /^\d{1,2} [A-Z][a-z]{2} \d{4}$/;

const SIGNED_IN_ROUTES = ['#/', '#/cash', '#/kitchen', '#/reports', '#/reports/days', '#/reports/orders'];

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const tid = (page, name) => page.locator(`[data-testid="${name}"]`);

test.skip(!process.env.LIVE_P4, 'set LIVE_P4=1 to run the read-only Phase IV live check (after deploy)');
test.describe.configure({ mode: 'serial' });

/* ------------------------------------------------------------- plumbing */

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

/** Append one line to qa/live-smoke-record.txt. Public file: values must be safe. */
function record(line) {
  // eslint-disable-next-line no-console
  console.log(`[LIVE-P4] ${line}`);
  try { appendFileSync(resolve(SHOTS, '../live-smoke-record.txt'), line + '\n'); } catch { /* ignore */ }
}

const shot = (page, name) => page.screenshot({ path: resolve(SHOTS, `live-p4-${name}.png`), fullPage: true });

/**
 * Read-only Firestore REST access with the web API key the deployed app
 * already hands to every browser. GET only — this helper cannot write.
 * The key is held in a local variable and is never recorded or printed.
 */
async function liveRead(path, { allow404 = false } = {}) {
  const cfg = await (await fetch(LIVE + 'js/firebase-config.js')).text();
  const apiKey = (cfg.match(/apiKey:\s*["']([^"']+)["']/) || [])[1];
  const projectId = (cfg.match(/projectId:\s*["']([^"']+)["']/) || [])[1];
  if (!apiKey || !projectId) throw new Error('could not read the deployed firebase config');
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents${path}`
    + `${path.includes('?') ? '&' : '?'}key=${apiKey}`;
  const res = await fetch(url);
  if (res.status === 404 && allow404) return null;
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
    if ('mapValue' in v) return plain(v.mapValue.fields || {});
    return v;
  };
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = val(v);
  return out;
}

async function liveOrders() {
  const all = await liveRead('/orders?pageSize=300');
  return (all.documents || []).map((d) => ({ _id: d.name.split('/').pop(), ...plain(d.fields) }));
}

const fingerprint = (orders) => JSON.stringify(
  orders
    .map((o) => ({
      id: o._id, orderNo: o.orderNo, status: o.status, total: o.total, day: o.day,
      items: (o.items || []).map((i) => `${i.id}|${i.name}|${i.qty}|${i.price}`)
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
);

let ORDERS_BEFORE = null;
let MENU_BEFORE = null;

/* ------------------------------------------- expectations, computed here */

const SHORT = MENU.reduce((a, m) => (a[m.id] = m.short, a), {});
const STATUS_LABEL = {
  new: 'New', preparing: 'Preparing', ready: 'Ready', collected: 'Collected', cancelled: 'Cancelled'
};

const gbp = (pence) => {
  const abs = Math.abs(Math.round(pence));
  return (pence < 0 ? '-' : '') + '£' + Math.floor(abs / 100).toLocaleString('en-GB') + '.' + String(abs % 100).padStart(2, '0');
};

/** Europe/London YYYY-MM-DD for an epoch-ms timestamp. */
function londonDayOf(ms) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(Number(ms))).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}`;
}

function londonHHMM(ms) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(Number(ms)));
}

/** What the Orders screen should show for one live order, worked out here. */
function expectedRow(o) {
  const lines = Array.isArray(o.items) ? o.items : [];
  const waitMs = Number(o.readyAtMs) - Number(o.createdAtMs);
  return {
    no: o.orderNo,
    time: londonHHMM(o.createdAtMs),
    name: o.name || 'Guest',
    items: lines.map((l) => `${l.qty}× ${SHORT[l.id] || l.name || l.id}`).join(', '),
    total: gbp(Number(o.total) || 0),
    pay: o.payment === 'card' ? 'Card' : 'Cash',
    status: STATUS_LABEL[o.status] || o.status,
    wait: Number(o.readyAtMs) && Number(o.createdAtMs) && waitMs >= 0 ? `${Math.round(waitMs / 60000)} min` : '—',
    till: o.till,
    lineCount: lines.length
  };
}

function summaryFor(orders) {
  const live = orders.filter((o) => o.status !== 'cancelled');
  const cancelled = orders.length - live.length;
  const total = live.reduce((a, o) => a + (Number(o.total) || 0), 0);
  return `${orders.length} orders · ${gbp(total)}` + (cancelled ? ` (excludes ${cancelled} cancelled)` : '');
}

async function signInLive(page) {
  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  await (await loginSubmit(page)).waitFor({ state: 'visible', timeout: 30000 });
  await (await loginUserField(page)).fill(C.user);
  await (await loginPassField(page)).fill(C.password);
  await (await loginSubmit(page)).click();
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 30000 }).toBe('#/');
}

/** Open #/reports/orders live, signed in, with the list rendered. */
async function openLiveOrders(page, query = '') {
  await page.goto(LIVE + '#/reports/orders' + query, { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'orders-summary')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2500);
}

const entry = (page, no) => page.locator([
  `[data-testid="orders-row-${no}"]`, `[data-testid="order-row-${no}"]`,
  `[data-testid="orders-card-${no}"]`, `[data-testid="order-card-${no}"]`
].join(', ')).first();

const openButton = (page, no) => page.locator([
  `[data-testid="orders-open-${no}"]`, `[data-testid="order-open-${no}"]`,
  `[data-testid="orders-card-${no}"]`, `[data-testid="order-card-${no}"]`
].join(', ')).first();

function parseLine(text) {
  const m = norm(text).match(/^Version\s+(\S+)\s+·\s+build\s+(\S+)\s+·\s+updated\s+(.+)$/);
  return m ? { version: m[1], build: m[2], date: m[3] } : null;
}
function parseTitle(text) {
  const m = norm(text).match(/^Version\s+(.+?),\s+build\s+(.+?),\s+updated\s+(.+)$/);
  return m ? { version: m[1], build: m[2], date: m[3] } : null;
}

/* ---------------------------------------------------------------- P4L-00 */

test('P4L-00 snapshot the live orders and menu before anything else', async () => {
  ORDERS_BEFORE = await liveOrders();
  const menu = await liveRead('/menu?pageSize=50');
  MENU_BEFORE = (menu.documents || []).map((d) => d.name.split('/').pop()).sort();

  const days = [...new Set(ORDERS_BEFORE.map((o) => o.day))].sort();
  const byStatus = ORDERS_BEFORE.reduce((a, o) => (a[o.status] = (a[o.status] || 0) + 1, a), {});
  record(`P4L-00 live orders before the check: ${ORDERS_BEFORE.length} document(s); ` +
    `days [${days.join(', ')}]; status ${JSON.stringify(byStatus)}; ` +
    `[${ORDERS_BEFORE.map((o) => `${o.orderNo}/${o.status}/${o.day}`).sort().join(', ')}]`);
  record(`P4L-00 live menu before the check: ${MENU_BEFORE.length} document(s) [${MENU_BEFORE.join(', ')}]`);
  // This used to demand at least one live order. CLAUDE.md H3 7 then reset
  // live data ("After the reset, reports start empty"), so an empty `orders`
  // collection is now the expected state until the stall trades. The
  // data-dependent cases below skip with a reason rather than fail, and a
  // read-only live check never creates an order to satisfy itself.
  if (!ORDERS_BEFORE.length) {
    record('P4L-00 live `orders` is empty (CLAUDE.md H3 7 reset); P4L-05..P4L-09 skip, the empty-state checks still run');
  }
  expect(MENU_BEFORE.length, 'the live menu must be readable').toBeGreaterThan(0);
});

/** CLAUDE.md H3 7: after the live reset there may be no orders to read. */
const needOrders = () =>
  test.skip(!(ORDERS_BEFORE && ORDERS_BEFORE.length),
    'live `orders` is empty after the H3 reset (CLAUDE.md H3 7); nothing to read and this check never writes');

/* ---------------------------------------------------------------- P4L-01 */

test('P4L-01 signed out: the guard holds and the login card shows the v1.3.0 line', async ({ page }, info) => {
  const errors = attachConsole(page);
  await disableCache(page);

  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  await (await loginSubmit(page)).waitFor({ state: 'visible', timeout: 30000 });
  await expect(page.getByText(/login not configured/i), 'the live login must be configured').toHaveCount(0);

  const line = tid(page, 'login-version');
  await expect(line, 'CLAUDE.md Phase III part 2, 4').toBeVisible({ timeout: 20000 });
  const text = norm(await line.innerText());
  const parts = parseLine(text);
  record(`P4L-01 ${info.project.name} login-version: "${text}"`);
  expect(parts, 'login-version must read "Version x.y.z · build <sha> · updated <date>"').toBeTruthy();
  expect(parts.version, 'CLAUDE.md Phase IV 10: the deployed version is 1.3.0').toBe(PKG_VERSION);
  expect(parts.build, `live build "${parts.build}" must be a clean 7-character SHA with no -dirty`).toMatch(BUILD_SHAPE);
  expect(parts.date).toMatch(DATE_SHAPE);
  if (EXPECTED_BUILD) {
    expect(parts.build, `V-c: the build shown live must equal the pushed short SHA ${EXPECTED_BUILD}`)
      .toBe(EXPECTED_BUILD);
  }
  await shot(page, `${info.project.name}-login-version`);

  for (const route of SIGNED_IN_ROUTES) {
    await page.evaluate((r) => { window.location.hash = r; }, route);
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => window.location.hash), `${route} signed out must redirect to #/login`)
      .toMatch(/^#\/login/);
  }
  const real = realErrors(errors);
  record(`P4L-01 ${info.project.name} console errors signed out: ${real.length}`);
  expect(real, `console errors on the signed-out live app:\n${real.join('\n')}`).toEqual([]);
});

/* ---------------------------------------------------------------- P4L-02 */

test('P4L-02 signed in: all seven routes load, the pill reads Online, no console errors', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await disableCache(page);
  await signInLive(page);

  for (const route of SIGNED_IN_ROUTES) {
    await page.goto(LIVE + route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header').first(), `${route} must render`).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2200);
    await expect(page.getByText(/storage not configured/i), `${route}: live storage must be configured`).toHaveCount(0);
    const pill = tid(page, 'conn-pill');
    await expect(pill, `${route}: the connection pill`).toBeVisible();
    await expect(pill, `${route}: CLAUDE.md Cash 6 — the pill reads Online · synced when connected`)
      .toHaveText(/Online\s*·\s*synced/, { timeout: 20000 });
    const name = route === '#/' ? 'landing' : route.replace('#/', '').replace(/\//g, '-');
    await shot(page, `${info.project.name}-${name}`);
  }

  const real = realErrors(errors);
  record(`P4L-02 ${info.project.name} console errors across ${SIGNED_IN_ROUTES.join(' ')}: ${real.length}`);
  expect(real, `console errors on the live app signed in:\n${real.join('\n')}`).toEqual([]);
});

/* ---------------------------------------------------------------- P4L-03 */

test('P4L-03 the v1.3.0 pill is in every dark header, read through the UI', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await disableCache(page);
  await signInLive(page);
  const phone = info.project.name === 'phone';

  const seen = [];
  for (const route of SIGNED_IN_ROUTES) {
    await page.goto(LIVE + route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1200);

    // Hotfix H3 1 replaced the phone cash counter's dark header and moved the
    // version line into the ☰ menu, so below 700 px the Phase III header pill
    // is not on #/cash and the pill geometry below does not apply there.
    const smallCash = phone && route === '#/cash';
    if (smallCash) {
      await tid(page, 'menu-button').click();
      await expect(tid(page, 'app-menu'), '#/cash: CLAUDE.md H3 1: the ☰ menu').toBeVisible();
    }

    const label = tid(page, 'app-version');
    await expect(label, `${route}: CLAUDE.md Phase III part 2, 5`).toBeVisible();
    if (!smallCash) {
      expect(await label.evaluate((el) => !!el.closest('header')), `${route}: the label belongs in the dark header`).toBe(true);
    }
    expect(norm(await label.innerText()), `${route}: CLAUDE.md Phase IV 10 — the header label reads v<version>`)
      .toBe('v' + PKG_VERSION);

    const title = parseTitle(await label.getAttribute('title'));
    const aria = parseTitle(await label.getAttribute('aria-label'));
    expect(title, `${route}: app-version needs a title`).toBeTruthy();
    expect(aria, `${route}: app-version needs an aria-label`).toBeTruthy();
    expect(title, `${route}: title and aria-label must match`).toEqual(aria);
    expect(title.version).toBe(PKG_VERSION);
    expect(title.build, `${route}: live build "${title.build}" must be a clean 7-character SHA`).toMatch(BUILD_SHAPE);
    expect(title.date).toMatch(DATE_SHAPE);
    if (EXPECTED_BUILD) {
      expect(title.build, `V-c on ${route}: the build shown live must equal the pushed short SHA ${EXPECTED_BUILD}`)
        .toBe(EXPECTED_BUILD);
    }
    seen.push(`${route}=${title.version}/${title.build}/${title.date}`);

    if (smallCash) {
      await page.keyboard.press('Escape');
      await expect(tid(page, 'app-menu')).toBeHidden({ timeout: 8000 });
      continue;
    }

    const geom = await label.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const t = el.closest('header').querySelector('[data-testid="screen-title"]').getBoundingClientRect();
      return {
        size: parseFloat(cs.fontSize), weight: cs.fontWeight, colour: cs.color,
        borderWidth: parseFloat(cs.borderTopWidth) || 0, borderColour: cs.borderTopColor,
        radius: parseFloat(cs.borderTopLeftRadius) || 0,
        top: r.top, left: r.left, titleBottom: t.bottom, titleRight: t.right
      };
    });
    if (phone) {
      expect(geom.size, `${route}: 12 px below 700 px`).toBeCloseTo(12, 0);
      expect(geom.top, `${route}: under the title below 700 px`).toBeGreaterThanOrEqual(geom.titleBottom - 1);
      const short = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('header button, header select')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.height < 43.5) out.push(`${el.tagName}[${el.dataset.testid || ''}]=${Math.round(r.height)}`);
        }
        return out;
      });
      expect(short, `${route}: the version line must not squeeze the header buttons`).toEqual([]);
    } else {
      expect(geom.size, `${route}: 13 px at 700 px and wider`).toBeCloseTo(13, 0);
      expect(geom.borderWidth, `${route}: the pill is outlined`).toBeGreaterThanOrEqual(1);
      expect(geom.borderColour, `${route}: 1 px #57534E border`).toBe('rgb(87, 83, 78)');
      expect(geom.colour, `${route}: #D6D3D1 text`).toBe('rgb(214, 211, 209)');
      expect(geom.radius, `${route}: fully rounded`).toBeGreaterThanOrEqual(99);
      expect(geom.left, `${route}: right after the screen title`).toBeGreaterThanOrEqual(geom.titleRight - 1);
    }
  }
  record(`P4L-03 ${info.project.name} rendered version labels: ${seen.join(' | ')}`);

  await page.goto(LIVE + '#/reports/orders', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('header').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot(page, `${info.project.name}-header-version`);

  expect(realErrors(errors), 'console errors while reading the live version labels').toEqual([]);
});

/* ---------------------------------------------------------------- P4L-04 */

test('P4L-04 the Orders tab is on all three report screens with the right labels', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  await disableCache(page);
  await signInLive(page);
  const phone = info.project.name === 'phone';
  const want = {
    day: 'One day',
    days: phone ? 'By day' : 'Sales by day',
    orders: 'Orders'
  };

  for (const route of ['#/reports', '#/reports/days', '#/reports/orders']) {
    await page.goto(LIVE + route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    const texts = await page.evaluate(() => {
      const read = (id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : null;
      };
      return {
        day: read('report-view-day') || read('report-toggle-day'),
        days: read('report-view-days') || read('report-toggle-days'),
        orders: read('report-view-orders') || read('report-toggle-orders')
      };
    });
    expect(texts.day, `${route}: One day label`).toBe(want.day);
    expect(texts.days, `${route}: by-day label at this width`).toBe(want.days);
    expect(texts.orders, `${route}: CLAUDE.md Phase IV 1 — the Orders tab`).toBe(want.orders);

    const height = await tid(page, 'report-view-orders').evaluate((el) => el.getBoundingClientRect().height);
    expect(height, 'the tabs are at least 48 px').toBeGreaterThanOrEqual(47);
  }

  // On #/reports/orders the Orders tab is the filled-ink current one.
  const ink = await page.evaluate(() => {
    const read = (id) => {
      const wrap = document.querySelector(`[data-testid="${id}"]`);
      if (!wrap) return null;
      const node = wrap.matches('a, button') ? wrap : (wrap.querySelector('a, button') || wrap);
      return getComputedStyle(node).backgroundColor;
    };
    return { orders: read('report-view-orders'), day: read('report-view-day'), days: read('report-view-days') };
  });
  expect(ink.orders, 'the current tab is filled ink #1C1917').toBe('rgb(28, 25, 23)');
  expect(ink.day, 'only the current tab is filled').not.toBe('rgb(28, 25, 23)');
  expect(ink.days, 'only the current tab is filled').not.toBe('rgb(28, 25, 23)');
  expect(await tid(page, 'report-view-orders').getAttribute('aria-current')).toBe('page');
  record(`P4L-04 ${info.project.name} tabs: ${want.day} | ${want.days} | ${want.orders}, Orders current`);
});

/* ---------------------------------------------------------------- P4L-05 */

test('P4L-05 the live orders list, its summary, filters and search', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  needOrders();
  const errors = attachConsole(page);
  await disableCache(page);
  await signInLive(page);

  // The day the live order is on; default is today (Europe/London).
  const day = await (async () => {
    const today = londonDayOf(Date.now());
    return ORDERS_BEFORE.some((o) => o.day === today) ? today : ORDERS_BEFORE.map((o) => o.day).sort().pop();
  })();
  const dayOrders = ORDERS_BEFORE.filter((o) => o.day === day)
    .sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0));

  await openLiveOrders(page, day === londonDayOf(Date.now()) ? '' : `?day=${day}`);
  expect(await tid(page, 'orders-day').inputValue(), 'the Day input').toBe(day);

  const summary = norm(await tid(page, 'orders-summary').innerText());
  record(`P4L-05 ${info.project.name} summary on ${day}: "${summary}"`);
  expect(summary, 'CLAUDE.md Phase IV 4: the summary must match the live documents')
    .toBe(summaryFor(dayOrders));

  // Newest first, and every field of every row against the live document.
  const listed = await page.evaluate(() => {
    const seen = [];
    for (const el of document.querySelectorAll('[data-testid]')) {
      const m = /^orders?-(?:row|card)-(.+)$/.exec(el.dataset.testid);
      if (m && !seen.includes(m[1])) seen.push(m[1]);
    }
    return seen;
  });
  expect(listed, 'CLAUDE.md Phase IV 5: newest first').toEqual(dayOrders.map((o) => o.orderNo));

  const sample = expectedRow(dayOrders[0]);
  const row = entry(page, sample.no);
  await expect(row).toBeVisible();
  const rowText = norm(await row.innerText());
  record(`P4L-05 ${info.project.name} row ${sample.no}: "${rowText}"`);
  for (const [field, value] of Object.entries({
    'order number': sample.no, time: sample.time, name: sample.name,
    total: sample.total, pay: sample.pay, status: sample.status
  })) {
    expect(rowText, `${sample.no}: ${field}`).toContain(value);
  }
  expect(rowText, `${sample.no}: items in menu short names`).toContain(sample.items.split(', ')[0]);
  if (info.project.name === 'phone') {
    expect(rowText, 'the phone card reads "HH:MM · Pay · till X"')
      .toMatch(new RegExp(`${sample.time}\\s*·\\s*${sample.pay}\\s*·\\s*till\\s*${sample.till}`));
  } else {
    expect(rowText, `${sample.no}: wait`).toContain(sample.wait);
  }
  await shot(page, `${info.project.name}-reports-orders`);

  // Status filter: its own status shows it, another status does not.
  const statusKey = dayOrders[0].status;
  const otherStatus = ['new', 'preparing', 'ready', 'collected', 'cancelled'].find((k) => k !== statusKey);
  await tid(page, `orders-status-${statusKey}`).click();
  await page.waitForTimeout(1200);
  await expect(entry(page, sample.no), `status=${statusKey} keeps its own order`).toBeVisible();
  await tid(page, `orders-status-${otherStatus}`).click();
  await page.waitForTimeout(1200);
  await expect(entry(page, sample.no), `status=${otherStatus} filters it out`).toHaveCount(0);
  await expect(tid(page, 'orders-empty'), 'CLAUDE.md Phase IV 5: the empty message').toBeVisible();
  expect(norm(await tid(page, 'orders-empty').innerText())).toBe('No orders match these filters.');
  await tid(page, 'orders-status-all').click();
  await page.waitForTimeout(1000);

  // Payment filter: tablet only (CLAUDE.md Phase IV 2).
  if (info.project.name === 'phone') {
    await expect(tid(page, 'orders-pay-cash'), 'no payment filter on the phone').toHaveCount(0);
  } else {
    const payKey = dayOrders[0].payment === 'card' ? 'card' : 'cash';
    const otherPay = payKey === 'card' ? 'cash' : 'card';
    await tid(page, `orders-pay-${payKey}`).click();
    await page.waitForTimeout(1200);
    await expect(entry(page, sample.no), `pay=${payKey} keeps its own order`).toBeVisible();
    await tid(page, `orders-pay-${otherPay}`).click();
    await page.waitForTimeout(1200);
    await expect(entry(page, sample.no), `pay=${otherPay} filters it out`).toHaveCount(0);
    await tid(page, 'orders-pay-all').click();
    await page.waitForTimeout(1000);
  }

  // Search by order number and by name, case-insensitively, then nothing.
  const search = tid(page, 'orders-search');
  for (const term of [sample.no.toLowerCase(), sample.name.toLowerCase(), sample.name.toUpperCase()]) {
    await search.fill(term);
    await search.dispatchEvent('input');
    await page.waitForTimeout(1000);
    await expect(entry(page, sample.no), `search "${term}" must match`).toBeVisible();
  }
  await search.fill('zzzzzz');
  await search.dispatchEvent('input');
  await page.waitForTimeout(1000);
  await expect(tid(page, 'orders-empty'), 'a search matching nothing').toBeVisible();
  await search.fill('');
  await search.dispatchEvent('input');
  await page.waitForTimeout(1000);

  expect(realErrors(errors), 'console errors on the live Orders screen').toEqual([]);
});

/* ---------------------------------------------------------------- P4L-06 */

test('P4L-06 the detail opens from the live order, and the phone comes back', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  needOrders();
  const errors = attachConsole(page);
  await disableCache(page);
  await signInLive(page);
  const phone = info.project.name === 'phone';

  const today = londonDayOf(Date.now());
  const day = ORDERS_BEFORE.some((o) => o.day === today) ? today : ORDERS_BEFORE.map((o) => o.day).sort().pop();
  const dayOrders = ORDERS_BEFORE.filter((o) => o.day === day)
    .sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0));
  const o = dayOrders[0];
  const want = expectedRow(o);

  await openLiveOrders(page, day === today ? '' : `?day=${day}`);

  if (!phone) {
    await expect(tid(page, 'order-detail-empty'), 'CLAUDE.md Phase IV 6: nothing selected to start with').toBeVisible();
    expect(norm(await tid(page, 'order-detail-empty').innerText())).toBe('Select an order to see its items.');
  }

  await openButton(page, want.no).click();
  await page.waitForTimeout(1500);
  const panel = tid(page, 'order-detail');
  await expect(panel, 'CLAUDE.md Phase IV 6/7: the detail').toBeVisible({ timeout: 20000 });
  const text = norm(await panel.innerText());
  record(`P4L-06 ${info.project.name} detail ${want.no}: "${text.slice(0, 220)}"`);

  for (const [field, value] of Object.entries({
    'order number': want.no, name: want.name, status: want.status,
    till: want.till, payment: want.pay, 'placed time': want.time, total: want.total
  })) {
    expect(text, `detail: ${field}`).toContain(value);
  }

  // Timeline: Placed is always there; a cancelled order ends at Cancelled.
  await expect(tid(page, 'order-step-placed'), 'the Placed step').toBeVisible();
  expect(norm(await tid(page, 'order-step-placed').innerText())).toContain(want.time);
  if (o.status === 'cancelled') {
    await expect(tid(page, 'order-step-cancelled'), 'CLAUDE.md Phase IV 6: Placed → Cancelled').toBeVisible();
    await expect(tid(page, 'order-step-started')).toHaveCount(0);
  } else {
    for (const step of ['started', 'ready', 'collected']) {
      await expect(tid(page, `order-step-${step}`), `the ${step} step`).toBeVisible();
    }
    if (Number(o.readyAtMs)) {
      expect(norm(await tid(page, 'order-step-ready').innerText())).toContain(londonHHMM(o.readyAtMs));
    }
  }

  // Every line of the order, with its icon.
  for (const l of (o.items || [])) {
    expect(text, `detail: the ${l.id} line`).toContain(l.name || SHORT[l.id]);
  }
  expect(await panel.locator('svg').count(), 'each item line carries its icon')
    .toBeGreaterThanOrEqual((o.items || []).length);
  await shot(page, `${info.project.name}-reports-orders-detail`);

  if (phone) {
    await expect(tid(page, 'orders-list'), 'the phone detail takes the whole screen').toBeHidden();
    const back = page.locator('[data-testid="orders-back"], [data-testid="order-back"]').first();
    await expect(back, 'CLAUDE.md Phase IV 7: an "All orders" back button').toBeVisible();
    expect(norm(await back.innerText())).toContain('All orders');
    await back.click();
    await page.waitForTimeout(1200);
    await expect(tid(page, 'orders-list'), 'the back button returns to the list').toBeVisible();

    await openButton(page, want.no).click();
    await page.waitForTimeout(1500);
    await expect(tid(page, 'order-detail')).toBeVisible();
    await page.goBack();
    await page.waitForTimeout(1500);
    await expect(tid(page, 'orders-list'),
      'CLAUDE.md Phase IV 7: the browser back button also returns to the list').toBeVisible();
    await expect(tid(page, 'order-detail')).toBeHidden();
  } else {
    const list = await tid(page, 'orders-table').boundingBox();
    const det = await panel.boundingBox();
    expect(det.x, 'at tablet width the detail sits beside the list').toBeGreaterThanOrEqual(list.x + list.width - 2);
    const note = norm(await tid(page, 'order-detail-note').innerText());
    expect(note, 'CLAUDE.md Phase IV 6: the read-only note').toBe(
      'Read-only. Orders are cancelled from the cash counter; status changes happen on the food counter. ' +
      'Cancelled orders are listed but excluded from every total.'
    );
  }

  expect(realErrors(errors), 'console errors while opening the live detail').toEqual([]);
});

/* ---------------------------------------------------------------- P4L-07 */

test('P4L-07 ?day= opens that day', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  needOrders();
  await disableCache(page);
  await signInLive(page);

  const today = londonDayOf(Date.now());
  const day = ORDERS_BEFORE.some((o) => o.day === today) ? today : ORDERS_BEFORE.map((o) => o.day).sort().pop();
  const dayOrders = ORDERS_BEFORE.filter((o) => o.day === day);

  await openLiveOrders(page, `?day=${day}`);
  expect(await tid(page, 'orders-day').inputValue(),
    'CLAUDE.md Phase IV 2: #/reports/orders?day=YYYY-MM-DD opens that day').toBe(day);
  await expect(entry(page, dayOrders[0].orderNo)).toBeVisible();
  expect(norm(await tid(page, 'orders-summary').innerText())).toBe(summaryFor(dayOrders));

  // A day the stall never traded: the same route, an empty list.
  await openLiveOrders(page, '?day=2020-01-01');
  expect(await tid(page, 'orders-day').inputValue()).toBe('2020-01-01');
  await expect(tid(page, 'orders-empty'), 'a day with no orders').toBeVisible({ timeout: 20000 });
  expect(norm(await tid(page, 'orders-summary').innerText())).toMatch(/^0 orders? · £0\.00$/);
  record(`P4L-07 ${info.project.name} ?day=${day} and ?day=2020-01-01 both opened their own day`);
});

/* ---------------------------------------------------------------- P4L-08 */

test('P4L-08 the orders CSV downloads and its bytes are right', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  needOrders();
  test.skip(info.project.name === 'phone', 'design/ReportsOrdersMobile.dc.html has no export control on the phone');
  await disableCache(page);
  await signInLive(page);

  const today = londonDayOf(Date.now());
  const day = ORDERS_BEFORE.some((o) => o.day === today) ? today : ORDERS_BEFORE.map((o) => o.day).sort().pop();
  const dayOrders = ORDERS_BEFORE.filter((o) => o.day === day)
    .sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0));
  const expectedLines = dayOrders.reduce((a, o) => a + (o.items || []).length, 0);

  await openLiveOrders(page, day === today ? '' : `?day=${day}`);
  const button = page.locator('[data-testid="export-orders-csv"], [data-testid="orders-export-csv"]').first();
  await expect(button, 'CLAUDE.md Phase IV 8').toBeVisible();
  expect(norm(await button.innerText())).toContain('Export these orders');

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    button.click()
  ]);
  expect(download.suggestedFilename(), 'CLAUDE.md Phase IV 8: nba-food-stall_orders_<day>.csv')
    .toBe(`nba-food-stall_orders_${day}.csv`);

  const text = readFileSync(await download.path(), 'utf8');
  const header = text.split(/\r?\n/)[0];
  expect(header, 'the Orders CSV has exactly the One day columns')
    .toBe('day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds');
  expect(text, 'the Phase I tendered field is never exported').not.toMatch(/tendered/i);

  const rows = parseCsv(text);
  const col = (n) => rows[0].indexOf(n);
  const body = rows.slice(1);
  expect(body, 'one row per line of the orders shown').toHaveLength(expectedLines);
  for (const r of body) {
    expect(r, `row has ${r.length} fields`).toHaveLength(13);
    expect(r[col('day')], 'every row is on the exported day').toBe(day);
    expect(Number(r[col('lineTotal')])).toBe(Number(r[col('qty')]) * Number(r[col('price')]));
    expect(r[col('item')], 'no blank item name').not.toBe('');
  }
  // The rows follow the list, newest first.
  const seen = [];
  for (const r of body) if (seen[seen.length - 1] !== r[col('orderNo')]) seen.push(r[col('orderNo')]);
  expect(seen, 'the export follows the list').toEqual(dayOrders.map((o) => o.orderNo));

  // And the money in the file agrees with the live documents.
  const byOrder = {};
  for (const r of body) byOrder[r[col('orderNo')]] = (byOrder[r[col('orderNo')]] || 0) + Number(r[col('lineTotal')]);
  for (const o of dayOrders) {
    expect(byOrder[o.orderNo], `${o.orderNo} line totals must add up to its stored total`).toBe(Number(o.total));
  }
  record(`P4L-08 ${info.project.name} CSV "nba-food-stall_orders_${day}.csv": ${body.length} data row(s), ` +
    `13 columns, orders [${seen.join(', ')}], no tendered column`);
});

/* ---------------------------------------------------------------- P4L-09 */

test('P4L-09 axe finds no serious or critical violations on the live Orders screen', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  needOrders();
  await disableCache(page);
  await signInLive(page);

  const today = londonDayOf(Date.now());
  const day = ORDERS_BEFORE.some((o) => o.day === today) ? today : ORDERS_BEFORE.map((o) => o.day).sort().pop();
  const first = ORDERS_BEFORE.filter((o) => o.day === day)
    .sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0))[0];

  await openLiveOrders(page, day === today ? '' : `?day=${day}`);
  for (const state of ['list', 'detail']) {
    if (state === 'detail') {
      await openButton(page, first.orderNo).click();
      await page.waitForTimeout(1500);
    }
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const detail = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`).join('\n');
    record(`P4L-09 ${info.project.name} axe ${state}: ${bad.length} serious/critical`);
    expect(bad, `live #/reports/orders (${state}) axe serious/critical violations:\n${detail}`).toEqual([]);
  }
});

/* ---------------------------------------------------------------- P4L-10 */

test('P4L-10 Sign out from the Orders screen returns to #/login', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  await disableCache(page);
  await signInLive(page);

  await page.goto(LIVE + '#/reports/orders', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('header').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1800);

  await (await signOutButton(page)).click();
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 20000 }).toMatch(/^#\/login/);
  expect(await page.evaluate(() => window.localStorage.getItem('nba.session')), 'Sign out clears the session').toBeNull();

  const line = tid(page, 'login-version');
  await expect(line, 'the version line is on the card after signing out too').toBeVisible({ timeout: 20000 });
  const parts = parseLine(await line.innerText());
  expect(parts.version).toBe(PKG_VERSION);
  if (EXPECTED_BUILD) expect(parts.build).toBe(EXPECTED_BUILD);
  record(`P4L-10 ${info.project.name} after sign out: "${norm(await line.innerText())}"`);
  await shot(page, `${info.project.name}-signed-out`);
});

/* ---------------------------------------------------------------- P4L-11 */

test('P4L-11 this verification wrote nothing to live Firestore', async () => {
  const after = await liveOrders();
  const days = [...new Set(after.map((o) => o.day))].sort();
  record(`P4L-11 live orders after the check: ${after.length} document(s); days [${days.join(', ')}]; ` +
    `[${after.map((o) => `${o.orderNo}/${o.status}/${o.day}`).sort().join(', ')}]`);
  expect(after.length, 'the orders collection changed length during a read-only check').toBe(ORDERS_BEFORE.length);
  expect(fingerprint(after), 'the orders collection changed during a read-only check')
    .toBe(fingerprint(ORDERS_BEFORE));

  const menu = await liveRead('/menu?pageSize=50');
  const ids = (menu.documents || []).map((d) => d.name.split('/').pop()).sort();
  record(`P4L-11 live menu untouched: ${ids.length} document(s) [${ids.join(', ')}]`);
  expect(ids, 'the menu must be exactly as it was found').toEqual(MENU_BEFORE);
});
