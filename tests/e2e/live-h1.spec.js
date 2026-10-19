// H-20 — Hotfix H1 live verification against LIVE_URL. STRICTLY READ-ONLY.
//
// Gated: skipped unless LIVE_H1=1, the same style as the S-* live smoke, so
// `npm run test:e2e` stays offline and deterministic. Run only AFTER H1 is
// deployed and after Trinity's single `scripts/menu-sync.mjs` run:
//
//   LIVE_H1=1 npx playwright test tests/e2e/live-h1.spec.js
//
// WRITE DISCIPLINE (CLAUDE.md -> "Protecting live data on a follow-up run",
// and the H1 brief: "live check (read-only apart from menu-sync)").
// Nothing here writes to live Firestore:
//   * no order is placed — `send-order` is never clicked, and H-20.6 proves
//     the orders collection is byte-identical before and after the run;
//   * no status is changed, nothing is cancelled, no menu document is touched;
//   * every Firestore call in this file is a GET.
// Tapping a till tile (H-20.3) mutates the in-page order panel only; it is
// local state and reaches Firestore solely via `send-order`, which is never
// pressed. The panel is cleared again straight afterwards.
// The one permitted live write in this hotfix was Trinity's menu-sync run.
//
// CREDENTIALS: read at run time from the gitignored .secrets/app-login.env by
// ./creds.js. Never written into a test file, a log line, a screenshot or
// qa/live-smoke-record.txt (all of which are committed to a public repo). The
// Show/Hide toggle is never pressed, so the password stays masked in every
// screenshot.
import { test, expect } from '@playwright/test';
import {
  attachConsole, realErrors, SHOTS, loginUserField, loginPassField, loginSubmit, parseCsv
} from './helpers.js';
import { creds } from './creds.js';
import { resolve } from 'node:path';
import { appendFileSync, readFileSync } from 'node:fs';

const LIVE = process.env.LIVE_URL || 'https://nottinghambengaliassociation.github.io/nba-food-stall-app/';
const ROUTES = ['#/', '#/cash', '#/kitchen', '#/reports'];
const C = creds();

const ACTIVE_IDS = ['fuchka', 'momo', 'chat', 'sweet_box', 'samosa_only', 'choc_strawberry', 'marshmallow', 'fountain'];
const RETIRED_IDS = ['samosa', 'straw'];
const ALL_IDS = [...ACTIVE_IDS, ...RETIRED_IDS].sort();

/** CLAUDE.md -> Menu, the ten-row table. */
const BRIEF = {
  fuchka: { name: 'Fuchka / Gol Gappa', short: 'Fuchka', station: 'chaat', active: true, sort: 1 },
  momo: { name: 'Momo', short: 'Momo', station: 'momo', active: true, sort: 2 },
  chat: { name: 'Papri Chat', short: 'Papri Chat', station: 'chaat', active: true, sort: 3 },
  sweet_box: { name: 'Sweet Box', short: 'Sweet Box', station: 'sweets', active: true, sort: 4 },
  samosa_only: { name: 'Samosa', short: 'Samosa', station: 'sweets', active: true, sort: 5 },
  choc_strawberry: { name: 'Chocolate Strawberry', short: 'Choc Strawberry', station: 'sweets', active: true, sort: 6 },
  marshmallow: { name: 'Marshmallow (V)', short: 'Marshmallow', station: 'sweets', active: true, sort: 7 },
  fountain: { name: 'Chocolate Fountain', short: 'Choc Fountain', station: 'sweets', active: true, sort: 8 },
  samosa: { name: 'Sweets Box Samosa / Shingara', short: 'Sweets Box', station: 'sweets', active: false, sort: 90 },
  straw: { name: 'Chocolate Strawberry & Marshmallow (V)', short: 'Choc Strawberry', station: 'sweets', active: false, sort: 91 }
};

test.skip(!process.env.LIVE_H1, 'set LIVE_H1=1 to run the read-only H1 live verification (after deploy + menu-sync)');
test.describe.configure({ mode: 'serial' });

/** Append one line to qa/live-smoke-record.txt. Public file: values must be safe. */
function record(line) {
  // eslint-disable-next-line no-console
  console.log(`[LIVE-H1] ${line}`);
  try { appendFileSync(resolve(SHOTS, '../live-smoke-record.txt'), line + '\n'); } catch { /* ignore */ }
}

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const shot = (page, name) => page.screenshot({ path: resolve(SHOTS, `live-h1-${name}.png`), fullPage: true });

/** Sign in with the shared account. Nothing here is logged; the field stays masked. */
async function signInLive(page) {
  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  await (await loginSubmit(page)).waitFor({ state: 'visible', timeout: 30000 });
  await (await loginUserField(page)).fill(C.user);
  await (await loginPassField(page)).fill(C.password);
  await (await loginSubmit(page)).click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash), { timeout: 30000 })
    .toBe('#/');
}

/**
 * Read-only Firestore REST access with the web API key the deployed app
 * already hands to every browser. GET only — this helper cannot write.
 * The key is held in a local variable and is never recorded or printed.
 */
async function liveRead(path) {
  const cfg = await (await fetch(LIVE + 'js/firebase-config.js')).text();
  const apiKey = (cfg.match(/apiKey:\s*["']([^"']+)["']/) || [])[1];
  const projectId = (cfg.match(/projectId:\s*["']([^"']+)["']/) || [])[1];
  if (!apiKey || !projectId) throw new Error('could not read the deployed firebase config');
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents${path}`
    + `${path.includes('?') ? '&' : '?'}key=${apiKey}`;
  const res = await fetch(url);
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

/** Every live order, read-only. */
async function liveOrders() {
  const all = await liveRead('/orders?pageSize=300');
  return (all.documents || []).map((d) => ({ _id: d.name.split('/').pop(), ...plain(d.fields) }));
}

/** A stable fingerprint of the orders collection, for the no-write proof. */
const fingerprint = (orders) => JSON.stringify(
  orders
    .map((o) => ({
      id: o._id, orderNo: o.orderNo, status: o.status, total: o.total, day: o.day,
      items: (o.items || []).map((i) => `${i.id}|${i.name}|${i.qty}|${i.price}`)
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
);

let ORDERS_BEFORE = null;

/* ----------------------------------------------------------------- H-20.0 */

test('H-20.0 snapshot the live orders collection before anything else', async () => {
  ORDERS_BEFORE = await liveOrders();
  record(`H-20.0 live orders before the check: ${ORDERS_BEFORE.length} document(s) ` +
    `[${ORDERS_BEFORE.map((o) => `${o.orderNo}/${o.status}/${o.day}`).sort().join(', ')}]`);
  expect(ORDERS_BEFORE.length, 'the live project must hold the trading records to verify against').toBeGreaterThan(0);
});

/* ----------------------------------------------------------------- H-20.1 */

test('H-20.1 every route loads clean on the deployed app, pill Online, login works', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);

  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  await (await loginSubmit(page)).waitFor({ state: 'visible', timeout: 30000 });
  await expect(page.getByText(/login not configured/i), 'login-config.js must be real on the live site').toHaveCount(0);
  await shot(page, `${info.project.name}-login`);

  await signInLive(page);
  record(`H-20.1 ${info.project.name}: signed in with the shared account, landed on #/`);

  for (const route of ROUTES) {
    await page.goto(LIVE + route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header').first(), `${route} must render`).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    await expect(page.getByText(/storage not configured/i), `${route}: firebase-config.js must be real`).toHaveCount(0);

    const pill = page.locator('[data-testid="conn-pill"]');
    await expect(pill, `conn-pill must be present on ${route}`).toBeVisible({ timeout: 20000 });
    const pillText = norm(await pill.innerText());
    record(`H-20.1 ${info.project.name} ${route}: pill "${pillText}"`);
    expect(pillText, `the pill must read Online on ${route}`).toMatch(/online/i);

    await shot(page, `${info.project.name}-${route.replace(/[#/]/g, '') || 'landing'}`);
  }

  const real = realErrors(errors);
  record(`H-20.1 ${info.project.name}: ${real.length} console error(s) across ${ROUTES.length} routes`);
  expect(real, `console errors on the live app:\n${real.join('\n')}`).toEqual([]);
});

/* ----------------------------------------------------------------- H-20.2 */

test('H-20.2 the live menu holds the ten H1 documents, eight active', async () => {
  const menu = await liveRead('/menu?pageSize=50');
  const docs = (menu.documents || []).map((d) => ({ id: d.name.split('/').pop(), ...plain(d.fields) }));
  record(`H-20.2 live menu: ${docs.length} document(s) [${docs.map((d) => d.id).sort().join(', ')}]`);

  expect(docs.map((d) => d.id).sort(), 'CLAUDE.md Menu after H1: ten rows').toEqual(ALL_IDS);

  // Identity, station and the active flag are what the app and the reports
  // depend on; they are asserted hard for all ten.
  for (const [id, want] of Object.entries(BRIEF)) {
    const got = docs.find((d) => d.id === id);
    expect(got, `menu/${id} is missing live`).toBeTruthy();
    expect(got.name, `menu/${id} name`).toBe(want.name);
    expect(got.short, `menu/${id} short`).toBe(want.short);
    expect(got.station, `menu/${id} station`).toBe(want.station);
    expect(got.active, `menu/${id} active`).toBe(want.active);
    expect(Number(got.price), `menu/${id} price — prices are edited in the console, so only sanity-checked`).toBeGreaterThan(0);
  }

  // Tile order on the till is the active rows' sort, and it must be 1..8.
  const activeSorts = docs.filter((d) => d.active === true)
    .sort((a, b) => a.sort - b.sort);
  expect(activeSorts.map((d) => d.id), 'the eight active rows in sort order').toEqual(ACTIVE_IDS);
  expect(activeSorts.map((d) => d.sort), 'active sorts must be 1..8').toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

  for (const id of RETIRED_IDS) {
    expect(docs.find((d) => d.id === id), `the retired "${id}" document must never be deleted`).toBeTruthy();
  }

  // The retired rows' `sort` is reported, not enforced: CLAUDE.md H1 4 tells
  // menu-sync to "never overwrite a field that already has a different value
  // ... report differences instead", so a retired row that predates the
  // hotfix legitimately keeps the sort it was created with. It is inactive, so
  // it is never a tile. Any difference from the brief is recorded for Trinity.
  for (const id of RETIRED_IDS) {
    const got = docs.find((d) => d.id === id);
    if (got.sort !== BRIEF[id].sort) {
      record(`H-20.2 DIFFERENCE (not a failure): retired menu/${id} has sort ${got.sort}; ` +
        `the CLAUDE.md table says ${BRIEF[id].sort}. menu-sync is told not to overwrite an existing value. ` +
        `No effect on the till (inactive) or on reporting (grouped by id).`);
    }
  }
});

/* ----------------------------------------------------------------- H-20.3 */

test('H-20.3 the live till shows exactly the eight active tiles, and the eighth takes a tap', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await signInLive(page);

  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="tile-fuchka"]')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2500);

  const tiles = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="tile-"]')]
    .map((t) => t.dataset.testid.replace(/^tile-/, '')));
  record(`H-20.3 ${info.project.name} live tiles (${tiles.length}): [${tiles.join(', ')}]`);
  expect(tiles, 'CLAUDE.md H1 5: exactly eight tiles, in menu sort order').toEqual(ACTIVE_IDS);
  for (const id of RETIRED_IDS) {
    expect(tiles, `retired "${id}" must not be sellable live`).not.toContain(id);
  }
  await shot(page, `${info.project.name}-cash-eight-tiles`);

  // Put items in the panel so the sticky bottom order bar is at its tallest.
  // Local state only: `send-order` is never clicked, so nothing is written.
  await page.locator('[data-testid="tile-fuchka"]').click();
  await page.locator('[data-testid="tile-fuchka"]').click();
  await page.locator('[data-testid="customer-name"]').fill('DO-NOT-SEND');
  await page.waitForTimeout(600);

  // Every tile must answer its own centre, with the bar at full height.
  for (const id of ACTIVE_IDS) {
    const tile = page.locator(`[data-testid="tile-${id}"]`);
    await tile.scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
    const hit = await tile.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(x, y);
      const describe = (n) => {
        if (!n) return 'nothing';
        const bits = [n.tagName.toLowerCase()];
        if (n.dataset && n.dataset.testid) bits.push(`[testid=${n.dataset.testid}]`);
        if (n.className && typeof n.className === 'string') bits.push('.' + n.className.trim().split(/\s+/).join('.'));
        return bits.join('');
      };
      return {
        onTile: !!top && (top === el || el.contains(top)),
        inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
        x, y, rect: { top: Math.round(r.top), bottom: Math.round(r.bottom) }, at: describe(top)
      };
    });
    expect(hit.inViewport, `tile-${id} could not be scrolled fully into the live ${info.project.name} viewport: ${JSON.stringify(hit.rect)}`).toBe(true);
    expect(hit.onTile,
      `CLAUDE.md H1 5: the bottom order bar must not cover a tile. At the centre of tile-${id} ` +
      `(${hit.x},${hit.y}) the element is ${hit.at}, not the tile.`).toBe(true);
  }

  // Coordinate click on the EIGHTH tile, then assert the badge moved — the
  // same proof as the emulator H-09. A tap landing on the bar would not move it.
  const eighthId = ACTIVE_IDS[7];
  const eighth = page.locator(`[data-testid="tile-${eighthId}"]`);
  await eighth.scrollIntoViewIfNeeded();
  const before = Number(norm(await page.locator(`[data-testid="qty-${eighthId}"]`).innerText().catch(() => '0')) || 0);
  const box = await eighth.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(
    page.locator(`[data-testid="qty-${eighthId}"]`),
    `a coordinate tap at the centre of the eighth live tile (${eighthId}) must add one, not land on the order bar`
  ).toHaveText(new RegExp(`\\b${before + 1}\\b`), { timeout: 8000 });
  record(`H-20.3 ${info.project.name}: coordinate tap at the centre of tile-${eighthId} moved its badge ${before} -> ${before + 1} (order bar at full height)`);
  await shot(page, `${info.project.name}-cash-eighth-tile-tapped`);

  // Leave the till as we found it. The panel is local state; clearing it
  // writes nothing. `send-order` was never clicked.
  const clear = page.locator('[data-testid="clear-order"], button:has-text("Clear order")').first();
  if (await clear.count()) await clear.click();
  await page.waitForTimeout(500);

  // Proof that nothing was sent. `order-toast` is built once and merely
  // shown/hidden, so its presence in the DOM means nothing — assert that it is
  // not VISIBLE and carries no order number, then confirm against live
  // Firestore that the orders collection is exactly as it was.
  const toast = page.locator('[data-testid="order-toast"]');
  await expect(toast, 'no confirmation toast may appear: nothing is sent by this check').toBeHidden();
  expect(norm(await toast.innerText().catch(() => '')), 'the toast must hold no order number')
    .not.toMatch(/[A-Z]-\d{3}/);

  const stillThere = await liveOrders();
  expect(stillThere.length, 'tapping tiles must not create a live order').toBe((ORDERS_BEFORE || stillThere).length);
  expect(fingerprint(stillThere), 'the live orders collection must be unchanged by the till check')
    .toBe(fingerprint(ORDERS_BEFORE || stillThere));
  record(`H-20.3 ${info.project.name}: panel cleared, no toast, live orders still ${stillThere.length} document(s) — nothing written`);

  const real = realErrors(errors);
  expect(real, real.join('\n')).toEqual([]);
});

/* ----------------------------------------------------------------- H-20.4 */

test('H-20.4 the trading day still reports its legacy items under the original names', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);

  const orders = ORDERS_BEFORE || await liveOrders();
  const days = [...new Set(orders.map((o) => o.day).filter(Boolean))].sort();
  test.skip(days.length === 0, 'the live project holds no orders');
  const day = days[days.length - 1];

  const onDay = orders.filter((o) => o.day === day && o.status !== 'cancelled');
  const expectedSales = onDay.reduce((n, o) => n + (Number(o.total) || 0), 0);
  const expectedItems = onDay.reduce((n, o) => n + (o.items || []).reduce((m, i) => m + (Number(i.qty) || 0), 0), 0);

  // Units per menu id, straight from the live documents.
  const units = {};
  const storedName = {};
  for (const o of onDay) {
    for (const i of (o.items || [])) {
      units[i.id] = (units[i.id] || 0) + (Number(i.qty) || 0);
      if (i.name) storedName[i.id] = i.name;
    }
  }
  const legacyPresent = RETIRED_IDS.filter((id) => units[id]);
  record(`H-20.4 trading day ${day}: ${onDay.length} live order(s) [${onDay.map((o) => o.orderNo).sort().join(', ')}], ` +
    `${expectedItems} item(s), £${(expectedSales / 100).toFixed(2)}; ids ${Object.keys(units).sort().join(', ')}; ` +
    `retired ids present: ${legacyPresent.join(', ') || 'none'}`);
  expect(legacyPresent.length, 'the live day under test must contain at least one retired id, or it proves nothing').toBeGreaterThan(0);

  await signInLive(page);
  await page.goto(LIVE + '#/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="report-date"]')).toBeVisible({ timeout: 30000 });
  await page.locator('[data-testid="report-date"]').fill(day);
  await page.locator('[data-testid="report-date"]').dispatchEvent('change');
  await page.waitForTimeout(4000);

  const sales = norm(await page.locator('[data-testid="kpi-sales"]').innerText());
  const count = norm(await page.locator('[data-testid="kpi-orders"]').innerText());
  const items = norm(await page.locator('[data-testid="kpi-items"]').innerText());
  record(`H-20.4 ${info.project.name} reports ${day}: sales=${sales} orders=${count} items=${items} ` +
    `(expected £${(expectedSales / 100).toFixed(2)}, ${onDay.length} orders, ${expectedItems} items)`);
  expect(sales.replace(/,/g, ''), 'the hotfix must not change a past day\'s takings')
    .toContain('£' + (expectedSales / 100).toFixed(2));
  expect(count, 'order count unchanged').toMatch(new RegExp(`\\b${onDay.length}\\b`));
  expect(items, 'items sold unchanged').toMatch(new RegExp(`\\b${expectedItems}\\b`));

  // Every id that actually traded must have its own row, named as stored.
  for (const [id, qty] of Object.entries(units)) {
    const row = page.locator(`[data-testid="item-row-${id}"]`);
    await expect(row, `item-row-${id} must exist for ${day}`).toBeVisible({ timeout: 20000 });
    const text = norm(await row.innerText());
    const want = storedName[id] || BRIEF[id].name;
    expect(text, `"${id}" must report under "${want}", not as unknown or blank`).toContain(want);
    expect(text, `"${id}" units`).toMatch(new RegExp(`\\b${qty}\\b`));
    expect(text, `"${id}" row must not be blank or a placeholder`).not.toMatch(/unknown|undefined|\[object/i);
    record(`H-20.4 ${info.project.name} item-row-${id}: "${want}" x${qty} — OK`);
  }

  // Spelled out for the two retired ids, the whole point of the hotfix check.
  for (const id of legacyPresent) {
    const text = norm(await page.locator(`[data-testid="item-row-${id}"]`).innerText());
    expect(text, `the retired "${id}" must keep its ORIGINAL name`).toContain(BRIEF[id].name);
  }
  if (units.samosa && units.samosa_only === undefined) {
    const t = norm(await page.locator('[data-testid="item-row-samosa"]').innerText());
    expect(t, 'the 2026-10-18 combined item must not be relabelled "Samosa"').toContain('Sweets Box Samosa / Shingara');
  }

  await shot(page, `${info.project.name}-reports-${day}`);
  const real = realErrors(errors);
  expect(real, real.join('\n')).toEqual([]);
});

/* ----------------------------------------------------------------- H-20.5 */

test('H-20.5 the CSV export for that day carries the original names', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');

  const orders = ORDERS_BEFORE || await liveOrders();
  const days = [...new Set(orders.map((o) => o.day).filter(Boolean))].sort();
  test.skip(days.length === 0, 'the live project holds no orders');
  const day = days[days.length - 1];
  const onDay = orders.filter((o) => o.day === day && o.status !== 'cancelled');
  const lineCount = onDay.reduce((n, o) => n + (o.items || []).length, 0);

  await signInLive(page);
  await page.goto(LIVE + '#/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="report-date"]')).toBeVisible({ timeout: 30000 });
  await page.locator('[data-testid="report-date"]').fill(day);
  await page.locator('[data-testid="report-date"]').dispatchEvent('change');
  await page.waitForTimeout(4000);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('[data-testid="export-csv"]').click()
  ]);
  const text = readFileSync(await download.path(), 'utf8');
  const rows = parseCsv(text);
  const col = (n) => rows[0].indexOf(n);
  const body = rows.slice(1);

  expect(rows[0], 'CLAUDE.md Reports 6 fixes the column list').toEqual([
    'day', 'orderNo', 'till', 'name', 'item', 'qty', 'price',
    'lineTotal', 'payment', 'status', 'createdAt', 'readyAt', 'waitSeconds'
  ]);
  expect(body.length, 'one row per order line').toBe(lineCount);

  const exported = body.map((r) => r[col('item')]);
  record(`H-20.5 ${info.project.name} CSV for ${day}: ${body.length} row(s), items [${exported.join(' | ')}]`);

  for (const o of onDay) {
    for (const i of (o.items || [])) {
      const want = i.name || BRIEF[i.id].name;
      expect(exported, `the CSV must export "${i.id}" as "${want}"`).toContain(want);
    }
  }
  for (const id of RETIRED_IDS) {
    if (onDay.some((o) => (o.items || []).some((i) => i.id === id))) {
      expect(exported, `the retired "${id}" must export under its ORIGINAL name`).toContain(BRIEF[id].name);
    }
  }
  for (const r of body) {
    expect(r, `row has ${r.length} fields`).toHaveLength(13);
    expect(r[col('day')]).toBe(day);
    expect(r[col('item')], 'no blank item name in the export').not.toBe('');
  }
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
});

/* ----------------------------------------------------------------- H-20.6 */

test('H-20.6 this verification wrote nothing to live Firestore', async () => {
  const after = await liveOrders();
  const before = ORDERS_BEFORE || [];
  record(`H-20.6 live orders after the check: ${after.length} document(s) ` +
    `[${after.map((o) => `${o.orderNo}/${o.status}`).sort().join(', ')}]`);
  expect(after.length, 'no order may be created or removed by this check').toBe(before.length);
  expect(fingerprint(after), 'every live order must be byte-identical: ids, names, quantities, status, totals')
    .toBe(fingerprint(before));

  const menu = await liveRead('/menu?pageSize=50');
  expect((menu.documents || []).length, 'the menu must still hold its ten documents').toBe(10);
  record('H-20.6 PASS: orders and menu unchanged. No order placed, nothing cancelled, no document written.');
});
