// P3L-* — Phase III (Sales by day + app version) live verification against
// LIVE_URL. STRICTLY READ-ONLY.
//
// Gated: skipped unless LIVE_P3=1, the same style as the S-*, H-20 and H-22
// live specs, so `npm run test:e2e` stays offline and deterministic.
// Run only AFTER v1.2.0 is deployed:
//
//   LIVE_P3=1 LIVE_BUILD=<short sha> npx playwright test tests/e2e/live-p3.spec.js
//
// WRITE DISCIPLINE. Nothing here writes to live Firestore. Every Firestore
// call in this file is a GET over the REST API. No order is placed
// (`send-order` is never clicked and no till tile is tapped), no status is
// changed, nothing is cancelled, no menu or settings document is touched.
// Exporting the CSV is a download of data already fetched, not a write.
// P3L-00 and P3L-09 bracket the run with a fingerprint of the orders
// collection to prove it. Live `orders` may hold real trading records.
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
// CDP (`Network.setCacheDisabled`) before the first navigation.
// NOT used: a `Cache-Control: no-cache` request header via `extraHTTPHeaders`
// — it is not CORS-safelisted, so Playwright would attach it to the Firebase
// SDK's cross-origin module imports on gstatic.com, preflight them into
// failure and hang the app on "Loading…" (observed in the H2 live round).
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { appendFileSync, readFileSync } from 'node:fs';
import {
  attachConsole, realErrors, SHOTS, ROOT,
  loginUserField, loginPassField, loginSubmit, signOutButton, parseCsv
} from './helpers.js';
import { creds } from './creds.js';

const LIVE = process.env.LIVE_URL || 'https://nottinghambengaliassociation.github.io/nba-food-stall-app/';
const C = creds();

const PKG_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
// V-c: the build shown live must equal the short SHA of the pushed commit.
// Passed in at run time so the committed test never carries a stale literal.
const EXPECTED_BUILD = (process.env.LIVE_BUILD || '').trim();

const BUILD_SHAPE = /^[0-9a-f]{7}$/;            // live must be a clean 7-char SHA, no -dirty
const DATE_SHAPE = /^\d{1,2} [A-Z][a-z]{2} \d{4}$/;

const SIGNED_IN_ROUTES = ['#/', '#/cash', '#/kitchen', '#/reports', '#/reports/days'];
const ALL_ROUTES = ['#/login', ...SIGNED_IN_ROUTES];

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

test.skip(!process.env.LIVE_P3, 'set LIVE_P3=1 to run the read-only Phase III live check (after deploy)');
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
  console.log(`[LIVE-P3] ${line}`);
  try { appendFileSync(resolve(SHOTS, '../live-smoke-record.txt'), line + '\n'); } catch { /* ignore */ }
}

const shot = (page, name) => page.screenshot({ path: resolve(SHOTS, `live-p3-${name}.png`), fullPage: true });

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
let LIVE_EVENT = null;

async function signInLive(page) {
  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  await (await loginSubmit(page)).waitFor({ state: 'visible', timeout: 30000 });
  await (await loginUserField(page)).fill(C.user);
  await (await loginPassField(page)).fill(C.password);
  await (await loginSubmit(page)).click();
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 30000 }).toBe('#/');
}

const tid = (page, name) => page.locator(`[data-testid="${name}"]`);

function parseLine(text) {
  const m = norm(text).match(/^Version\s+(\S+)\s+·\s+build\s+(\S+)\s+·\s+updated\s+(.+)$/);
  return m ? { version: m[1], build: m[2], date: m[3] } : null;
}
function parseTitle(text) {
  const m = norm(text).match(/^Version\s+(.+?),\s+build\s+(.+?),\s+updated\s+(.+)$/);
  return m ? { version: m[1], build: m[2], date: m[3] } : null;
}

/* ---------------------------------------------------------------- P3L-00 */

test('P3L-00 snapshot the live orders collection before anything else', async () => {
  ORDERS_BEFORE = await liveOrders();
  const days = [...new Set(ORDERS_BEFORE.map((o) => o.day))].sort();
  const byStatus = ORDERS_BEFORE.reduce((a, o) => (a[o.status] = (a[o.status] || 0) + 1, a), {});
  record(`P3L-00 live orders before the check: ${ORDERS_BEFORE.length} document(s); ` +
    `days [${days.join(', ')}]; status ${JSON.stringify(byStatus)}; ` +
    `[${ORDERS_BEFORE.map((o) => `${o.orderNo}/${o.status}/${o.day}`).sort().join(', ')}]`);

  LIVE_EVENT = await liveRead('/settings/event', { allow404: true });
  record(`P3L-00 settings/event is ${LIVE_EVENT ? 'PRESENT ' + JSON.stringify(plain(LIVE_EVENT.fields)) : 'ABSENT'}`);
});

/* ---------------------------------------------------------------- P3L-01 */

test('P3L-01 signed out: every route redirects to #/login and the version line is already there', async ({ page }, info) => {
  const errors = attachConsole(page);
  await disableCache(page);

  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  await (await loginSubmit(page)).waitFor({ state: 'visible', timeout: 30000 });
  await expect(page.getByText(/login not configured/i), 'the live login must be configured').toHaveCount(0);

  // The version line is on the card BEFORE sign-in.
  const line = tid(page, 'login-version');
  await expect(line).toBeVisible({ timeout: 20000 });
  const parts = parseLine(await line.innerText());
  record(`P3L-01 ${info.project.name} login-version before sign-in: "${norm(await line.innerText())}"`);
  expect(parts, 'login-version must read "Version x.y.z · build <sha> · updated <date>"').toBeTruthy();
  expect(parts.version).toBe(PKG_VERSION);
  expect(parts.build, `live build "${parts.build}" must be a clean 7-character SHA with no -dirty`).toMatch(BUILD_SHAPE);
  expect(parts.date).toMatch(DATE_SHAPE);
  if (EXPECTED_BUILD) {
    expect(parts.build, `V-c: the build shown live must equal the pushed short SHA ${EXPECTED_BUILD}`)
      .toBe(EXPECTED_BUILD);
  }
  await shot(page, `${info.project.name}-login-version`);

  // Route guard: every other route bounces to #/login.
  for (const route of SIGNED_IN_ROUTES) {
    await page.evaluate((r) => { window.location.hash = r.replace(/^#/, '#'); }, route);
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => window.location.hash), `${route} signed out must redirect to #/login`)
      .toMatch(/^#\/login/);
  }
  const real = realErrors(errors);
  record(`P3L-01 ${info.project.name} console errors signed out: ${real.length}`);
  expect(real, `console errors on the signed-out live app:\n${real.join('\n')}`).toEqual([]);
});

/* ---------------------------------------------------------------- P3L-02 */

test('P3L-02 signed in: every route loads, the pill reads Online · synced, no console errors', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await disableCache(page);
  await signInLive(page);

  for (const route of SIGNED_IN_ROUTES) {
    await page.goto(LIVE + route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header').first(), `${route} must render`).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    await expect(page.getByText(/storage not configured/i), `${route}: live storage must be configured`).toHaveCount(0);
    const pill = tid(page, 'conn-pill');
    await expect(pill, `${route}: the connection pill`).toBeVisible();
    await expect(pill, `${route}: CLAUDE.md Cash 6 — the pill reads Online · synced when connected`)
      .toHaveText(/Online\s*·\s*synced/, { timeout: 20000 });
    const name = route === '#/' ? 'landing' : route.replace('#/', '').replace('/', '-');
    await shot(page, `${info.project.name}-${name}`);
  }

  const real = realErrors(errors);
  record(`P3L-02 ${info.project.name} console errors across ${SIGNED_IN_ROUTES.join(' ')}: ${real.length}`);
  expect(real, `console errors on the live app signed in:\n${real.join('\n')}`).toEqual([]);
});

/* ---------------------------------------------------------------- P3L-03 */

test('P3L-03 V-c: app-version shows the pushed build on all five signed-in screens', async ({ page }, info) => {
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

    // Hotfix H3 1 replaced the phone cash counter's dark header with a 52 px
    // one-row header and moved the version line into the ☰ menu, so below
    // 700 px the Phase III header pill is not on #/cash. Open the menu and
    // read it there; the pill geometry below is the pre-H3 header and does
    // not apply to that one screen.
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
    expect(norm(await label.innerText()), `${route}: the header label reads v<version>`).toBe('v' + PKG_VERSION);

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
      expect(Number(geom.weight)).toBeGreaterThanOrEqual(700);
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
      expect(Number(geom.weight)).toBeGreaterThanOrEqual(700);
      expect(geom.borderWidth, `${route}: the pill is outlined`).toBeGreaterThanOrEqual(1);
      expect(geom.borderColour, `${route}: 1 px #57534E border`).toBe('rgb(87, 83, 78)');
      expect(geom.colour, `${route}: #D6D3D1 text`).toBe('rgb(214, 211, 209)');
      expect(geom.radius, `${route}: fully rounded`).toBeGreaterThanOrEqual(99);
      expect(geom.left, `${route}: right after the screen title`).toBeGreaterThanOrEqual(geom.titleRight - 1);
    }
  }
  record(`P3L-03 ${info.project.name} rendered version labels: ${seen.join(' | ')}`);

  await page.goto(LIVE + '#/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('header').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1200);
  await shot(page, `${info.project.name}-header-version`);

  expect(realErrors(errors), 'console errors while reading the live version labels').toEqual([]);
});

/* ---------------------------------------------------------------- P3L-04 */

test('P3L-04 the One day / Sales by day toggle works both ways on the live site', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  await disableCache(page);
  await signInLive(page);

  await page.goto(LIVE + '#/reports', { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'report-date')).toBeVisible({ timeout: 30000 });
  const dayPill = tid(page, 'report-toggle-day');
  const daysPill = tid(page, 'report-toggle-days');
  await expect(dayPill).toBeVisible();
  await expect(daysPill).toBeVisible();
  for (const pill of [dayPill, daysPill]) {
    const box = await pill.boundingBox();
    expect(box.height, 'CLAUDE.md Phase III 1: pill buttons at least 48 px').toBeGreaterThanOrEqual(47.5);
  }
  const inkOnDay = await dayPill.evaluate((el) => getComputedStyle(el.querySelector('a, button') || el).backgroundColor);
  expect(inkOnDay, 'the current view is filled ink #1C1917').toBe('rgb(28, 25, 23)');

  await daysPill.click();
  await page.waitForTimeout(1500);
  expect(page.url()).toContain('#/reports/days');
  await expect(tid(page, 'range-from')).toBeVisible({ timeout: 30000 });
  const inkOnDays = await tid(page, 'report-toggle-days')
    .evaluate((el) => getComputedStyle(el.querySelector('a, button') || el).backgroundColor);
  expect(inkOnDays).toBe('rgb(28, 25, 23)');

  await tid(page, 'report-toggle-day').click();
  await page.waitForTimeout(1500);
  await expect(tid(page, 'report-date')).toBeVisible({ timeout: 30000 });
  record(`P3L-04 ${info.project.name} toggle: One day <-> Sales by day both ways OK`);
});

/* ---------------------------------------------------------------- P3L-05 */

test('P3L-05 Sales by day live: range, quick buttons, This event, tiles, chart and tables', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await disableCache(page);
  await signInLive(page);

  await page.goto(LIVE + '#/reports/days', { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'range-from')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);

  // Default range: the last 7 days ending today (Europe/London).
  const today = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a, p) => (a[p.type] = p.value, a), {});
  const todayStr = `${today.year}-${today.month}-${today.day}`;
  const from = new Date(Date.parse(todayStr + 'T00:00:00Z') - 6 * 86400000).toISOString().slice(0, 10);
  expect(await tid(page, 'range-to').inputValue(), 'default range ends today').toBe(todayStr);
  expect(await tid(page, 'range-from').inputValue(), 'default range is the last 7 days').toBe(from);

  // Quick buttons.
  await expect(tid(page, 'quick-today')).toBeVisible();
  await expect(tid(page, 'quick-7days')).toBeVisible();
  const eventVisible = await tid(page, 'quick-event').isVisible();
  record(`P3L-05 ${info.project.name} "This event" quick button visible = ${eventVisible}; ` +
    `settings/event ${LIVE_EVENT ? 'PRESENT' : 'ABSENT'}`);
  expect(eventVisible, 'CLAUDE.md Phase III 2: "This event" is shown exactly when settings/event exists')
    .toBe(!!LIVE_EVENT);

  // Whatever is there, the screen is coherent: either trading days or the
  // empty message. Both are a pass (CLAUDE.md Phase III 4).
  const empty = await tid(page, 'days-empty').isVisible();
  const liveInRange = (ORDERS_BEFORE || [])
    .filter((o) => o.status !== 'cancelled' && o.day >= from && o.day <= todayStr);
  const expectedDays = [...new Set(liveInRange.map((o) => o.day))].sort();

  if (empty) {
    expect(expectedDays.length, 'the screen says "No sales in this range" but live orders exist in it').toBe(0);
    expect(norm(await tid(page, 'days-empty').innerText())).toContain('No sales in this range');
    await expect(tid(page, 'days-table')).toBeHidden();
    const tile = norm(await tid(page, 'tile-total-sales').innerText());
    expect(tile, 'an empty range shows zero, not NaN').toContain('£0.00');
    expect(tile).not.toMatch(/NaN|Infinity|undefined/);
    record(`P3L-05 ${info.project.name} range ${from}..${todayStr} is EMPTY and renders "No sales in this range"`);
  } else {
    // Tiles, chart and both tables, checked against the live documents.
    const sales = liveInRange.reduce((a, o) => a + (Number(o.total) || 0), 0);
    const items = liveInRange.reduce((a, o) => a + (o.items || []).reduce((n, l) => n + (Number(l.qty) || 0), 0), 0);
    const gbp = (p) => '£' + (Math.floor(Math.abs(p) / 100)).toLocaleString('en-GB') + '.' + String(Math.abs(p) % 100).padStart(2, '0');

    const tileSales = norm(await tid(page, 'tile-total-sales').innerText());
    expect(tileSales, `total sales must equal the live documents (${sales}p)`).toContain(gbp(sales));
    const tileOrders = norm(await tid(page, 'tile-orders').innerText());
    expect(tileOrders).toMatch(new RegExp(`\\b${liveInRange.length}\\b`));
    expect(tileOrders, 'the Orders tile is noted "excludes cancelled"').toContain('excludes cancelled');
    expect(norm(await tid(page, 'tile-items').innerText())).toMatch(new RegExp(`\\b${items}\\b`));
    await expect(tid(page, 'tile-best-day')).toBeVisible();
    await expect(tid(page, 'tile-avg-day')).toBeVisible();

    await expect(tid(page, 'days-chart')).toBeVisible();
    await expect(tid(page, 'days-table')).toBeVisible();
    await expect(tid(page, 'items-by-day-table')).toBeVisible();
    await expect(tid(page, 'days-totals-row')).toBeVisible();

    const bars = page.locator('[data-testid^="day-bar-"]');
    expect(await bars.count(), 'one bar per trading day in range').toBe(expectedDays.length);
    for (const day of expectedDays) {
      await expect(tid(page, `day-row-${day}`), `${day} traded and needs a row`).toBeVisible();
      await expect(tid(page, `day-bar-${day}`)).toBeVisible();
      const bar = tid(page, `day-bar-${day}`);
      expect(await bar.evaluate((el) => el.tagName.toLowerCase()), 'each bar is a real <button>').toBe('button');
      expect(await bar.getAttribute('aria-label'), `bar ${day} needs an aria-label`).toBeTruthy();
    }

    // The readout answers a bar.
    await tid(page, 'days-chart').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await tid(page, `day-bar-${expectedDays[expectedDays.length - 1]}`).hover();
    await page.waitForTimeout(400);
    const readout = norm(await tid(page, 'days-readout').innerText());
    expect(readout, 'the readout format from design/ReportsByDay.dc.html')
      .toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} · £[\d,]+\.\d{2} · \d+ orders?$/);
    record(`P3L-05 ${info.project.name} trading days in range [${expectedDays.join(', ')}]; ` +
      `tiles sales=${gbp(sales)} orders=${liveInRange.length} items=${items}; readout "${readout}"`);
  }

  await shot(page, `${info.project.name}-reports-days`);
  expect(realErrors(errors), 'console errors on the live Sales by day screen').toEqual([]);
});

/* ---------------------------------------------------------------- P3L-06 */

test('P3L-06 "Open day" navigates to #/reports?day=… with that date loaded', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  await disableCache(page);
  await signInLive(page);

  await page.goto(LIVE + '#/reports/days', { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'range-from')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);

  const links = page.locator('[data-testid^="open-day-"]');
  const count = await links.count();
  if (count === 0) {
    record(`P3L-06 ${info.project.name} no trading days in the default range, so no "Open day" link to follow`);
    test.skip(true, 'no trading days in the live default range');
    return;
  }

  const day = (await links.first().getAttribute('data-testid')).replace('open-day-', '');
  expect(await links.first().getAttribute('href'), 'CLAUDE.md Phase III 7').toBe(`#/reports?day=${day}`);

  // BUG-6 guard, live: the accessible name must contain the visible text.
  const visible = norm(await links.first().innerText());
  const name = norm(await links.first().getAttribute('aria-label')) || visible;
  expect(name.toLowerCase().includes(visible.toLowerCase()),
    `WCAG 2.5.3: "Open day" is named "${name}", which does not contain its visible text`).toBe(true);

  await links.first().click();
  await page.waitForTimeout(2500);
  expect(page.url()).toContain(`#/reports?day=${day}`);
  await expect(tid(page, 'report-date')).toBeVisible({ timeout: 30000 });
  expect(await tid(page, 'report-date').inputValue(), 'the One day report opens on that date').toBe(day);

  // And the figures agree with the live documents for that day.
  const dayOrders = (ORDERS_BEFORE || []).filter((o) => o.day === day && o.status !== 'cancelled');
  const sales = dayOrders.reduce((a, o) => a + (Number(o.total) || 0), 0);
  const gbp = (p) => '£' + (Math.floor(Math.abs(p) / 100)).toLocaleString('en-GB') + '.' + String(Math.abs(p) % 100).padStart(2, '0');
  await expect(tid(page, 'kpi-sales'), `${day} total sales must match the live documents`)
    .toHaveText(gbp(sales), { timeout: 20000 });
  await expect(tid(page, 'kpi-orders')).toHaveText(String(dayOrders.length));
  record(`P3L-06 ${info.project.name} Open day -> #/reports?day=${day}; sales ${gbp(sales)} over ${dayOrders.length} order(s)`);
  await shot(page, `${info.project.name}-reports-open-day`);
});

/* ---------------------------------------------------------------- P3L-07 */

test('P3L-07 the range CSV downloads with the right name and the One day columns', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  await disableCache(page);
  await signInLive(page);

  await page.goto(LIVE + '#/reports/days', { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'range-from')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);

  const from = await tid(page, 'range-from').inputValue();
  const to = await tid(page, 'range-to').inputValue();
  const button = tid(page, 'export-days-csv');
  await expect(button, 'CLAUDE.md Phase III 9').toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    button.click()
  ]);
  expect(download.suggestedFilename(), 'CLAUDE.md Phase III 9: nba-food-stall_<from>_<to>.csv')
    .toBe(`nba-food-stall_${from}_${to}.csv`);

  const text = readFileSync(await download.path(), 'utf8');
  const header = text.split(/\r?\n/)[0];
  expect(header, 'the range CSV has exactly the One day columns')
    .toBe('day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds,edited,cancelReason');
  expect(header, 'CLAUDE.md Phase III 10: the legacy tendered field never appears').not.toContain('tendered');
  expect(text).not.toMatch(/tendered/i);

  const rows = parseCsv(text);
  const col = (n) => rows[0].indexOf(n);
  for (const r of rows.slice(1)) {
    expect(r, `row has ${r.length} fields`).toHaveLength(15);
    expect(Number(r[col('lineTotal')])).toBe(Number(r[col('qty')]) * Number(r[col('price')]));
    expect(r[col('day')] >= from && r[col('day')] <= to, `row day ${r[col('day')]} is outside ${from}..${to}`).toBe(true);
    expect(r[col('status')], 'cancelled orders are excluded from the export').not.toBe('cancelled');
    expect(r[col('item')], 'no blank item name').not.toBe('');
  }
  record(`P3L-07 ${info.project.name} range CSV "nba-food-stall_${from}_${to}.csv": ` +
    `${rows.length - 1} data row(s), 13 columns, no tendered column`);
});

/* ---------------------------------------------------------------- P3L-08 */

test('P3L-08 Sign out returns to #/login and the version line is still there', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  await disableCache(page);
  await signInLive(page);

  await page.goto(LIVE + '#/reports/days', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('header').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);

  await (await signOutButton(page)).click();
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 20000 }).toMatch(/^#\/login/);
  expect(await page.evaluate(() => window.localStorage.getItem('nba.session')), 'Sign out clears the session').toBeNull();

  const line = tid(page, 'login-version');
  await expect(line, 'the version line is on the card after signing out too').toBeVisible({ timeout: 20000 });
  const parts = parseLine(await line.innerText());
  expect(parts.version).toBe(PKG_VERSION);
  if (EXPECTED_BUILD) expect(parts.build).toBe(EXPECTED_BUILD);
  record(`P3L-08 ${info.project.name} after sign out: "${norm(await line.innerText())}"`);
  await shot(page, `${info.project.name}-signed-out`);
});

/* ---------------------------------------------------------------- P3L-09 */

test('P3L-09 this verification wrote nothing to live Firestore', async () => {
  const after = await liveOrders();
  const days = [...new Set(after.map((o) => o.day))].sort();
  record(`P3L-09 live orders after the check: ${after.length} document(s); days [${days.join(', ')}]`);
  expect(after.length, 'the orders collection changed length during a read-only check').toBe(ORDERS_BEFORE.length);
  expect(fingerprint(after), 'the orders collection changed during a read-only check')
    .toBe(fingerprint(ORDERS_BEFORE));

  const menu = await liveRead('/menu?pageSize=50');
  const ids = (menu.documents || []).map((d) => d.name.split('/').pop()).sort();
  record(`P3L-09 live menu untouched: ${ids.length} document(s) [${ids.join(', ')}]`);
  // CLAUDE.md H3 7 reset the live menu and Phase V 7 adds `samosa_chat`, so
  // the live menu is the eight-row Menu table.
  expect(ids.length, 'the menu must still hold its eight documents').toBe(8);

  const event = await liveRead('/settings/event', { allow404: true });
  expect(!!event, 'settings/event must be exactly as it was found').toBe(!!LIVE_EVENT);
});
