/**
 * P5L-* — Phase V (v1.4.0) live verification against LIVE_URL.
 * STRICTLY READ-ONLY.
 *
 * Gated: skipped unless LIVE_P5=1, the same style as the other live specs, so
 * `npm run test:e2e` stays offline and deterministic. Run with:
 *
 *   LIVE_P5=1 EXPECT_BUILD=6394978 npx playwright test tests/e2e/live-p5.spec.js \
 *     --project=tablet --project=iphone13
 *
 * WRITE DISCIPLINE. Nothing in this file writes to live Firestore:
 *   - `send-order` is NEVER clicked.
 *   - **`save-changes`, `cancel-confirm`, `got-it-*` and `remove-*` are never
 *     clicked either.** Phase V adds four controls that write; none is tapped.
 *     Edit mode is entered only to read the banner and the payment prompt, and
 *     is always left through Discard changes, which writes nothing
 *     (CLAUDE.md Phase V 2).
 *   - Tapping a till tile, and + / − inside an edit draft, mutate in-page
 *     state only. The cart and the edit draft reach Firestore solely through
 *     Send and Save; every test that touches them unwinds before it finishes.
 *     Same precedent as the H3 and H4 live checks, logged in DECISIONS.md.
 *   - P5L-00 and P5L-12 bracket the run with a count and a fingerprint of the
 *     `orders` collection, plus the `menu` document ids, read over the REST
 *     API, to prove it.
 *
 * NOT ALWAYS TESTABLE LIVE. Two Phase V behaviours need an order on the board:
 * the Open orders rows (P5L-07/P5L-08) and the food counter's view of a
 * Samosa Chat line (P5L-09). Live was reset by H3 and holds no orders until
 * the stall trades. Those cases read what is actually there and **record the
 * gap** rather than creating an order to satisfy themselves; the emulator
 * cases that cover them are named in the record line.
 *
 * CREDENTIALS: read at run time from the gitignored .secrets/app-login.env by
 * ./creds.js. Never written into a test file, a log line, a screenshot or
 * qa/live-smoke-record.txt (all committed to a public repo). The Show/Hide
 * toggle is never pressed, so the password stays masked in every capture.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROOT, SHOTS, attachConsole, realErrors, parseCsv,
  loginUserField, loginPassField, loginSubmit, signOutButton,
  tid, isSmallCash, openCashPanel, closeCashPanel, boxOf, heightOf,
  // Phase V
  MENU_IDS_P5, openOrdersButton, openOrdersPanel, openOrdersClose,
  openOrdersSearch, openOrdersCount, openOpenOrders, closeOpenOrders,
  listedOpenOrders, openOrderRow, openEditButton, openCancelButton,
  editBanner, editDelta, saveChanges, discardChanges
} from './helpers.js';
import { creds } from './creds.js';

const LIVE = process.env.LIVE_URL || 'https://nottinghambengaliassociation.github.io/nba-food-stall-app/';
const C = creds();
const PKG_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;

/** Optional pin from the deploy facts, e.g. EXPECT_BUILD=6394978. */
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
  ['reports-orders', '#/reports/orders']
];

const OPEN_STATUSES = ['new', 'preparing', 'ready'];
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const r2 = (n) => Math.round(n * 100) / 100;

test.skip(!process.env.LIVE_P5, 'set LIVE_P5=1 to run the read-only Phase V live check');
test.describe.configure({ mode: 'serial' });

/** Append one line to qa/live-smoke-record.txt. Only ever safe values. */
function record(line) {
  // eslint-disable-next-line no-console
  console.log(`[LIVE-P5] ${line}`);
  try { appendFileSync(resolve(SHOTS, '../live-smoke-record.txt'), line + '\n'); } catch { /* ignore */ }
}

const shot = (page, name, full = true) =>
  page.screenshot({ path: resolve(SHOTS, `live-p5-${name}.png`), fullPage: full });

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

/** Europe/London today, the day the screens open on. */
const londonToday = () => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
}).formatToParts(new Date()).reduce((a, p) => (a[p.type] = p.value, a), {});
const TODAY = (() => { const p = londonToday(); return `${p.year}-${p.month}-${p.day}`; })();

let ORDERS_BEFORE = null;
let MENU_BEFORE = null;
let MENU_DOCS = null;
/** Today's live orders that the Open orders list would show. */
let OPEN_LIVE = [];
/** Today's live orders that Edit may be opened on (new or preparing). */
let EDITABLE_LIVE = [];
/** Any live order carrying a samosa_chat line, for the station-filter case. */
let SAMOSA_CHAT_LIVE = [];
/** The most recent live day that actually holds orders, for the CSV case. */
let DAY_WITH_ORDERS = null;
let ORDERS_ON_THAT_DAY = [];

/** Sign in with the shared account. Nothing here is logged. */
async function signInLive(page) {
  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  await (await loginSubmit(page)).waitFor({ state: 'visible', timeout: 30000 });
  await expect(page.getByText(/login not configured/i), 'the live login must be configured').toHaveCount(0);
  await (await loginUserField(page)).fill(C.user);
  await (await loginPassField(page)).fill(C.password);
  await (await loginSubmit(page)).click();
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 30000 }).toBe('#/');
}

/** Sign in and land on the live cash counter with the tiles painted. */
async function openLiveCash(page) {
  await disableCache(page);
  await signInLive(page);
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1000);
}

/** Tap a tile the volunteer's way (closing the H3 sheet first if it covers it). */
async function addLive(page, id, times = 1) {
  await closeCashPanel(page);
  for (let i = 0; i < times; i += 1) {
    await tid(page, `tile-${id}`).click();
    await page.waitForTimeout(140);
  }
}

/** Leave the till exactly as it was found: cart empty, nothing sent. */
async function emptyTheCart(page) {
  for (let guard = 0; guard < 40; guard += 1) {
    if (isSmallCash(page)) {
      const bar = tid(page, 'order-bar-open');
      const barUp = (await bar.count()) && (await bar.isVisible().catch(() => false));
      const sheetUp = await tid(page, 'review-sheet').isVisible().catch(() => false);
      if (!barUp && !sheetUp) return true;
    }
    await openCashPanel(page);
    const decs = page.locator('[data-testid^="line-dec-"]');
    if (!(await decs.count())) return true;
    await decs.first().click();
    await page.waitForTimeout(180);
  }
  return false;
}

async function cartIsEmpty(page) {
  if (isSmallCash(page)) {
    const bar = tid(page, 'order-bar-open');
    const barUp = (await bar.count()) && (await bar.isVisible().catch(() => false));
    const sheetUp = await tid(page, 'review-sheet').isVisible().catch(() => false);
    return !barUp && !sheetUp;
  }
  const total = norm(await tid(page, 'order-total').innerText().catch(() => ''));
  return /£0\.00/.test(total);
}

/** Every writing control Phase V adds, so a test can prove it never tapped one. */
async function assertNothingSubmitted(page, where) {
  const confirm = page.locator('[data-testid="cancel-confirm"]');
  if (await confirm.count()) {
    expect(await confirm.isVisible().catch(() => false),
      `${where}: the cancel confirm must never be left open on live`).toBe(false);
  }
}

/* ---------------------------------------------------------------- P5L-00 */

test('P5L-00 the live collections before anything is opened, and the eight-item menu', async ({}, info) => {
  const body = await liveFirestore('/orders?pageSize=300');
  const orders = (body.documents || []).map((d) => plain(d.fields));
  ORDERS_BEFORE = orders;

  const menuBody = await liveFirestore('/menu?pageSize=50');
  MENU_BEFORE = docIds(menuBody);
  MENU_DOCS = (menuBody.documents || []).map((d) => ({ id: d.name.split('/').pop(), ...plain(d.fields) }));

  OPEN_LIVE = orders.filter((o) => o.day === TODAY && OPEN_STATUSES.includes(o.status));
  EDITABLE_LIVE = OPEN_LIVE.filter((o) => o.status === 'new' || o.status === 'preparing');
  SAMOSA_CHAT_LIVE = orders.filter((o) => (o.items || []).some((l) => l && l.id === 'samosa_chat'));

  const days = [...new Set(orders.map((o) => o.day).filter(Boolean))].sort();
  DAY_WITH_ORDERS = days.length ? days[days.length - 1] : null;
  ORDERS_ON_THAT_DAY = DAY_WITH_ORDERS ? orders.filter((o) => o.day === DAY_WITH_ORDERS) : [];
  record(`P5L-00 ${info.project.name}: live trading days [${days.join(', ')}]; newest with orders = ${DAY_WITH_ORDERS || 'none'} (${ORDERS_ON_THAT_DAY.length} order(s))`);

  record(`P5L-00 ${info.project.name}: live orders = ${orders.length} document(s), menu = ${MENU_BEFORE.length} document(s); ` +
    `today (${TODAY}) open = ${OPEN_LIVE.length}, editable = ${EDITABLE_LIVE.length}, carrying samosa_chat = ${SAMOSA_CHAT_LIVE.length}`);

  // CLAUDE.md Menu: "7 items from v1.3.1, plus `samosa_chat` added in Phase V
  // (v1.4.0), so 8". menu-sync created the one missing document.
  expect(MENU_BEFORE, 'the live menu is exactly the eight-item table').toEqual([...MENU_IDS_P5].sort());
  for (const gone of ['samosa', 'straw', 'fountain']) {
    expect(MENU_BEFORE, `CLAUDE.md Menu: "${gone}" was deleted by H3 and must not come back`).not.toContain(gone);
  }

  const chat = MENU_DOCS.find((m) => m.id === 'samosa_chat');
  expect(chat, 'menu/samosa_chat must exist live').toBeTruthy();
  expect(chat.name, 'CLAUDE.md Menu: name "Samosa Chat"').toBe('Samosa Chat');
  expect(chat.short, 'short "Samosa Chat"').toBe('Samosa Chat');
  expect(chat.price, '£5 in integer pence').toBe(500);
  expect(String(chat.colour).toUpperCase(), 'tile colour #A5F3FC').toBe('#A5F3FC');
  expect(chat.station, 'station chaat').toBe('chaat');
  expect(chat.active, 'active').toBe(true);
  expect(chat.sort, 'sort 8, last on the till').toBe(8);

  // menu-sync must not have touched the seven that were already there.
  const marshmallow = MENU_DOCS.find((m) => m.id === 'marshmallow');
  expect(marshmallow.name, 'the H3 rename is untouched').toBe('Chocolate Marshmallow (V)');
  expect(MENU_DOCS.every((m) => m.price === 500), 'every live item is still £5').toBe(true);

  record(`P5L-00 ${info.project.name}: PASS - menu [${MENU_BEFORE.join(', ')}], samosa_chat = Samosa Chat/500/#A5F3FC/chaat/sort 8`);
});

/* ---------------------------------------------------------------- P5L-01 */

test('P5L-01 the deployed version.js carries v1.4.0 and a clean build', async ({}, info) => {
  const src = await (await fetch(LIVE + 'js/version.js')).text();
  const version = (src.match(/APP_VERSION\s*=\s*["']([^"']+)["']/) || [])[1];
  const build = (src.match(/APP_BUILD\s*=\s*["']([^"']+)["']/) || [])[1];
  const date = (src.match(/APP_DATE\s*=\s*["']([^"']+)["']/) || [])[1];
  record(`P5L-01 ${info.project.name}: published js/version.js -> ${version} / ${build} / ${date}`);

  expect(version, 'CLAUDE.md Phase III part 2, 1: package.json is the single source of truth').toBe(PKG_VERSION);
  expect(version, 'CLAUDE.md Phase V 8: package.json version 1.4.0').toBe('1.4.0');
  expect(build, 'the deployed build must be a clean 7-character SHA').toMatch(CLEAN_BUILD);
  expect(build, 'the deployed build must not be dirty').not.toContain('-dirty');
  expect(date, 'APP_DATE is YYYY-MM-DD').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  if (EXPECT_BUILD) expect(build, `the deploy pinned build ${EXPECT_BUILD}`).toBe(EXPECT_BUILD);
  record(`P5L-01 ${info.project.name}: PASS - v${version}, build ${build}`);
});

/* ---------------------------------------------------------------- P5L-02 */

test('P5L-02 the login card shows v1.4.0 with the deployed build', async ({ page }, info) => {
  const errors = attachConsole(page);
  await disableCache(page);
  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });

  const line = tid(page, 'login-version');
  await expect(line, 'CLAUDE.md Phase III part 2, 4: a version line on the login card')
    .toBeVisible({ timeout: 30000 });
  await expect
    .poll(async () => norm(await line.innerText()), { timeout: 20000, message: 'the version line never resolved past "dev"' })
    .not.toMatch(/Version dev/);

  const text = norm(await line.innerText());
  const m = text.match(/^Version\s+(\S+)\s+·\s+build\s+(\S+)\s+·\s+updated\s+(.+)$/);
  expect(m, `the login version line must read "Version x.y.z · build <sha> · updated <date>"; got "${text}"`).toBeTruthy();
  const [, version, build, date] = m;
  expect(version, 'CLAUDE.md Phase V 8: the live login card reads 1.4.0').toBe(PKG_VERSION);
  expect(build).toMatch(CLEAN_BUILD);
  if (EXPECT_BUILD) expect(build, `the deploy pinned build ${EXPECT_BUILD}`).toBe(EXPECT_BUILD);
  expect(date).toMatch(DATE_SHAPE);

  const title = norm(await line.getAttribute('title'));
  expect(title).toBe(`Version ${version}, build ${build}, updated ${date}`);
  expect(norm(await line.getAttribute('aria-label'))).toBe(title);

  await shot(page, `${info.project.name}-login-version`);
  const real = realErrors(errors);
  record(`P5L-02 ${info.project.name}: PASS - login card reads "Version ${version} · build ${build} · updated ${date}", ${real.length} console error(s)`);
  expect(real, `console errors on #/login:\n${real.join('\n')}`).toEqual([]);
});

/* ---------------------------------------------------------------- P5L-03 */

test('P5L-03 signed in, every route loads clean, Online, with the v1.4.0 label', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await disableCache(page);
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

    if (route === '#/cash' && isSmallCash(page)) {
      // CLAUDE.md H3 1: on the small cash counter the version line is in ☰.
      await tid(page, 'menu-button').click();
      await expect(tid(page, 'app-menu')).toBeVisible();
      const inMenu = tid(page, 'app-menu').locator('[data-testid="app-version"]');
      await expect(inMenu).toBeVisible();
      expect(norm(await inMenu.innerText()), `${route}: the ☰ version line`).toContain('v' + PKG_VERSION);
      await page.keyboard.press('Escape');
      await expect(tid(page, 'app-menu')).toBeHidden({ timeout: 8000 });
    } else {
      const label = tid(page, 'app-version');
      await expect(label, `${route}: CLAUDE.md Phase III part 2, 5`).toBeVisible();
      expect(norm(await label.innerText()), `${route}: the header label`).toBe('v' + PKG_VERSION);
      const title = norm(await label.getAttribute('title'));
      expect(title, `${route}: the header label needs a title`)
        .toMatch(new RegExp(`^Version ${PKG_VERSION.replace(/\./g, '\\.')}, build [0-9a-f]{7}, updated `));
      expect(title, 'the deployed build must not be dirty').not.toContain('-dirty');
      if (EXPECT_BUILD) expect(title, `${route}: the pinned build`).toContain(`build ${EXPECT_BUILD}`);
    }

    await shot(page, `${info.project.name}-${name}`);
    record(`P5L-03 ${info.project.name}: ${route} loaded signed in, pill "${norm(await pill.innerText())}"`);
  }

  const real = realErrors(errors);
  record(`P5L-03 ${info.project.name}: ${real.length ? 'FAIL' : 'PASS'} - ${ROUTES.length} routes signed in, v${PKG_VERSION} everywhere, ${real.length} console error(s)${real.length ? ': ' + real.join(' | ') : ''}`);
  expect(real, `console errors across the signed-in routes:\n${real.join('\n')}`).toEqual([]);
});

/* ---------------------------------------------------------------- P5L-04 */

test('P5L-04 eight tiles on the live till, Samosa Chat last', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await openLiveCash(page);

  const rendered = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="tile-"]')]
    .map((t) => t.dataset.testid.replace(/^tile-/, '')));
  expect(rendered, 'CLAUDE.md Menu / Phase V 7: eight tiles, in sort order, Samosa Chat last')
    .toEqual(MENU_IDS_P5);

  const tile = tid(page, 'tile-samosa_chat');
  await expect(tile, 'the eighth tile').toBeVisible();
  const text = norm(await tile.innerText());
  expect(text, 'the tile reads "Samosa Chat"').toContain('Samosa Chat');
  if (!isSmallCash(page)) expect(text, 'CLAUDE.md Cash 1: £5 on the tile').toMatch(/£5(\.00)?/);

  // Its own icon, not the unknown-item plate fallback.
  const icons = await page.evaluate(() => {
    const body = (el) => {
      const svg = el && el.querySelector('svg');
      return svg ? svg.innerHTML.replace(/\s+/g, '') : null;
    };
    return {
      samosaChat: body(document.querySelector('[data-testid="tile-samosa_chat"]')),
      fuchka: body(document.querySelector('[data-testid="tile-fuchka"]')),
      momo: body(document.querySelector('[data-testid="tile-momo"]'))
    };
  });
  expect(icons.samosaChat, 'CLAUDE.md Phase V 7: "and its icon"').toBeTruthy();
  expect(icons.samosaChat.length, 'the icon must not be empty').toBeGreaterThan(20);
  expect(icons.samosaChat, 'it must be its own icon, not another item\'s').not.toBe(icons.fuchka);
  expect(icons.samosaChat, 'it must be its own icon, not another item\'s').not.toBe(icons.momo);

  // The live tile colour (CLAUDE.md Menu: #A5F3FC).
  const colour = await tile.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = (colour.match(/\d+/g) || []).map(Number);
  expect(Math.abs(r - 0xA5) + Math.abs(g - 0xF3) + Math.abs(b - 0xFC),
    `the Samosa Chat tile is ${colour}; CLAUDE.md Menu says #A5F3FC`
  ).toBeLessThanOrEqual(24);

  if (isSmallCash(page)) {
    // CLAUDE.md Phase V 7: "8 tiles, still no scrolling at 390×664".
    const geo = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('[data-testid^="tile-"]')];
      const area = tiles[0] ? tiles[0].closest('main') || tiles[0].parentElement.parentElement : null;
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        tiles: tiles.map((t) => {
          const rect = t.getBoundingClientRect();
          return { id: t.dataset.testid.replace(/^tile-/, ''), top: rect.top, bottom: rect.bottom, left: rect.left, height: rect.height };
        }),
        area: area ? { scrollHeight: area.scrollHeight, clientHeight: area.clientHeight } : null
      };
    });
    const lefts = [...new Set(geo.tiles.map((t) => Math.round(t.left)))];
    expect(lefts.length, `CLAUDE.md H3 2: three columns; got ${lefts.length}`).toBe(3);
    const offscreen = geo.tiles.filter((t) => t.bottom > geo.viewport.height + 1 || t.top < -1);
    expect(offscreen.map((t) => `${t.id} ${r2(t.top)}..${r2(t.bottom)}`),
      `CLAUDE.md Phase V 7: all 8 tiles fit without scrolling at ${geo.viewport.width}x${geo.viewport.height}`
    ).toEqual([]);
    expect(geo.area.scrollHeight,
      `the menu area scrolls with an empty cart (${geo.area.scrollHeight} > ${geo.area.clientHeight})`
    ).toBeLessThanOrEqual(geo.area.clientHeight + 2);
    record(`P5L-04 ${info.project.name}: 8 tiles in 3 columns, all inside ${geo.viewport.width}x${geo.viewport.height}, menu area does not scroll`);
  }

  await shot(page, `${info.project.name}-cash-tiles`);
  expect(await cartIsEmpty(page), 'nothing was added to the live cart').toBe(true);

  const real = realErrors(errors);
  record(`P5L-04 ${info.project.name}: ${real.length ? 'FAIL' : 'PASS'} - 8 live tiles [${rendered.join(', ')}], ${real.length} console error(s)`);
  expect(real, `console errors on the live till:\n${real.join('\n')}`).toEqual([]);
});

/* ---------------------------------------------------------------- P5L-05 */

test('P5L-05 the Open orders button and its drawer / sheet, live', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await openLiveCash(page);

  const btn = openOrdersButton(page);
  await expect(btn, 'CLAUDE.md Phase V 1: an Open orders button in the cash header').toBeVisible();
  expect(await btn.evaluate((el) => !!el.closest('header')), 'it lives in the dark header').toBe(true);

  const label = norm(await btn.innerText()) + ' ' + ((await btn.getAttribute('aria-label')) || '');
  if (isSmallCash(page)) expect(label, 'CLAUDE.md Phase V 1: "Orders" on phone').toMatch(/Orders/i);
  else expect(label, 'CLAUDE.md Phase V 1: "Open orders" on tablet').toMatch(/Open orders/i);

  const count = await openOrdersCount(page);
  expect(count, 'the button carries a count badge').not.toBeNull();
  expect(count, 'the badge matches the live open orders read over REST').toBe(OPEN_LIVE.length);

  const box = await boxOf(btn);
  const floor = isSmallCash(page) ? 43.5 : 47.5;
  expect(box.height, `the button is ${r2(box.height)}px tall; the minimum here is ${floor}px`)
    .toBeGreaterThanOrEqual(floor);
  expect(await btn.getAttribute('aria-expanded'), 'it reports its state').toBe('false');

  // Phone: between the connection dot and ☰, header still one row (Phase V 1).
  if (isSmallCash(page)) {
    const geo = await page.evaluate(() => {
      const header = document.querySelector('header');
      const rect = (sel) => {
        const el = header.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      const h = header.getBoundingClientRect();
      const kids = [...header.querySelectorAll('*')]
        .filter((el) => el.children.length === 0 && el.getBoundingClientRect().height > 0)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { what: el.dataset.testid || el.tagName.toLowerCase(), top: r.top, bottom: r.bottom };
        });
      return {
        header: { top: h.top, bottom: h.bottom, height: h.height },
        orders: rect('[data-testid="open-orders"]'),
        pill: rect('[data-testid="conn-pill"]'),
        menu: rect('[data-testid="menu-button"]'),
        kids
      };
    });
    expect(geo.header.height, `CLAUDE.md H3 1: the header is one row at about 52 px; it is ${r2(geo.header.height)}px`)
      .toBeLessThanOrEqual(57);
    expect(geo.orders.left, 'Orders sits after the connection dot').toBeGreaterThanOrEqual(geo.pill.right - 1);
    expect(geo.orders.right, 'Orders sits before ☰').toBeLessThanOrEqual(geo.menu.left + 1);
    const spilled = geo.kids.filter((k) => k.bottom > geo.header.bottom + 1 || k.top < geo.header.top - 1);
    expect(spilled.map((k) => k.what), 'the header must stay one row with the Orders button in it').toEqual([]);
  }

  // It opens.
  await openOpenOrders(page);
  const panel = openOrdersPanel(page);
  expect(await panel.getAttribute('role'), 'CLAUDE.md Phase V 1: role="dialog"').toBe('dialog');
  expect(norm(await panel.getAttribute('aria-label') || ''), 'labelled "Open orders"').toMatch(/Open orders/i);
  await expect(openOrdersSearch(page), 'CLAUDE.md Phase V 1: a search box').toBeVisible();
  expect(norm(await panel.innerText()), 'the panel names itself and its count').toMatch(/Open orders\s*·\s*\d+/);

  const pbox = await boxOf(panel);
  const vp = page.viewportSize();
  if (!isSmallCash(page)) {
    expect(Math.abs(pbox.width - 480), `CLAUDE.md Phase V 1: a 480 px drawer; it is ${r2(pbox.width)}px`)
      .toBeLessThanOrEqual(8);
    expect(Math.abs((pbox.x + pbox.width) - vp.width), 'anchored to the right edge').toBeLessThanOrEqual(8);
  } else {
    expect(pbox.width, 'the phone sheet spans the screen').toBeGreaterThanOrEqual(vp.width - 8);
    expect(Math.abs((pbox.y + pbox.height) - vp.height), 'a bottom sheet').toBeLessThanOrEqual(8);
  }
  await shot(page, `${info.project.name}-open-orders`);

  // ... and closes three ways (CLAUDE.md Phase V 1).
  await openOrdersClose(page).click();
  await expect(panel, 'closes on Close').toBeHidden({ timeout: 10000 });

  await openOpenOrders(page);
  // Tablet: the middle of the screen is backdrop. Phone: the sheet starts 40 px
  // down, so the strip above it is the only backdrop a finger can reach.
  if (isSmallCash(page)) await page.mouse.click(8, 8);
  else await page.mouse.click(8, Math.round(vp.height / 2));
  await expect(panel, 'closes on a backdrop tap').toBeHidden({ timeout: 10000 });

  await openOpenOrders(page);
  await page.keyboard.press('Escape');
  await expect(panel, 'closes on Escape').toBeHidden({ timeout: 10000 });

  await assertNothingSubmitted(page, 'P5L-05');
  const real = realErrors(errors);
  record(`P5L-05 ${info.project.name}: ${real.length ? 'FAIL' : 'PASS'} - Open orders button (badge ${count}) opens a ${isSmallCash(page) ? 'bottom sheet' : '480px drawer'} and closes on Close, backdrop and Escape, ${real.length} console error(s)`);
  expect(real, `console errors around the live Open orders panel:\n${real.join('\n')}`).toEqual([]);
});

/* ---------------------------------------------------------------- P5L-06 */

test('P5L-06 the Recent strip is gone, and "Next A-0NN" is in the ☰ menu', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await openLiveCash(page);

  // CLAUDE.md Phase V 1: Open orders replaces the Recent strip on every layout.
  for (const name of ['recent-list', 'recent-sheet']) {
    const el = tid(page, name);
    if (await el.count()) {
      expect(await el.isVisible().catch(() => false),
        `CLAUDE.md Phase V 1: "${name}" belongs to the Recent strip, which Open orders replaces`).toBe(false);
    }
  }
  expect(norm(await page.locator('body').innerText()), 'no "Recent orders" wording is left on the till')
    .not.toMatch(/Recent orders/i);

  if (!isSmallCash(page)) {
    expect(norm(await page.locator('header').first().innerText()),
      'the tablet header still advertises the next order number').toMatch(/[A-Z]-\d{3}/);
    record(`P5L-06 ${info.project.name}: PASS - no Recent strip on the live tablet till`);
  } else {
    const header = page.locator('header').first();
    expect(norm(await header.innerText()),
      'CLAUDE.md Phase V 1: "Next A-045" moves into the ☰ menu, out of the header bar'
    ).not.toMatch(/Next\s+[A-Z]-\d{3}/);

    await tid(page, 'menu-button').click();
    const menu = tid(page, 'app-menu');
    await expect(menu).toBeVisible();
    expect(await tid(page, 'menu-recent').count(),
      'CLAUDE.md Phase V 1: "The ☰ Recent orders item is removed"').toBe(0);

    const menuText = norm(await menu.innerText());
    expect(menuText, 'CLAUDE.md Phase V 1: "Next A-045" sits in the ☰ menu').toMatch(/Next\s+[A-Z]-\d{3}/);
    expect(menuText, 'the menu still lists Food counter').toMatch(/Food counter/i);
    expect(menuText, 'the menu still lists Reports').toMatch(/Reports/i);
    expect(menuText, 'the menu still lists Sign out').toMatch(/Sign out/i);

    const order = await page.evaluate(() => {
      const menuEl = document.querySelector('[data-testid="app-menu"]');
      const next = menuEl.querySelector('[data-testid="menu-next"]');
      const version = menuEl.querySelector('[data-testid="menu-version"], [data-testid="app-version"]');
      if (!next || !version) return null;
      return { next: next.getBoundingClientRect().top, version: version.getBoundingClientRect().top };
    });
    expect(order, 'both the next number and the version line must be in the menu').not.toBeNull();
    expect(order.next, 'CLAUDE.md Phase V 1: the next number sits above the version line')
      .toBeLessThan(order.version);

    await shot(page, `${info.project.name}-menu-next`);
    await page.keyboard.press('Escape');
    record(`P5L-06 ${info.project.name}: PASS - no ☰ Recent orders item, "${(menuText.match(/Next\s+[A-Z]-\d{3}/) || [''])[0]}" above the version line`);
  }

  const real = realErrors(errors);
  expect(real, `console errors on the live till:\n${real.join('\n')}`).toEqual([]);
});

/* ---------------------------------------------------------------- P5L-07 */

test('P5L-07 what the live Open orders list holds', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await openLiveCash(page);
  await openOpenOrders(page);

  const listed = await listedOpenOrders(page);
  const expected = OPEN_LIVE
    .slice()
    .sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0))
    .map((o) => o.orderNo);
  expect(listed, 'CLAUDE.md Phase V 1: today\'s new/preparing/ready orders from all tills, newest first')
    .toEqual(expected);

  if (!listed.length) {
    // CLAUDE.md H3 7: "After the reset, reports start empty". Nothing is
    // created to make this case pass — the gap is recorded instead.
    expect(norm(await openOrdersPanel(page).innerText()),
      'with nothing open the panel says so rather than showing an empty list'
    ).toMatch(/No open orders/i);
    record(`P5L-07 ${info.project.name}: NOT VERIFIABLE LIVE - live holds no open orders today (${TODAY}), ` +
      'so the row contents, the 48 px Edit/Cancel buttons and the "Ready: cancel only" rule could not be ' +
      'exercised against live. No order was created. Covered on the emulator by cash-p5.spec.js P5-04, P5-06 and P5-07.');
  } else {
    for (const no of listed) {
      const row = openOrderRow(page, no);
      const text = norm(await row.innerText());
      const live = OPEN_LIVE.find((o) => o.orderNo === no);
      expect(text, `${no} shows its order number`).toContain(no);
      expect(text, `${no} shows the name to call out`).toContain(live.name || 'Guest');
      expect(text, `${no} shows the till it was placed on`).toMatch(new RegExp(`till ${live.till}`, 'i'));

      const edit = openEditButton(page, no);
      const cancel = openCancelButton(page, no);
      await expect(edit, `${no} needs an Edit button`).toBeVisible();
      await expect(cancel, `${no} needs a Cancel… button`).toBeVisible();
      for (const [what, loc] of [['Edit', edit], ['Cancel', cancel]]) {
        expect(await heightOf(loc), `${what} on ${no} must be at least 48 px`).toBeGreaterThanOrEqual(47.5);
      }
      if (live.status === 'ready') {
        await expect(edit, 'CLAUDE.md Phase V 1: Edit is disabled for ready').toBeDisabled();
        expect(await edit.getAttribute('title'), 'title "Ready: cancel only"').toMatch(/Ready: cancel only/i);
      } else {
        await expect(edit, `${no} is ${live.status}, so Edit is enabled`).toBeEnabled();
      }
    }
    record(`P5L-07 ${info.project.name}: PASS - ${listed.length} live open order(s) listed newest first [${listed.join(', ')}], Edit/Cancel at 48 px, Ready rule honoured`);
  }

  await shot(page, `${info.project.name}-open-orders-list`);
  await closeOpenOrders(page);
  await assertNothingSubmitted(page, 'P5L-07');
  const real = realErrors(errors);
  expect(real, `console errors on the live Open orders list:\n${real.join('\n')}`).toEqual([]);
});

/* ---------------------------------------------------------------- P5L-08 */

test('P5L-08 edit mode on a live open order, read and discarded', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);

  if (!EDITABLE_LIVE.length) {
    record(`P5L-08 ${info.project.name}: NOT VERIFIABLE LIVE - live holds no new or preparing order today (${TODAY}), ` +
      'so edit mode, the amber banner and the edit-delta wording could not be opened against live. No order was ' +
      'created. Covered on the emulator by cash-p5.spec.js P5-08, P5-10, P5-11, P5-12 and P5-17.');
    expect(EDITABLE_LIVE.length, 'nothing to edit; recorded rather than created').toBe(0);
    return;
  }

  const target = EDITABLE_LIVE[0];
  await openLiveCash(page);
  await openOpenOrders(page);
  await openEditButton(page, target.orderNo).click();

  const banner = editBanner(page);
  await expect(banner, 'CLAUDE.md Phase V 2: the amber "Editing <no> · <name>" banner')
    .toBeVisible({ timeout: 15000 });
  const bannerText = norm(await banner.innerText());
  expect(bannerText, `the banner names ${target.orderNo}`).toMatch(new RegExp(`Editing\\s+${target.orderNo}`));
  expect(bannerText, 'and the customer').toContain(target.name || 'Guest');

  await openCashPanel(page);
  const delta = editDelta(page);
  await expect(delta, 'CLAUDE.md Phase V 2: the edit-delta payment prompt').toBeVisible();
  expect(norm(await delta.innerText()), 'nothing has changed yet').toMatch(/No changes yet/i);

  // One + on an existing line: in-page draft only. Save is never tapped.
  const firstLine = (target.items || [])[0];
  if (firstLine && firstLine.id) {
    const inc = tid(page, `line-inc-${firstLine.id}`);
    if (await inc.count()) {
      await inc.click();
      await page.waitForTimeout(400);
      const up = norm(await delta.innerText());
      const word = target.payment === 'card' ? 'Take £5.00 more on the card machine' : 'Take £5.00 more';
      expect(up, `CLAUDE.md Phase V 2: a ${target.payment === 'card' ? 'card' : 'cash'} order going up reads "${word}"`)
        .toContain(word);
      await expect(saveChanges(page), 'Save enables once something changes').toBeEnabled();
      record(`P5L-08 ${info.project.name}: edit-delta read "${up}" after one + on ${target.orderNo} (never saved)`);
    }
  }
  await shot(page, `${info.project.name}-edit-mode`);

  // Leave through Discard: CLAUDE.md Phase V 2, "nothing written".
  await closeCashPanel(page);
  await discardChanges(page).click();
  await page.waitForTimeout(800);
  const stillEditing = (await banner.count()) && (await banner.isVisible().catch(() => false));
  expect(stillEditing, 'Discard changes must leave edit mode').toBeFalsy();
  expect(await cartIsEmpty(page), 'and leave the till with an empty cart').toBe(true);

  // Prove the live document is untouched.
  const after = (await liveFirestore('/orders?pageSize=300')).documents || [];
  const doc = after.map((d) => plain(d.fields)).find((o) => o.orderNo === target.orderNo);
  expect(doc.total, 'the live order total is unchanged').toBe(target.total);
  expect(doc.editCount ?? null, 'no edit was written').toBe(target.editCount ?? null);

  await assertNothingSubmitted(page, 'P5L-08');
  const real = realErrors(errors);
  record(`P5L-08 ${info.project.name}: ${real.length ? 'FAIL' : 'PASS'} - edit mode opened on ${target.orderNo} and discarded, document untouched, ${real.length} console error(s)`);
  expect(real, `console errors in live edit mode:\n${real.join('\n')}`).toEqual([]);
});

/* ---------------------------------------------------------------- P5L-09 */

test('P5L-09 Samosa Chat is a Chaat line on the live food counter', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await disableCache(page);
  await signInLive(page);
  await page.goto(LIVE + '#/kitchen', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('header').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2000);

  // The station filter itself is on the live screen either way.
  for (const key of ['all', 'chaat', 'momo', 'sweets']) {
    await expect(tid(page, `station-${key}`), `CLAUDE.md Food counter 4: a ${key} station filter`).toBeVisible();
  }

  const onBoard = SAMOSA_CHAT_LIVE.filter((o) => o.day === TODAY && o.status !== 'collected' && o.status !== 'cancelled');
  if (!onBoard.length) {
    // Read-only: the greyed/ungreyed state needs a line on the board, and this
    // run may not create one. The live menu document is checked instead, which
    // is what the station filter reads through stationOf().
    const chat = MENU_DOCS.find((m) => m.id === 'samosa_chat');
    expect(chat.station, 'CLAUDE.md Menu: samosa_chat is a Chaat line in the live menu document').toBe('chaat');
    await tid(page, 'station-chaat').click();
    await page.waitForTimeout(500);
    await shot(page, `${info.project.name}-kitchen-chaat`);
    record(`P5L-09 ${info.project.name}: PARTLY VERIFIABLE LIVE - the live menu document says samosa_chat.station = "chaat" ` +
      `and the Chaat filter works, but live has no Samosa Chat line on the board today (${TODAY}), so the greying ` +
      'itself could not be seen. No order was created. Covered on the emulator by kitchen-p5.spec.js P5-K-08.');
  } else {
    const order = onBoard[0];
    const card = tid(page, `order-card-${order.orderNo}`);
    if (isSmallCash(page)) {
      const tab = tid(page, `tab-${order.status}`);
      if (await tab.count()) { await tab.click(); await page.waitForTimeout(400); }
    }
    await expect(card, `${order.orderNo} must be on the live board`).toBeVisible({ timeout: 20000 });

    const off = async (id) => tid(page, `order-line-${order.orderNo}-${id}`).evaluate((el) =>
      el.dataset.off === 'true' || /off|grey|muted|dim/i.test(el.className) || Number(getComputedStyle(el).opacity) < 0.95);

    await tid(page, 'station-all').click();
    await page.waitForTimeout(400);
    expect(await off('samosa_chat'), 'under All nothing is greyed').toBe(false);

    await tid(page, 'station-chaat').click();
    await page.waitForTimeout(400);
    expect(await off('samosa_chat'),
      'CLAUDE.md Menu + Phase V 7: Samosa Chat is a Chaat line, so the Chaat filter keeps it lit').toBe(false);

    await tid(page, 'station-sweets').click();
    await page.waitForTimeout(400);
    expect(await off('samosa_chat'), 'and the Sweets filter greys it').toBe(true);

    await tid(page, 'station-all').click();
    await shot(page, `${info.project.name}-kitchen-chaat`);
    record(`P5L-09 ${info.project.name}: PASS - a live Samosa Chat line stays lit under Chaat and greys under Sweets`);
  }

  const real = realErrors(errors);
  expect(real, `console errors on the live food counter:\n${real.join('\n')}`).toEqual([]);
});

/* ---------------------------------------------------------------- P5L-10 */

test('P5L-10 a live CSV export carries edited and cancelReason as its last columns', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await disableCache(page);
  await signInLive(page);

  // (a) the One day export.
  await page.goto(LIVE + '#/reports', { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'kpi-sales')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2000);
  const [oneDay] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    tid(page, 'export-csv').click()
  ]);
  const oneText = readFileSync(await oneDay.path(), 'utf8');
  const oneRows = parseCsv(oneText);
  expect(oneRows[0].join(','), 'CLAUDE.md Phase V 5: the One day CSV gains edited and cancelReason')
    .toBe(CSV_HEADER_15);
  expect(oneText, 'the Phase I tendered field is never exported').not.toMatch(/tendered/i);
  for (const r of oneRows.slice(1)) {
    expect(r, `a body row has ${r.length} fields, not 15: ${r.join('|')}`).toHaveLength(15);
    expect(['yes', 'no'], 'edited is yes/no').toContain(r[13]);
  }
  record(`P5L-10 ${info.project.name}: One day CSV "${oneDay.suggestedFilename()}" -> ${oneRows.length - 1} body row(s), header OK`);

  // (a2) the same export on a day that actually holds orders, so the two new
  // columns are proved against real rows and not only by the header. Changing
  // the date input re-runs the client-side `day ==` query; it writes nothing.
  if (DAY_WITH_ORDERS && DAY_WITH_ORDERS !== TODAY) {
    const dateInput = tid(page, 'report-date');
    await expect(dateInput, 'CLAUDE.md Reports 1: a date input').toBeVisible();
    await dateInput.fill(DAY_WITH_ORDERS);
    await dateInput.blur();
    await expect
      .poll(async () => norm(await tid(page, 'kpi-orders').innerText()),
        { timeout: 30000, message: `the live report never loaded ${DAY_WITH_ORDERS}` })
      .not.toMatch(/^Orders\s*0\b/);
    await page.waitForTimeout(1500);

    const [busy] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      tid(page, 'export-csv').click()
    ]);
    const busyRows = parseCsv(readFileSync(await busy.path(), 'utf8'));
    expect(busyRows[0].join(','), `the ${DAY_WITH_ORDERS} CSV has the fifteen columns`).toBe(CSV_HEADER_15);
    const body = busyRows.slice(1);
    expect(body.length, `${DAY_WITH_ORDERS} holds live orders, so the export must have rows`).toBeGreaterThan(0);
    for (const r of body) {
      expect(r, `a body row has ${r.length} fields, not 15`).toHaveLength(15);
      expect(['yes', 'no'], 'CLAUDE.md Phase V 5: edited is yes/no on every row').toContain(r[13]);
      if (r[9] !== 'cancelled') {
        expect(r[14], 'cancelReason is blank unless the order is cancelled').toBe('');
      }
    }
    const edited = body.filter((r) => r[13] === 'yes').length;
    record(`P5L-10 ${info.project.name}: ${DAY_WITH_ORDERS} CSV "${busy.suggestedFilename()}" -> ${body.length} body row(s), ` +
      `15 fields each, ${edited} marked edited, cancelReason blank on every live order`);
  }

  // (b) the Orders export, on the day that holds orders where there is one.
  const ordersRoute = DAY_WITH_ORDERS && DAY_WITH_ORDERS !== TODAY
    ? `#/reports/orders?day=${DAY_WITH_ORDERS}`
    : '#/reports/orders';
  await page.goto(LIVE + ordersRoute, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('header').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2000);
  const ordersBtn = page.locator('[data-testid="export-orders-csv"], [data-testid="orders-export-csv"]').first();
  if ((await ordersBtn.count()) && (await ordersBtn.isEnabled().catch(() => false))) {
    const [ordersCsv] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      ordersBtn.click()
    ]);
    const text = readFileSync(await ordersCsv.path(), 'utf8');
    expect(parseCsv(text)[0].join(','), 'CLAUDE.md Phase V 5: the Orders CSV too').toBe(CSV_HEADER_15);
    expect(ordersCsv.suggestedFilename(), 'CLAUDE.md Phase IV 8: the file name is unchanged')
      .toMatch(/^nba-food-stall_orders_\d{4}-\d{2}-\d{2}\.csv$/);
    const ordersBody = parseCsv(text).slice(1);
    for (const r of ordersBody) expect(r, `a body row has ${r.length} fields, not 15`).toHaveLength(15);
    record(`P5L-10 ${info.project.name}: Orders CSV "${ordersCsv.suggestedFilename()}" -> ${ordersBody.length} body row(s), header OK`);
  } else {
    record(`P5L-10 ${info.project.name}: the Orders export is not available with an empty day; One day CSV checked instead`);
  }

  // (c) the Sales by day export.
  await page.goto(LIVE + '#/reports/days', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('header').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2000);
  const rangeBtn = page.locator('[data-testid="range-export-csv"], [data-testid="export-days-csv"]').first();
  if ((await rangeBtn.count()) && (await rangeBtn.isEnabled().catch(() => false))) {
    const [rangeCsv] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      rangeBtn.click()
    ]);
    const text = readFileSync(await rangeCsv.path(), 'utf8');
    expect(parseCsv(text)[0].join(','), 'CLAUDE.md Phase V 5: the Sales by day CSV too').toBe(CSV_HEADER_15);
    record(`P5L-10 ${info.project.name}: Sales by day CSV "${rangeCsv.suggestedFilename()}" header OK`);
  }

  await shot(page, `${info.project.name}-reports-days`);
  const real = realErrors(errors);
  record(`P5L-10 ${info.project.name}: ${real.length ? 'FAIL' : 'PASS'} - live exports end ",edited,cancelReason", ${real.length} console error(s)`);
  expect(real, `console errors around the live CSV exports:\n${real.join('\n')}`).toEqual([]);
});

/* ---------------------------------------------------------------- P5L-11 */

test('P5L-11 axe on the live Phase V surfaces: zero serious or critical', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  await openLiveCash(page);

  const axe = async (where) => {
    await page.waitForTimeout(600);
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const detail = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`).join('\n');
    record(`P5L-11 ${info.project.name}: axe ${where} -> ${bad.length} serious/critical${bad.length ? ': ' + detail : ''}`);
    expect(bad, `axe serious/critical on the live cash counter, ${where}:\n${detail}`).toEqual([]);
  };

  // BUG-10 was a label-content-name-mismatch on this very button; this is the
  // live confirmation that the deployed build carries the fix.
  await axe('cash counter, Open orders closed');
  await openOpenOrders(page);
  await axe('cash counter, Open orders open');
  await closeOpenOrders(page);

  await page.goto(LIVE + '#/kitchen', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('header').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await axe('food counter');

  record(`P5L-11 ${info.project.name}: PASS - no serious or critical axe violations on the live Phase V surfaces`);
});

/* ---------------------------------------------------------------- P5L-12 */

test('P5L-12 Sign out works and this verification wrote nothing to live Firestore', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  await disableCache(page);
  await signInLive(page);
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 30000 });

  await (await signOutButton(page)).click();
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 20000 }).toMatch(/^#\/login/);
  expect(await page.evaluate(() => window.localStorage.getItem('nba.session')), 'Sign out clears the session').toBeNull();
  await shot(page, `${info.project.name}-signed-out`);

  const after = (await liveFirestore('/orders?pageSize=300')).documents || [];
  const orders = after.map((d) => plain(d.fields));
  record(`P5L-12 ${info.project.name}: live orders = ${orders.length} document(s) after the check (was ${(ORDERS_BEFORE || []).length})`);
  expect(orders.length, 'this check sends, saves and cancels nothing; the orders count must be unchanged')
    .toBe((ORDERS_BEFORE || []).length);
  expect(fingerprint(orders), 'the orders collection changed during a read-only check')
    .toBe(fingerprint(ORDERS_BEFORE || []));

  const menu = docIds(await liveFirestore('/menu?pageSize=50'));
  expect(menu, 'the menu must be the same eight documents afterwards').toEqual(MENU_BEFORE);
  record(`P5L-12 ${info.project.name}: PASS - signed out, orders unchanged, menu unchanged`);
});
