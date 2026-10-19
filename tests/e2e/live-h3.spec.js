/**
 * H3L-* — Hotfix H3 (v1.3.1) live verification against LIVE_URL.
 * STRICTLY READ-ONLY.
 *
 * Gated: skipped unless LIVE_H3=1, the same style as the other live specs, so
 * `npm run test:e2e` stays offline and deterministic. Run with:
 *
 *   LIVE_H3=1 npx playwright test tests/e2e/live-h3.spec.js --project=iphone13 --project=iphone17
 *
 * WRITE DISCIPLINE. The live reset has just emptied `orders`; the next thing
 * written there must be a real sale. Nothing in this file writes: no order is
 * placed (`send-order` is never clicked), no status is changed, nothing is
 * cancelled, no menu or settings document is touched. Tapping a till tile
 * mutates the in-page cart only — local state that reaches Firestore solely
 * through Send — and the cart is emptied again before leaving the screen.
 * H3L-00 and H3L-10 bracket the run with a count and a fingerprint of the
 * orders collection to prove it.
 *
 * CREDENTIALS: read at run time from the gitignored .secrets/app-login.env by
 * ./creds.js. Never written into a test file, a log line, a screenshot or
 * qa/live-smoke-record.txt (all committed to a public repo). The Show/Hide
 * toggle is never pressed, so the password stays masked in every capture.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROOT, SHOTS, attachConsole, realErrors,
  loginUserField, loginPassField, loginSubmit, londonDay, londonDayOffset,
  isSmallCash
} from './helpers.js';
import { creds } from './creds.js';

const LIVE = process.env.LIVE_URL || 'https://nottinghambengaliassociation.github.io/nba-food-stall-app/';
const C = creds();
const PKG_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;

/** True when semver string `a` is the same as or newer than `b`. */
function atLeast(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** CLAUDE.md -> Menu after H3: seven items, in sort order. */
const MENU_IDS = ['fuchka', 'momo', 'chat', 'sweet_box', 'samosa_only', 'choc_strawberry', 'marshmallow'];
const SHORTS = {
  fuchka: 'Fuchka', momo: 'Momo', chat: 'Papri Chat', sweet_box: 'Sweet Box',
  samosa_only: 'Samosa', choc_strawberry: 'Choc Strawberry', marshmallow: 'Choc Marshmallow'
};
/** Deleted by the H3 reset. Their wording must be nowhere on the till. */
const GONE_IDS = ['fountain', 'samosa', 'straw'];
const GONE_WORDS = [/Chocolate Fountain/i, /Choc Fountain/i, /Sweets Box Samosa/i, /Chocolate Strawberry & Marshmallow/i];

const ROUTES = [
  ['landing', '#/'],
  ['cash', '#/cash'],
  ['kitchen', '#/kitchen'],
  ['reports', '#/reports'],
  ['reports-days', '#/reports/days'],
  ['reports-orders', '#/reports/orders']
];

// scripts/write-version.mjs: a 7-character commit SHA in CI, never "-dirty".
const CLEAN_BUILD = /^[0-9a-f]{7}$/;
const DATE_SHAPE = /^\d{1,2} [A-Z][a-z]{2} \d{4}$/;

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const r2 = (n) => Math.round(n * 100) / 100;
const tid = (page, name) => page.locator(`[data-testid="${name}"]`);

test.skip(!process.env.LIVE_H3, 'set LIVE_H3=1 to run the read-only H3 live check (after deploy + reset-live)');
test.describe.configure({ mode: 'serial' });

/** Append one line to qa/live-smoke-record.txt. Only ever safe values. */
function record(line) {
  // eslint-disable-next-line no-console
  console.log(`[LIVE-H3] ${line}`);
  try { appendFileSync(resolve(SHOTS, '../live-smoke-record.txt'), line + '\n'); } catch { /* ignore */ }
}

const shot = (page, name, full = true) =>
  page.screenshot({ path: resolve(SHOTS, `live-h3-${name}.png`), fullPage: full });

/**
 * Read the live project straight from Firestore's REST API with the web API
 * key the deployed app already serves to every browser. The key is held in a
 * local variable and is never recorded or printed. Read-only: GET only.
 */
async function liveFirestore(path) {
  const cfg = await (await fetch(LIVE + 'js/firebase-config.js')).text();
  const apiKey = (cfg.match(/apiKey:\s*["']([^"']+)["']/) || [])[1];
  const projectId = (cfg.match(/projectId:\s*["']([^"']+)["']/) || [])[1];
  if (!apiKey || !projectId) throw new Error('could not read the deployed firebase config');
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents${path}` +
    `${path.includes('?') ? '&' : '?'}key=${apiKey}`;
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
    if ('mapValue' in v) return plain(v.mapValue.fields);
    return null;
  };
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = val(v);
  return out;
}

const docIds = (body) => (body.documents || []).map((d) => d.name.split('/').pop()).sort();
const fingerprint = (orders) => JSON.stringify(
  orders.map((o) => `${o.orderNo}|${o.status}|${o.total}|${o.day}`).sort()
);

let ORDERS_BEFORE = null;

/** Sign in with the shared account. Nothing here is logged. */
async function signInLive(page) {
  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  await (await loginSubmit(page)).waitFor({ state: 'visible', timeout: 30000 });
  await (await loginUserField(page)).fill(C.user);
  await (await loginPassField(page)).fill(C.password);
  await (await loginSubmit(page)).click();
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 30000 }).toBe('#/');
}

/* ------------------------------------------------------------- H3L-00 */

test('H3L-00 the live orders collection, before anything is opened', async ({}, info) => {
  const body = await liveFirestore('/orders?pageSize=300');
  const orders = (body.documents || []).map((d) => plain(d.fields));
  ORDERS_BEFORE = orders;
  record(`H3L-00 ${info.project.name}: live orders = ${orders.length} document(s) before the check`);
  expect(orders.length,
    'CLAUDE.md H3 7: reset-live empties `orders`; the next write there must be a real sale'
  ).toBe(0);
});

/* ------------------------------------------------------------- H3L-01 */

test('H3L-01 the live menu is exactly the seven H3 documents', async ({}, info) => {
  const body = await liveFirestore('/menu?pageSize=50');
  const ids = docIds(body);
  record(`H3L-01 ${info.project.name}: live menu = ${ids.length} document(s) [${ids.join(', ')}]`);
  expect(ids, 'CLAUDE.md Menu / H3 7: exactly the seven items').toEqual([...MENU_IDS].sort());

  const byId = {};
  for (const d of body.documents || []) byId[d.name.split('/').pop()] = plain(d.fields);
  for (const id of MENU_IDS) {
    expect(byId[id].price, `${id} price`).toBe(500);
    expect(byId[id].active, `${id} active`).toBe(true);
    expect(byId[id].short, `${id} short`).toBe(SHORTS[id]);
  }
  expect(byId.marshmallow.name, 'CLAUDE.md H3 7: the marshmallow rename').toBe('Chocolate Marshmallow (V)');
  expect(byId.marshmallow.short).toBe('Choc Marshmallow');
  for (const id of GONE_IDS) {
    expect(ids, `CLAUDE.md H3 7: "${id}" was deleted and must not be back`).not.toContain(id);
  }

  const settings = await liveFirestore('/settings?pageSize=50');
  const settingIds = docIds(settings);
  record(`H3L-01 ${info.project.name}: live settings = ${settingIds.length} document(s)`);
  record(`H3L-01 ${info.project.name}: PASS - seven menu documents, marshmallow renamed, fountain/samosa/straw gone`);
});

/* ------------------------------------------------------------- H3L-02 */

test('H3L-02 the login card shows the package.json version and a clean build', async ({ page }, info) => {
  const errors = attachConsole(page);
  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  const line = tid(page, 'login-version');
  await expect(line, 'CLAUDE.md Phase III part 2, 4: a version line on the login card')
    .toBeVisible({ timeout: 30000 });

  // version.js is imported dynamically (Phase III part 2, 3), so the label is
  // painted "dev" for the moment before the module lands. Wait for it to
  // settle rather than reading the placeholder.
  await expect
    .poll(async () => norm(await line.innerText()), { timeout: 20000, message: 'the version line never resolved past "dev"' })
    .not.toMatch(/Version dev/);

  const text = norm(await line.innerText());
  const m = text.match(/^Version\s+(\S+)\s+·\s+build\s+(\S+)\s+·\s+updated\s+(.+)$/);
  expect(m, `the login version line must read "Version x.y.z · build <sha> · updated <date>"; got "${text}"`).toBeTruthy();
  const [, version, build, date] = m;
  expect(version, 'package.json is the single source of truth').toBe(PKG_VERSION);
  // CLAUDE.md H3 8 set package.json to 1.3.1, but Phase III part 2, 1 makes
  // package.json the single source of truth and every later hotfix bumps the
  // patch number (H4 -> 1.3.2). Pinning the literal 1.3.1 here contradicted
  // the line above the moment the version moved on, so this asserts the floor
  // -- the deployed build is at least the H3 release -- and lets PKG_VERSION
  // carry the exact value.
  expect(atLeast(version, '1.3.1'), `CLAUDE.md H3 8: the live build must be 1.3.1 or later; got "${version}"`).toBe(true);
  expect(build, `the deployed build must be a clean 7-character SHA, never "-dirty"; got "${build}"`).toMatch(CLEAN_BUILD);
  expect(build).not.toContain('-dirty');
  expect(date).toMatch(DATE_SHAPE);

  const title = norm(await line.getAttribute('title'));
  const aria = norm(await line.getAttribute('aria-label'));
  expect(title).toBe(`Version ${version}, build ${build}, updated ${date}`);
  expect(aria).toBe(title);

  await shot(page, `${info.project.name}-login`);
  const real = realErrors(errors);
  record(`H3L-02 ${info.project.name}: PASS - login card reads "Version ${version} · build ${build} · updated ${date}", ${real.length} console error(s)`);
  expect(real, `console errors on #/login:\n${real.join('\n')}`).toEqual([]);
});

/* ------------------------------------------------------------- H3L-03 */

test('H3L-03 signed in, every route loads with no console errors and an Online pill', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await signInLive(page);

  for (const [name, route] of ROUTES) {
    await page.goto(LIVE + route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header').first(), `${route} has no header`).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    await expect(page.locator('body'), `${route}: the storage banner must not show`)
      .not.toContainText('Storage not configured');

    const pill = tid(page, 'conn-pill');
    await expect(pill, `${route}: CLAUDE.md Cash 6 / H3 1: a connection pill`).toBeVisible();
    await expect(pill, `${route}: the pill must read Online`).toContainText(/Online/i, { timeout: 30000 });

    // The version label: in the dark header everywhere, and in the ☰ menu on
    // the small cash counter (CLAUDE.md H3 1). The ☰ header is the sub-700 px
    // layout only -- at 700 px and wider the cash counter keeps the ordinary
    // dark header with the pill (CLAUDE.md H3 preamble: "Tablet and desktop
    // (700 px and wider) are unchanged"; Phase III part 2, 5). This file used
    // to run on the small projects alone, so the width guard was missing.
    if (route === '#/cash' && isSmallCash(page)) {
      await tid(page, 'menu-button').click();
      await expect(tid(page, 'app-menu')).toBeVisible();
      const inMenu = tid(page, 'app-menu').locator('[data-testid="app-version"]');
      await expect(inMenu).toBeVisible();
      expect(norm(await inMenu.innerText()), `${route}: the ☰ version line`).toContain('v' + PKG_VERSION);
      await page.keyboard.press('Escape');
    } else {
      const label = tid(page, 'app-version');
      await expect(label, `${route}: CLAUDE.md Phase III part 2, 5`).toBeVisible();
      expect(norm(await label.innerText()), `${route}: the header label`).toBe('v' + PKG_VERSION);
      const title = norm(await label.getAttribute('title'));
      // Same reasoning as H3L-02: package.json is the single source of truth
      // (CLAUDE.md Phase III part 2, 1), so the literal version comes from
      // PKG_VERSION, not a pinned 1.3.1 that goes stale on the next hotfix.
      expect(title, `${route}: the header label needs a title`)
        .toMatch(new RegExp(`^Version ${PKG_VERSION.replace(/\./g, '\\.')}, build [0-9a-f]{7}, updated `));
      expect(title, 'the deployed build must not be dirty').not.toContain('-dirty');
    }
    record(`H3L-03 ${info.project.name}: ${route} loaded signed in, pill "${norm(await pill.innerText())}"`);
  }

  const real = realErrors(errors);
  record(`H3L-03 ${info.project.name}: ${real.length ? 'FAIL' : 'PASS'} - ${ROUTES.length} routes signed in, v${PKG_VERSION} everywhere, ${real.length} console error(s)${real.length ? ': ' + real.join(' | ') : ''}`);
  expect(real, `console errors across the signed-in routes:\n${real.join('\n')}`).toEqual([]);
});

/* ------------------------------------------------------------- H3L-04 */

test('H3L-04 seven tiles, three columns, all on screen with nothing in the cart', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await signInLive(page);
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);

  const rendered = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="tile-"]')]
    .map((t) => t.dataset.testid.replace(/^tile-/, '')));
  record(`H3L-04 ${info.project.name}: ${rendered.length} tiles [${rendered.join(', ')}]`);
  expect(rendered, 'CLAUDE.md Menu / H3 7: seven tiles, in sort order').toEqual(MENU_IDS);
  for (const id of GONE_IDS) {
    expect(await tid(page, `tile-${id}`).count(), `"${id}" was deleted and must not be a tile`).toBe(0);
  }

  const geo = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('[data-testid^="tile-"]')];
    const area = tiles[0] ? tiles[0].closest('main') || tiles[0].parentElement.parentElement : null;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      tiles: tiles.map((t) => {
        const r = t.getBoundingClientRect();
        const icon = t.querySelector('svg');
        const ir = icon ? icon.getBoundingClientRect() : null;
        const short = t.querySelector('.tile__short');
        return {
          id: t.dataset.testid.replace(/^tile-/, ''),
          top: r.top, bottom: r.bottom, left: r.left, height: r.height,
          icon: ir ? ir.width : null,
          visible: (short && getComputedStyle(short).display !== 'none' ? short.textContent : t.innerText).replace(/\s+/g, ' ').trim()
        };
      }),
      area: area ? { scrollHeight: area.scrollHeight, clientHeight: area.clientHeight } : null,
      bodyText: (document.body.innerText || '').replace(/\s+/g, ' ')
    };
  });

  // The tile geometry in CLAUDE.md H3 2 (3 columns, ~112 px tiles, 40 px
  // icons, everything above the fold at 390x664) describes the small cash
  // layout. The H3 preamble keeps "Tablet and desktop (700 px and wider)
  // unchanged", so the tablet keeps its own grid and these numbers do not
  // apply there. The menu contents above, and the short names below, do.
  if (isSmallCash(page)) {
    const lefts = [...new Set(geo.tiles.map((t) => Math.round(t.left)))].sort((a, b) => a - b);
    expect(lefts.length, `CLAUDE.md H3 2: "3 columns"; the tiles use ${lefts.length} left edges (${lefts})`).toBe(3);

    const offscreen = geo.tiles.filter((t) => t.bottom > geo.viewport.height + 1 || t.top < -1);
    expect(offscreen.map((t) => `${t.id} ${r2(t.top)}..${r2(t.bottom)}`),
      `CLAUDE.md H3 2: "All 7 tiles fit without scrolling at 390x664". At ${info.project.name} ` +
      `(${geo.viewport.width}x${geo.viewport.height}) these fall below the fold`
    ).toEqual([]);
    expect(geo.area.scrollHeight,
      `the menu area scrolls with an empty cart (scrollHeight ${geo.area.scrollHeight} > clientHeight ${geo.area.clientHeight})`
    ).toBeLessThanOrEqual(geo.area.clientHeight + 2);

    for (const t of geo.tiles) {
      expect(Math.abs(t.height - 112), `tile-${t.id} is ${r2(t.height)}px tall; H3 2 says about 112`).toBeLessThanOrEqual(16);
      expect(Math.abs(t.icon - 40), `tile-${t.id} icon is ${r2(t.icon)}px; H3 2 says 40`).toBeLessThanOrEqual(6);
    }
  }

  // CLAUDE.md H3 2 puts the `short` name on the small tile; CLAUDE.md Cash
  // counter 1 keeps the full `name` on the tablet tile. Assert whichever the
  // viewport is meant to show.
  const NAMES = {
    fuchka: 'Fuchka', momo: 'Momo', chat: 'Papri Chat', sweet_box: 'Sweet Box',
    samosa_only: 'Samosa', choc_strawberry: 'Chocolate Strawberry',
    marshmallow: 'Chocolate Marshmallow (V)'
  };
  for (const t of geo.tiles) {
    const want = isSmallCash(page) ? SHORTS[t.id] : NAMES[t.id];
    expect(t.visible, `tile-${t.id} must read "${want}"`).toContain(want);
  }

  // The seventh tile: the H3 wording on screen, the full name as its
  // accessible name (CLAUDE.md H3 7).
  const seventh = tid(page, 'tile-marshmallow');
  expect(norm(await seventh.innerText()), 'the seventh tile is the renamed marshmallow')
    .toContain(isSmallCash(page) ? 'Choc Marshmallow' : 'Chocolate Marshmallow (V)');
  const accessible = await seventh.evaluate((el) => {
    const parts = [];
    for (const n of el.querySelectorAll('span')) {
      if (n.getAttribute('aria-hidden') === 'true') continue;
      if (getComputedStyle(n).display === 'none') continue;
      parts.push((n.textContent || '').trim());
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  });
  expect(accessible, `the seventh tile's accessible name must carry the full name; it reads "${accessible}"`)
    .toContain('Chocolate Marshmallow (V)');
  record(`H3L-04 ${info.project.name}: seventh tile reads "${norm(await seventh.innerText())}", accessible name "${accessible}"`);

  // No wording from any deleted item anywhere on the screen.
  for (const re of GONE_WORDS) {
    expect(geo.bodyText, `a deleted item's wording (${re}) is still on the till`).not.toMatch(re);
  }

  await shot(page, `${info.project.name}-cash-empty`);
  const real = realErrors(errors);
  record(`H3L-04 ${info.project.name}: PASS - 7 tiles in 3 columns, all inside ${geo.viewport.width}x${geo.viewport.height}, menu area does not scroll, ${real.length} console error(s)`);
  expect(real, `console errors on #/cash:\n${real.join('\n')}`).toEqual([]);
});

/* ------------------------------------------------------------- H3L-05 */

test('H3L-05 the H3 layout works end to end, read-only, and the cart is left empty', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  // Every assertion below is the sub-700 px cash counter: the one-row ☰
  // header, the order bar and the Review & send sheet. CLAUDE.md H3 preamble:
  // "Tablet and desktop (700 px and wider) are unchanged".
  test.skip(!isSmallCash(page), 'CLAUDE.md H3: the small cash layout only; the tablet panel is unchanged');
  const errors = attachConsole(page);
  await signInLive(page);
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1200);

  /* --- header on one row (H3 1) --- */
  const header = await page.locator('header').first().evaluate((el) => {
    const hr = el.getBoundingClientRect();
    const kids = [...el.querySelectorAll('*')]
      .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((n) => ({ what: n.dataset.testid || n.tagName.toLowerCase(), top: n.getBoundingClientRect().top, bottom: n.getBoundingClientRect().bottom }));
    return { height: hr.height, top: hr.top, bottom: hr.bottom, kids, text: (el.innerText || '').replace(/\s+/g, ' ').trim() };
  });
  expect(header.height, `CLAUDE.md H3 1: a 52px one-row header; it is ${r2(header.height)}px`).toBeLessThanOrEqual(56);
  const wrapped = header.kids.filter((k) => k.bottom > header.bottom + 1 || k.top < header.top - 1);
  expect(wrapped.map((k) => k.what), 'CLAUDE.md H3 1: nothing in the header wraps to a second row').toEqual([]);
  expect(header.text, 'the header carries the next order number').toMatch(/Next\s+[A-Z]-\d{3}/);
  await expect(tid(page, 'till-select'), 'CLAUDE.md H3 1: the till picker').toBeVisible();
  record(`H3L-05 ${info.project.name}: header one row, ${r2(header.height)}px, reads "${header.text}"`);

  /* --- ☰ opens and closes (H3 1) --- */
  const menuButton = tid(page, 'menu-button');
  const appMenu = tid(page, 'app-menu');
  await expect(appMenu).toBeHidden();
  await menuButton.click();
  await expect(appMenu, 'CLAUDE.md H3 1: ☰ opens the dropdown').toBeVisible();
  expect(await menuButton.getAttribute('aria-expanded')).toBe('true');
  for (const item of ['menu-food', 'menu-reports', 'menu-recent', 'menu-signout']) {
    await expect(tid(page, item), `the ☰ menu lists ${item}`).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(appMenu, 'CLAUDE.md H3 1: Escape closes the ☰ menu').toBeHidden();
  expect(await menuButton.getAttribute('aria-expanded')).toBe('false');

  /* --- order bar (H3 3) --- */
  await expect(tid(page, 'order-bar'), 'CLAUDE.md H3 3: hidden while the cart is empty').toBeHidden();
  await tid(page, 'tile-fuchka').click();
  await page.waitForTimeout(150);
  await tid(page, 'tile-marshmallow').click();
  await page.waitForTimeout(150);
  await tid(page, 'tile-momo').click();
  await page.waitForTimeout(300);

  const bar = tid(page, 'order-bar-open');
  await expect(bar, 'CLAUDE.md H3 3: the order bar appears with items in the cart').toBeVisible();
  const barText = norm(await bar.innerText());
  expect(barText).toContain('3 items');
  expect(barText).toContain('£15.00');
  expect(barText).toMatch(/Review & send/i);
  const barBox = await bar.boundingBox();
  expect(Math.abs(barBox.height - 60), `the order bar is ${r2(barBox.height)}px; H3 3 says 60`).toBeLessThanOrEqual(4);
  await shot(page, `${info.project.name}-cash-bar`);
  record(`H3L-05 ${info.project.name}: order bar reads "${barText}", ${r2(barBox.height)}px tall`);

  /* --- review sheet (H3 4) --- */
  await bar.click();
  const sheet = tid(page, 'review-sheet');
  await expect(sheet, 'CLAUDE.md H3 4: the order bar opens the Review & send sheet').toBeVisible();
  expect(await sheet.getAttribute('role')).toBe('dialog');
  const sheetGeo = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="review-sheet"]');
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, viewport: window.innerHeight };
  });
  expect(Math.abs(sheetGeo.top - 40), `the sheet starts at y=${r2(sheetGeo.top)}; H3 4 says 40`).toBeLessThanOrEqual(4);

  // The aligned cart lines with 48px steppers (H3 4, carrying H2 forward).
  const lines = await page.evaluate((ids) => {
    const q = (n) => document.querySelector(`[data-testid="${n}"]`);
    return ids.filter((id) => q(`line-${id}`)).map((id) => {
      const row = q(`line-${id}`);
      const name = row.querySelector('.line__name');
      const dec = q(`line-dec-${id}`).getBoundingClientRect();
      const inc = q(`line-inc-${id}`).getBoundingClientRect();
      return {
        id,
        text: (name ? name.textContent : '').replace(/\s+/g, ' ').trim(),
        nameScrollWidth: name ? name.scrollWidth : 0,
        nameClientWidth: name ? name.clientWidth : 0,
        dec: { left: dec.left, w: dec.width, h: dec.height },
        inc: { left: inc.left, w: inc.width, h: inc.height }
      };
    });
  }, MENU_IDS);
  expect(lines.length, 'three cart lines').toBe(3);
  for (const key of ['dec', 'inc']) {
    const xs = lines.map((l) => l[key].left);
    expect(Math.max(...xs) - Math.min(...xs),
      `CLAUDE.md H3 4: every line-${key}-* shares one left x (±1px); lines ${JSON.stringify(lines.map((l) => [l.id, r2(l[key].left)]))}`
    ).toBeLessThanOrEqual(1);
  }
  for (const l of lines) {
    expect(l.nameScrollWidth, `"${l.text}" must wrap, not overflow`).toBeLessThanOrEqual(l.nameClientWidth + 1);
    for (const key of ['dec', 'inc']) {
      expect(l[key].w, `line-${key}-${l.id} is ${r2(l[key].w)}px wide; H3 4 says 48`).toBeGreaterThanOrEqual(46.5);
      expect(l[key].h, `line-${key}-${l.id} is ${r2(l[key].h)}px tall; H3 4 says 48`).toBeGreaterThanOrEqual(46.5);
    }
  }
  const marshLine = lines.find((l) => l.id === 'marshmallow');
  expect(marshLine.text, 'the cart names the renamed item, never the old "Marshmallow (V)"')
    .toMatch(/Chocolate Marshmallow \(V\)|Choc Marshmallow/);
  record(`H3L-05 ${info.project.name}: sheet top ${r2(sheetGeo.top)}px, 3 aligned lines, steppers ${r2(lines[0].dec.w)}x${r2(lines[0].dec.h)}, marshmallow line reads "${marshLine.text}"`);

  /* --- cash received, Cash selected (H3 4) --- */
  await tid(page, 'pay-cash').click();
  await page.waitForTimeout(250);
  const quick = page.locator('[data-testid="tender-exact"], [data-testid="tender-500"], [data-testid="tender-1000"], [data-testid="tender-2000"], [data-testid="tender-5000"]');
  expect(await quick.count(), 'CLAUDE.md H3 4: five quick buttons').toBe(5);
  expect((await quick.allInnerTexts()).map(norm)).toEqual(['Exact', '£5', '£10', '£20', '£50']);
  await tid(page, 'tender-2000').click();
  await page.waitForTimeout(250);
  const block = norm(await page.locator('[data-testid="cash-received"], [role="group"][aria-label="Quick cash amounts"]').first()
    .evaluate((el) => {
      let n = el;
      for (let i = 0; i < 4 && n.parentElement; i++) {
        if (/Cash received/i.test(n.textContent || '')) break;
        n = n.parentElement;
      }
      return n.innerText || '';
    }));
  expect(block, 'CLAUDE.md H3 4: "Change £x.xx" beside the label').toContain('Change £5.00');
  await expect(tid(page, 'tender-other-toggle'), 'CLAUDE.md H3 4: an Other amount link').toBeVisible();
  await shot(page, `${info.project.name}-cash-sheet`);
  record(`H3L-05 ${info.project.name}: cash received block reads "${block.replace(/\n/g, ' ')}"`);

  // Deselect the quick button so nothing is left keyed in.
  await tid(page, 'tender-2000').click();
  await page.waitForTimeout(200);

  /* --- the sheet closes three ways (H3 4). Send is never clicked. --- */
  await tid(page, 'sheet-add-more').click();
  await expect(sheet, 'CLAUDE.md H3 4: Add more closes the sheet').toBeHidden();
  await bar.click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet, 'CLAUDE.md H3 4: Escape closes the sheet').toBeHidden();
  await bar.click();
  await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(sheet, 'CLAUDE.md H3 4: the browser Back button closes the sheet').toBeHidden();
  expect(await page.evaluate(() => location.hash), 'Back must not leave the cash counter').toBe('#/cash');
  record(`H3L-05 ${info.project.name}: the sheet closed on Add more, Escape and Back; Send was never clicked`);

  /* --- empty the cart and leave nothing behind --- */
  await bar.click();
  await expect(sheet).toBeVisible();
  for (const id of ['fuchka', 'momo', 'marshmallow']) {
    for (let i = 0; i < 4; i++) {
      const dec = tid(page, `line-dec-${id}`);
      if (!(await dec.count()) || !(await dec.isVisible().catch(() => false))) break;
      await dec.click();
      await page.waitForTimeout(150);
    }
  }
  await expect(sheet, 'removing the last item closes the sheet').toBeHidden({ timeout: 10000 });
  await expect(tid(page, 'order-bar'), 'the cart is left empty').toBeHidden();
  await page.goto(LIVE + '#/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const real = realErrors(errors);
  record(`H3L-05 ${info.project.name}: PASS - header, ☰, order bar, sheet, cash received all exercised read-only; cart emptied; ${real.length} console error(s)${real.length ? ': ' + real.join(' | ') : ''}`);
  expect(real, `console errors while exercising the H3 layout:\n${real.join('\n')}`).toEqual([]);
});

/* ------------------------------------------------------------- H3L-06 */

test('H3L-06 the One day report reads zero for today', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await signInLive(page);
  const day = londonDay();
  await page.goto(LIVE + `#/reports?day=${day}`, { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'kpi-sales')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);

  const kpis = {};
  for (const name of ['kpi-sales', 'kpi-orders', 'kpi-items', 'kpi-avg-order', 'kpi-avg-wait']) {
    kpis[name] = norm(await tid(page, name).innerText());
  }
  record(`H3L-06 ${info.project.name}: ${day} KPIs ${JSON.stringify(kpis)}`);
  expect(kpis['kpi-sales'], 'no sales today after the reset').toMatch(/£0(\.00)?/);
  expect(kpis['kpi-orders'], 'no orders today').toMatch(/(^|\D)0(\D|$)/);
  expect(kpis['kpi-items'], 'no items today').toMatch(/(^|\D)0(\D|$)/);
  expect(kpis['kpi-avg-order'], 'no average order today').toMatch(/£0(\.00)?|—/);
  expect(kpis['kpi-avg-wait'], 'no average wait today').toMatch(/0|—/);

  await shot(page, `${info.project.name}-reports-zero`);
  const real = realErrors(errors);
  record(`H3L-06 ${info.project.name}: PASS - the One day report for ${day} is zero across every KPI, ${real.length} console error(s)`);
  expect(real, `console errors on #/reports:\n${real.join('\n')}`).toEqual([]);
});

/* ------------------------------------------------------------- H3L-07 */

test('H3L-07 Sales by day shows "No sales in this range", and "This event" stays hidden', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await signInLive(page);
  await page.goto(LIVE + '#/reports/days', { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'range-from')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);

  const from = await tid(page, 'range-from').inputValue();
  const to = await tid(page, 'range-to').inputValue();
  expect(to, 'the default range ends today').toBe(londonDay());
  expect(from, 'the default range is the last 7 days').toBe(londonDayOffset(-6));

  const empty = tid(page, 'range-empty');
  await expect(empty, 'CLAUDE.md Phase III 4: "No sales in this range"').toBeVisible({ timeout: 20000 });
  expect(norm(await empty.innerText())).toMatch(/No sales in this range/i);

  // settings/event does not exist, so the quick button is hidden (Phase III 2).
  // "Hidden" is what the brief asks for, so a node that is present but not
  // visible is fine; a usable button is not.
  const event = tid(page, 'range-event');
  const eventState = (await event.count())
    ? ((await event.isVisible().catch(() => false)) ? 'visible' : 'present but hidden')
    : 'absent';
  record(`H3L-07 ${info.project.name}: "This event" is ${eventState}`);
  expect(eventState,
    'CLAUDE.md Phase III 2: "This event" ... is hidden when that document does not exist'
  ).not.toBe('visible');

  await shot(page, `${info.project.name}-reports-days-zero`);
  const real = realErrors(errors);
  record(`H3L-07 ${info.project.name}: PASS - ${from}..${to} shows "No sales in this range", This event hidden, ${real.length} console error(s)`);
  expect(real, `console errors on #/reports/days:\n${real.join('\n')}`).toEqual([]);
});

/* ------------------------------------------------------------- H3L-08 */

test('H3L-08 the Orders screen shows "No orders match these filters."', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await signInLive(page);
  const day = londonDay();
  await page.goto(LIVE + `#/reports/orders?day=${day}`, { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'orders-day')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);

  const emptyMsg = tid(page, 'orders-empty');
  await expect(emptyMsg, 'CLAUDE.md Phase IV 5: "No orders match these filters."').toBeVisible({ timeout: 20000 });
  expect(norm(await emptyMsg.innerText())).toBe('No orders match these filters.');

  const summary = norm(await tid(page, 'orders-summary').innerText());
  expect(summary, 'CLAUDE.md Phase IV 4: the summary reflects the filters').toMatch(/^0 orders · £0\.00$/);
  expect(summary, 'nothing is cancelled either, so no "(excludes …)"').not.toContain('excludes');

  await shot(page, `${info.project.name}-reports-orders-zero`);
  const real = realErrors(errors);
  record(`H3L-08 ${info.project.name}: PASS - ${day} orders list is empty, summary "${summary}", ${real.length} console error(s)`);
  expect(real, `console errors on #/reports/orders:\n${real.join('\n')}`).toEqual([]);
});

/* ------------------------------------------------------------- H3L-09 */

test('H3L-09 a CSV export downloads and parses (read path)', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  await signInLive(page);
  const day = londonDay();
  await page.goto(LIVE + `#/reports?day=${day}`, { waitUntil: 'domcontentloaded' });
  const button = tid(page, 'export-csv');
  await expect(button, 'CLAUDE.md Reports 6: "Export CSV"').toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2500);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    button.click()
  ]);
  const name = download.suggestedFilename();
  const text = readFileSync(await download.path(), 'utf8');
  const rows = text.trim().split(/\r?\n/).map((r) => r.split(','));

  expect(name, 'the export is named for the day on screen').toContain(day);
  expect(rows[0], 'the thirteen Phase I columns').toEqual([
    'day', 'orderNo', 'till', 'name', 'item', 'qty', 'price',
    'lineTotal', 'payment', 'status', 'createdAt', 'readyAt', 'waitSeconds'
  ]);
  expect(rows.length, 'with no orders the file is the header alone').toBe(1);
  expect(text, 'the CSV must never carry the Phase I tendered field').not.toMatch(/tendered/i);
  record(`H3L-09 ${info.project.name}: PASS - downloaded "${name}", ${rows.length - 1} data row(s), 13 columns`);
});

/* ------------------------------------------------------------- H3L-10 */

test('H3L-10 nothing was written to live Firestore', async ({}, info) => {
  const body = await liveFirestore('/orders?pageSize=300');
  const after = (body.documents || []).map((d) => plain(d.fields));
  record(`H3L-10 ${info.project.name}: live orders = ${after.length} document(s) after the check`);
  expect(after.length, 'this check places no orders; `orders` must still be empty').toBe(0);
  expect(fingerprint(after), 'the orders collection changed during a read-only check')
    .toBe(fingerprint(ORDERS_BEFORE || []));

  const menu = docIds(await liveFirestore('/menu?pageSize=50'));
  expect(menu, 'the menu must be the same seven documents afterwards').toEqual([...MENU_IDS].sort());
  record(`H3L-10 ${info.project.name}: PASS - orders still empty, menu still the same seven documents`);
});
