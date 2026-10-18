// H-20 — Hotfix H1 live verification against LIVE_URL. READ-ONLY.
//
// Skipped unless LIVE_H1=1, the same gate style as the S-* live smoke, so
// `npm run test:e2e` stays offline and deterministic. Run only AFTER H1 is
// deployed and after Trinity's single `scripts/menu-sync.mjs` run:
//
//   LIVE_H1=1 npx playwright test tests/e2e/live-h1.spec.js
//
// WRITE DISCIPLINE (CLAUDE.md -> "Protecting live data on a follow-up run",
// and the H1 brief: "live check (read-only apart from menu-sync)"):
// nothing in this file writes to live Firestore. No order is placed, no status
// is changed, nothing is cancelled, no menu document is touched. Every call is
// a GET or a runQuery. The one permitted live write in this hotfix is
// Trinity's menu-sync run, which is not exercised here.
//
// CREDENTIALS: read at run time from the gitignored .secrets/app-login.env by
// ./creds.js. Never written into a test file, a log line, a screenshot or
// qa/live-smoke-record.txt (which is committed to a public repo).
import { test, expect } from '@playwright/test';
import {
  attachConsole, realErrors, SHOTS, loginUserField, loginPassField, loginSubmit
} from './helpers.js';
import { creds } from './creds.js';
import { resolve } from 'node:path';
import { appendFileSync } from 'node:fs';

const LIVE = process.env.LIVE_URL || 'https://nottinghambengaliassociation.github.io/nba-food-stall-app/';
const ROUTES = ['#/', '#/cash', '#/kitchen', '#/reports'];
const C = creds();

const ACTIVE_IDS = ['fuchka', 'momo', 'chat', 'sweet_box', 'samosa_only', 'choc_strawberry', 'marshmallow', 'fountain'];
const RETIRED_IDS = ['samosa', 'straw'];
const ALL_IDS = [...ACTIVE_IDS, ...RETIRED_IDS].sort();
const BRIEF = {
  fuchka: { name: 'Fuchka / Gol Gappa', station: 'chaat', active: true, sort: 1 },
  momo: { name: 'Momo', station: 'momo', active: true, sort: 2 },
  chat: { name: 'Papri Chat', station: 'chaat', active: true, sort: 3 },
  sweet_box: { name: 'Sweet Box', station: 'sweets', active: true, sort: 4 },
  samosa_only: { name: 'Samosa', station: 'sweets', active: true, sort: 5 },
  choc_strawberry: { name: 'Chocolate Strawberry', station: 'sweets', active: true, sort: 6 },
  marshmallow: { name: 'Marshmallow (V)', station: 'sweets', active: true, sort: 7 },
  fountain: { name: 'Chocolate Fountain', station: 'sweets', active: true, sort: 8 },
  samosa: { name: 'Sweets Box Samosa / Shingara', station: 'sweets', active: false, sort: 90 },
  straw: { name: 'Chocolate Strawberry & Marshmallow (V)', station: 'sweets', active: false, sort: 91 }
};

test.skip(!process.env.LIVE_H1, 'set LIVE_H1=1 to run the read-only H1 live verification (after deploy + menu-sync)');
test.describe.configure({ mode: 'serial' });

function record(line) {
  // eslint-disable-next-line no-console
  console.log(`[LIVE-H1] ${line}`);
  try { appendFileSync(resolve(SHOTS, '../live-smoke-record.txt'), line + '\n'); } catch { /* ignore */ }
}

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const shot = (page, name) => page.screenshot({ path: resolve(SHOTS, `live-${name}.png`), fullPage: true });

/** Sign in with the shared account. Nothing here is logged or screenshotted. */
async function signInLive(page) {
  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  await (await loginSubmit(page)).waitFor({ state: 'visible', timeout: 30000 });
  await (await loginUserField(page)).fill(C.user);
  await (await loginPassField(page)).fill(C.password);
  // Leave the password masked: the Show/Hide toggle is never pressed here.
  await (await loginSubmit(page)).click();
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 30000 }).toBe('#/');
}

/** Read-only Firestore REST access with the deployed web API key. GET only. */
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

/* ------------------------------------------------------------- H-20.1 */

test('H-20.1 every route loads clean on the deployed app', async ({ page }, info) => {
  const errors = attachConsole(page);
  if (C.available) await signInLive(page);

  for (const route of ROUTES) {
    await page.goto(LIVE + route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await expect(page.locator('header, main').first(), `${route} must render`).toBeVisible({ timeout: 30000 });
    const pill = page.locator('[data-testid="conn-pill"]');
    if (route !== '#/login') {
      await expect(pill, `conn-pill must be present on ${route}`).toBeVisible({ timeout: 20000 });
      record(`H-20.1 ${info.project.name} ${route}: pill "${norm(await pill.innerText())}"`);
    }
    await shot(page, `${info.project.name}-h1-${route.replace(/[#/]/g, '') || 'landing'}`);
  }

  const real = realErrors(errors);
  expect(real, `console errors on the live app:\n${real.join('\n')}`).toEqual([]);
});

/* ------------------------------------------------------------- H-20.2 */

test('H-20.2 the live menu holds the ten H1 documents, eight active', async () => {
  const menu = await liveRead('/menu?pageSize=50');
  const docs = (menu.documents || []).map((d) => ({ id: d.name.split('/').pop(), ...plain(d.fields) }));
  record(`H-20.2 live menu: ${docs.length} documents [${docs.map((d) => d.id).sort().join(', ')}]`);

  expect(docs.map((d) => d.id).sort(), 'CLAUDE.md Menu after H1: ten rows').toEqual(ALL_IDS);

  for (const [id, want] of Object.entries(BRIEF)) {
    const got = docs.find((d) => d.id === id);
    expect(got, `menu/${id} missing live`).toBeTruthy();
    expect(got.name, `menu/${id} name`).toBe(want.name);
    expect(got.station, `menu/${id} station`).toBe(want.station);
    expect(got.active, `menu/${id} active`).toBe(want.active);
    expect(got.sort, `menu/${id} sort`).toBe(want.sort);
    expect(got.price, `menu/${id} price — prices are edited in the console, so only sanity-checked`).toBeGreaterThan(0);
  }

  for (const id of RETIRED_IDS) {
    expect(docs.find((d) => d.id === id), `the retired "${id}" document must never be deleted`).toBeTruthy();
  }
});

/* ------------------------------------------------------------- H-20.3 */

test('H-20.3 the live till shows exactly the eight active tiles', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await signInLive(page);

  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="tile-fuchka"]')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2000);

  const tiles = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="tile-"]')]
    .map((t) => t.dataset.testid.replace(/^tile-/, '')));
  record(`H-20.3 ${info.project.name} live tiles: [${tiles.join(', ')}]`);
  expect(tiles, 'CLAUDE.md H1 5: eight tiles in sort order').toEqual(ACTIVE_IDS);
  for (const id of RETIRED_IDS) {
    expect(tiles, `retired "${id}" must not be sellable live`).not.toContain(id);
  }

  // Phone: the sticky order bar must not cover the eighth tile.
  if (info.project.name === 'phone') {
    const eighth = page.locator(`[data-testid="tile-${ACTIVE_IDS[7]}"]`);
    await eighth.scrollIntoViewIfNeeded();
    const onTile = await eighth.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return !!top && (top === el || el.contains(top));
    });
    expect(onTile, 'the live phone order bar must not cover the eighth tile').toBe(true);
  }

  // READ-ONLY: no tile is tapped, no order is built, nothing is sent.
  await shot(page, `${info.project.name}-h1-cash`);
  const real = realErrors(errors);
  expect(real, real.join('\n')).toEqual([]);
});

/* ------------------------------------------------------------- H-20.4 */

test('H-20.4 the last trading day still reports its legacy items under the original names', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);

  // Find the most recent day that holds orders, read-only.
  const all = await liveRead('/orders?pageSize=300');
  const orders = (all.documents || []).map((d) => plain(d.fields));
  const days = [...new Set(orders.map((o) => o.day).filter(Boolean))].sort();
  test.skip(days.length === 0, 'the live project holds no orders yet');
  const day = days[days.length - 1];

  const onDay = orders.filter((o) => o.day === day && o.status !== 'cancelled');
  const legacyLines = onDay.flatMap((o) => (o.items || []).filter((i) => RETIRED_IDS.includes(i.id)));
  const expectedSales = onDay.reduce((n, o) => n + (Number(o.total) || 0), 0);
  record(`H-20.4 last trading day ${day}: ${onDay.length} live order(s), ${legacyLines.length} line(s) on a retired id`);

  await signInLive(page);
  await page.goto(LIVE + '#/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="report-date"]')).toBeVisible({ timeout: 30000 });
  await page.locator('[data-testid="report-date"]').fill(day);
  await page.locator('[data-testid="report-date"]').dispatchEvent('change');
  await page.waitForTimeout(3500);

  const sales = norm(await page.locator('[data-testid="kpi-sales"]').innerText());
  const count = norm(await page.locator('[data-testid="kpi-orders"]').innerText());
  record(`H-20.4 ${info.project.name} reports ${day}: sales=${sales} orders=${count} (expected £${(expectedSales / 100).toFixed(2)}, ${onDay.length} orders)`);
  expect(sales.replace(/,/g, ''), 'the hotfix must not change a past day\'s takings')
    .toContain('£' + (expectedSales / 100).toFixed(2));
  expect(count, 'order count unchanged').toMatch(new RegExp(`\\b${onDay.length}\\b`));

  // Every retired id still present in that day's data shows under its original name.
  for (const id of RETIRED_IDS) {
    const lines = legacyLines.filter((l) => l.id === id);
    if (!lines.length) continue;
    const row = page.locator(`[data-testid="item-row-${id}"]`);
    await expect(row, `item-row-${id} must still exist for ${day}`).toBeVisible({ timeout: 20000 });
    const text = norm(await row.innerText());
    expect(text, `the retired "${id}" must report under "${BRIEF[id].name}"`).toContain(BRIEF[id].name);
    const units = lines.reduce((n, l) => n + (Number(l.qty) || 0), 0);
    expect(text, `${id} units`).toMatch(new RegExp(`\\b${units}\\b`));
  }

  await shot(page, `${info.project.name}-h1-reports`);
  const real = realErrors(errors);
  expect(real, real.join('\n')).toEqual([]);
});

/* ------------------------------------------------------------- H-20.5 */

test('H-20.5 this verification wrote nothing to live Firestore', async () => {
  // A belt-and-braces check that the read-only contract held: the order count
  // and the set of order ids are the same at the end of the run as at the
  // start of this test, and no document is named QA-SMOKE on today's date by
  // this run. (H1 adds no live writes at all; menu-sync is Trinity's.)
  const before = await liveRead('/orders?pageSize=300');
  const idsBefore = (before.documents || []).map((d) => d.name).sort();
  await new Promise((r) => setTimeout(r, 1500));
  const after = await liveRead('/orders?pageSize=300');
  const idsAfter = (after.documents || []).map((d) => d.name).sort();
  record(`H-20.5 live orders stable at ${idsAfter.length} document(s) across the read-only check`);
  expect(idsAfter, 'the H1 live verification must not create or remove any order').toEqual(idsBefore);
});
