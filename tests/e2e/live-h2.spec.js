// H-22 — Hotfix H2 live verification against LIVE_URL. STRICTLY READ-ONLY.
//
// Gated: skipped unless LIVE_H2=1, the same style as the S-* smoke and the
// H1 live spec, so `npm run test:e2e` stays offline and deterministic.
// Run only AFTER H2 is deployed:
//
//   LIVE_H2=1 npx playwright test tests/e2e/live-h2.spec.js
//
// WRITE DISCIPLINE. H2 permits NO write to live Firestore at all — not even
// the single exception H1 had for `scripts/menu-sync.mjs`. Nothing here
// writes: no order is placed (`send-order` is never clicked), no status is
// changed, nothing is cancelled, no menu document is touched. Every Firestore
// call in this file is a GET. Tapping a till tile mutates the in-page order
// panel only — local state that reaches Firestore solely through `send-order`
// — and the panel is cleared again afterwards. H-22.0 and H-22.3 bracket the
// run with a fingerprint of the orders collection to prove it.
//
// CREDENTIALS: read at run time from the gitignored .secrets/app-login.env by
// ./creds.js. Never written into a test file, a log line, a screenshot or
// qa/live-smoke-record.txt (all committed to a public repo). The Show/Hide
// toggle is never pressed, so the password stays masked in every screenshot.
import { test, expect } from '@playwright/test';
import {
  attachConsole, realErrors, SHOTS, loginUserField, loginPassField, loginSubmit
} from './helpers.js';
import { creds } from './creds.js';
import { resolve } from 'node:path';
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const LIVE = process.env.LIVE_URL || 'https://nottinghambengaliassociation.github.io/nba-food-stall-app/';
const C = creds();

const ACTIVE_IDS = [
  'fuchka', 'momo', 'chat', 'sweet_box',
  'samosa_only', 'choc_strawberry', 'marshmallow', 'fountain'
];
const LONGEST = 'choc_strawberry';
const SHORTEST = 'momo';
const MIN_STEPPER = 52;
const TOL = 1;
const SIZE_TOL = 0.5;

const r2 = (n) => Math.round(n * 100) / 100;
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

test.skip(!process.env.LIVE_H2, 'set LIVE_H2=1 to run the read-only H2 live check (after deploy)');
test.describe.configure({ mode: 'serial' });

// CACHE DISCIPLINE. The deployed stylesheet is served with
// `cache-control: max-age=600`, so a context that picked up the pre-fix CSS
// in the last ten minutes could measure the OLD layout against a correctly
// deployed origin and report a false failure. Three independent guards:
//   (a) every test runs in a fresh Playwright context (no profile is reused);
//   (b) the browser HTTP cache is switched off outright over CDP
//       (`Network.setCacheDisabled`) before the first navigation, so every
//       request — document, CSS and module — goes to the origin;
//   (c) H-22.2 additionally fetches the stylesheet on a cache-busted URL and
//       compares its SHA-256 with the committed file.
// A stale bundle is therefore caught, never measured.
//
// NOT used: a `Cache-Control: no-cache` request header via `extraHTTPHeaders`.
// That header is not CORS-safelisted, so Playwright would attach it to the
// cross-origin module imports of the Firebase SDK on gstatic.com and turn them
// into preflighted requests the CDN does not answer — the app then hangs on
// "Loading…". `Network.setCacheDisabled` achieves the same thing at the
// network stack without touching the request headers. (Observed on the first
// attempt of this run; see qa/bugs.md, round H2 live.)

/** Switch the browser HTTP cache off for this page (Chromium, via CDP). */
async function disableCache(page) {
  try {
    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    return true;
  } catch {
    return false;   // non-Chromium: the fresh context and H-22.2's byte check still apply
  }
}

/** The committed stylesheet, for the byte comparison in H-22.2. */
const LOCAL_CSS = resolve(SHOTS, '../../public/css/app.css');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Append one line to qa/live-smoke-record.txt. Public file: values must be safe. */
function record(line) {
  // eslint-disable-next-line no-console
  console.log(`[LIVE-H2] ${line}`);
  try { appendFileSync(resolve(SHOTS, '../live-smoke-record.txt'), line + '\n'); } catch { /* ignore */ }
}

const shot = (page, name) => page.screenshot({ path: resolve(SHOTS, `live-h2-cart-${name}.png`), fullPage: true });

/** Sign in with the shared account. Nothing here is logged; the field stays masked. */
async function signInLive(page) {
  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  await (await loginSubmit(page)).waitFor({ state: 'visible', timeout: 30000 });
  await (await loginUserField(page)).fill(C.user);
  await (await loginPassField(page)).fill(C.password);
  await (await loginSubmit(page)).click();
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 30000 }).toBe('#/');
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

/** The same single-layout-pass measurement the emulator case H-21 uses. */
async function measureCart(page, ids) {
  return page.evaluate((wanted) => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const q = (name) => document.querySelector(`[data-testid="${name}"]`);
    const rows = [];
    for (const id of wanted) {
      const row = q(`line-${id}`);
      if (!row) { rows.push({ id, missing: true }); continue; }
      const name = row.querySelector('.line__name');
      rows.push({
        id,
        text: (name ? name.textContent : '').replace(/\s+/g, ' ').trim(),
        row: rect(row),
        name: rect(name),
        nameScrollWidth: name ? name.scrollWidth : null,
        nameClientWidth: name ? name.clientWidth : null,
        dec: rect(q(`line-dec-${id}`)),
        inc: rect(q(`line-inc-${id}`)),
        containerClientWidth: row.parentElement ? row.parentElement.clientWidth : null
      });
    }
    const panel = document.querySelector('[aria-label="Current order"]') || document.querySelector('.panel');
    return {
      rows,
      panel: rect(panel),
      columns: rows.length && !rows[0].missing
        ? getComputedStyle(q(`line-${rows[0].id}`)).gridTemplateColumns : null,
      display: rows.length && !rows[0].missing
        ? getComputedStyle(q(`line-${rows[0].id}`)).display : null,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  }, ids);
}

function table(m) {
  const head = 'id              name                   row.left row.w   dec.left dec.w dec.h inc.left inc.w inc.h';
  const body = m.rows.map((r) => {
    if (r.missing) return `${r.id.padEnd(16)}MISSING`;
    const f = (v, w = 8) => String(r2(v)).padEnd(w);
    return `${r.id.padEnd(16)}${(r.text || '').slice(0, 22).padEnd(23)}${f(r.row.left)} ${f(r.row.width, 7)} ${f(r.dec.left)} ${f(r.dec.width, 5)} ${f(r.dec.height, 5)} ${f(r.inc.left)} ${f(r.inc.width, 5)} ${f(r.inc.height, 5)}`;
  });
  return [head, ...body].join('\n');
}

/* ----------------------------------------------------------------- H-22.0 */

test('H-22.0 snapshot the live orders collection before anything else', async () => {
  ORDERS_BEFORE = await liveOrders();
  record(`H-22.0 live orders before the check: ${ORDERS_BEFORE.length} document(s) ` +
    `[${ORDERS_BEFORE.map((o) => `${o.orderNo}/${o.status}/${o.day}`).sort().join(', ')}]`);
});

/* ----------------------------------------------------------------- H-22.1 */

test('H-22.1 the live cart lines up with every active item in it', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  const cacheOff = await disableCache(page);
  record(`H-22.1 ${info.project.name}: fresh browser context, HTTP cache disabled over CDP = ${cacheOff}`);
  await signInLive(page);

  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="tile-fuchka"]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-testid="tile-fountain"]')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2500);

  await expect(page.getByText(/storage not configured/i), '#/cash must be configured live').toHaveCount(0);

  // Local state only. `send-order` is never clicked, so nothing is written.
  for (let i = 0; i < ACTIVE_IDS.length; i++) {
    const tile = page.locator(`[data-testid="tile-${ACTIVE_IDS[i]}"]`);
    for (let n = 0; n <= i; n++) { await tile.click(); await page.waitForTimeout(60); }
  }
  for (const id of ACTIVE_IDS) {
    await expect(page.locator(`[data-testid="line-${id}"]`), `line-${id} must be in the live cart`)
      .toHaveCount(1, { timeout: 15000 });
  }
  await page.waitForTimeout(600);

  const m = await measureCart(page, ACTIVE_IDS);
  const report = table(m);
  record(`H-22.1 ${info.project.name} ${m.viewport.width}x${m.viewport.height} live cart geometry ` +
    `(display=${m.display}, columns=${m.columns})\n${report}`);

  // 1. the steppers share one column, row against row — never a fixed number.
  for (const key of ['dec', 'inc']) {
    const lefts = m.rows.map((r) => r[key].left);
    const spread = Math.max(...lefts) - Math.min(...lefts);
    expect(spread,
      `CLAUDE.md H2: every live row's line-${key}-* must sit at the same left x (±${TOL} px). ` +
      `Spread ${r2(spread)} px.\n\n${report}`).toBeLessThanOrEqual(TOL);
  }
  const longest = m.rows.find((r) => r.id === LONGEST);
  const shortest = m.rows.find((r) => r.id === SHORTEST);
  expect(longest.text).toBe('Chocolate Strawberry');
  expect(shortest.text).toBe('Momo');
  for (const key of ['dec', 'inc']) {
    expect(Math.abs(longest[key].left - shortest[key].left),
      `"Chocolate Strawberry" must not push its ${key === 'dec' ? '−' : '+'} button past "Momo"'s ` +
      `(${r2(longest[key].left)} vs ${r2(shortest[key].left)}).\n\n${report}`).toBeLessThanOrEqual(TOL);
  }

  // 2. nothing overflows.
  for (const r of m.rows) {
    expect(r.nameScrollWidth, `"${r.text}" overflows its column live (${r.nameScrollWidth} > ${r.nameClientWidth})\n\n${report}`)
      .toBeLessThanOrEqual(r.nameClientWidth + TOL);
    expect(r.row.width, `row line-${r.id} is wider than the panel column live\n\n${report}`)
      .toBeLessThanOrEqual(r.containerClientWidth + TOL);
    expect(r.row.right, `row line-${r.id} spills past the live panel\n\n${report}`)
      .toBeLessThanOrEqual(m.panel.right + TOL);
  }
  expect(m.docScrollWidth, 'no horizontal scroll with a full live cart')
    .toBeLessThanOrEqual(m.docClientWidth + TOL);

  // 3. the 52 px steppers are kept.
  for (const r of m.rows) {
    for (const key of ['dec', 'inc']) {
      expect(r[key].width, `line-${key}-${r.id} is ${r2(r[key].width)} px wide live, under ${MIN_STEPPER}\n\n${report}`)
        .toBeGreaterThanOrEqual(MIN_STEPPER - SIZE_TOL);
      expect(r[key].height, `line-${key}-${r.id} is ${r2(r[key].height)} px tall live, under ${MIN_STEPPER}\n\n${report}`)
        .toBeGreaterThanOrEqual(MIN_STEPPER - SIZE_TOL);
    }
  }

  await shot(page, info.project.name);
  record(`H-22.1 ${info.project.name}: screenshot qa/screenshots/live-h2-cart-${info.project.name}.png`);

  // On the phone the cart lines live in an internal scroller inside the sticky
  // bottom sheet, so a 390x844 capture shows one row and is weak evidence for
  // an alignment fix. Take a second capture at the SAME 390 px width on a
  // taller viewport, where the sheet's line area grows to hold all eight rows.
  // The width — and therefore the grid's 144 px name track — is unchanged, and
  // the alignment is re-measured and re-asserted before the shutter, so the
  // picture is verified, not just pretty.
  if (info.project.name === 'phone') {
    await page.setViewportSize({ width: 390, height: 1700 });
    await page.waitForTimeout(600);
    const tall = await measureCart(page, ACTIVE_IDS);
    expect(tall.columns, 'the taller capture must use the same 390 px-wide grid').toBe(m.columns);
    for (const key of ['dec', 'inc']) {
      const lefts = tall.rows.map((r) => r[key].left);
      expect(Math.max(...lefts) - Math.min(...lefts),
        `the ${key} column in the full-cart capture\n\n${table(tall)}`).toBeLessThanOrEqual(TOL);
    }
    record(`H-22.1 phone full-cart capture at 390x1700 (columns=${tall.columns}): ` +
      `dec.left ${r2(tall.rows[0].dec.left)} and inc.left ${r2(tall.rows[0].inc.left)} on all eight rows`);
    await shot(page, 'phone-all-lines');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
  }

  // Leave the till as we found it. Clearing the panel writes nothing.
  const clear = page.locator('[data-testid="clear-order"], button:has-text("Clear order")').first();
  if (await clear.count()) await clear.click();
  await page.waitForTimeout(500);

  // Proof that nothing was sent. The toast node is built once and only
  // shown/hidden, so assert it is not VISIBLE and holds no order number.
  const toast = page.locator('[data-testid="order-toast"]');
  await expect(toast, 'no confirmation toast may appear: nothing is sent by this check').toBeHidden();
  expect(norm(await toast.innerText().catch(() => '')), 'the toast must hold no order number')
    .not.toMatch(/[A-Z]-\d{3}/);

  const real = realErrors(errors);
  record(`H-22.1 ${info.project.name}: ${real.length} console error(s) on #/cash`);
  expect(real, `console errors on the live till:\n${real.join('\n')}`).toEqual([]);
});

/* ----------------------------------------------------------------- H-22.2 */

test('H-22.2 the deployed stylesheet really carries the fixed-column .line rule', async ({ page }) => {
  // Belt and braces: the measurement above could in principle pass on a cached
  // old bundle that happened to line up. Read the resolved computed style on
  // the deployed page and confirm it is a grid of five tracks.
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');

  // (i) the SERVED BYTES, on a cache-busted request straight to the origin.
  const bust = `${LIVE}css/app.css?cb=${Date.now()}`;
  const res = await fetch(bust, { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
  expect(res.ok, `GET ${bust} -> ${res.status}`).toBe(true);
  const served = await res.text();
  const local = readFileSync(LOCAL_CSS, 'utf8');
  record(`H-22.2 served css: ${served.length} bytes, sha256 ${sha256(served)}; ` +
    `committed public/css/app.css: ${local.length} bytes, sha256 ${sha256(local)}; ` +
    `cache-control "${res.headers.get('cache-control')}", age "${res.headers.get('age')}"`);
  expect(served, 'the served stylesheet must carry the H2 fixed-column rule')
    .toContain('grid-template-columns: minmax(0, 1fr) 52px 28px 52px 58px');
  expect(served.match(/\.line\s*\{[^}]*display:\s*flex/g) || [], 'the old flex .line rule must be gone').toEqual([]);
  expect(sha256(served), 'the origin must serve exactly the committed stylesheet').toBe(sha256(local));

  // (ii) the RESOLVED COMPUTED STYLE in the browser that just measured the cart.
  const cacheOff = await disableCache(page);
  record(`H-22.2: browser HTTP cache disabled over CDP = ${cacheOff}`);
  await signInLive(page);
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="tile-momo"]')).toBeVisible({ timeout: 30000 });
  await page.locator('[data-testid="tile-momo"]').click();           // local state only
  await expect(page.locator('[data-testid="line-momo"]')).toHaveCount(1, { timeout: 15000 });

  const style = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="line-momo"]');
    const cs = getComputedStyle(row);
    return { display: cs.display, columns: cs.gridTemplateColumns, gap: cs.columnGap };
  });
  record(`H-22.2 deployed .line computed style: display=${style.display} columns=${style.columns} column-gap=${style.gap}`);
  expect(style.display, 'CLAUDE.md H2: .line is a grid, not a flex row').toBe('grid');
  const tracks = style.columns.trim().split(/\s+/);
  expect(tracks.length, `CLAUDE.md H2: five fixed columns, got "${style.columns}"`).toBe(5);
  expect(parseFloat(tracks[1]), 'the − column is 52 px').toBeGreaterThanOrEqual(MIN_STEPPER - SIZE_TOL);
  expect(parseFloat(tracks[3]), 'the + column is 52 px').toBeGreaterThanOrEqual(MIN_STEPPER - SIZE_TOL);

  const clear = page.locator('[data-testid="clear-order"], button:has-text("Clear order")').first();
  if (await clear.count()) await clear.click();
  await expect(page.locator('[data-testid="order-toast"]')).toBeHidden();
});

/* ----------------------------------------------------------------- H-22.3 */

test('H-22.3 this check wrote nothing to live Firestore', async () => {
  const after = await liveOrders();
  const before = ORDERS_BEFORE || [];
  record(`H-22.3 live orders after the check: ${after.length} document(s) ` +
    `[${after.map((o) => `${o.orderNo}/${o.status}`).sort().join(', ')}]`);
  expect(after.length, 'H2 permits no live write at all: no order may be created or removed').toBe(before.length);
  expect(fingerprint(after), 'every live order must be byte-identical: ids, names, quantities, status, totals')
    .toBe(fingerprint(before));

  const menu = await liveRead('/menu?pageSize=50');
  const ids = (menu.documents || []).map((d) => d.name.split('/').pop()).sort();
  expect(ids.length, 'the menu must still hold its ten documents').toBe(10);
  record(`H-22.3 PASS: orders and menu unchanged [${ids.join(', ')}]. ` +
    `No order placed, nothing cancelled, no document written — H2 made no live write of any kind.`);
});
