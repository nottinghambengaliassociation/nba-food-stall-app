/**
 * H4L-* — Hotfix H4 (v1.3.2) live verification against LIVE_URL.
 * STRICTLY READ-ONLY.
 *
 * Gated: skipped unless LIVE_H4=1, the same style as the other live specs, so
 * `npm run test:e2e` stays offline and deterministic. Run with:
 *
 *   LIVE_H4=1 npx playwright test tests/e2e/live-h4.spec.js \
 *     --project=tablet --project=iphone13
 *
 * WRITE DISCIPLINE. Nothing in this file writes to live Firestore:
 *   - `send-order` is NEVER clicked. Not once, on any viewport.
 *   - No status change, no cancel, no menu or settings write.
 *   - Tapping a till tile mutates the in-page cart only. The cart is local
 *     state that reaches Firestore solely through Send, and every test that
 *     adds items steps them back out again before it finishes. This is the
 *     same precedent set for the H3 live check and logged in DECISIONS.md.
 *   - H4L-00 and H4L-09 bracket the run with a count and a fingerprint of the
 *     `orders` collection, read over the REST API, to prove it.
 *
 * NOT TESTABLE LIVE. CLAUDE.md H4 1 lists four moments when the payment must
 * reset to Card: first load, after Send, after Clear order, and when the cart
 * empties. Three of them are exercised here. **"after Send" cannot be checked
 * against live** without writing an order, which is forbidden on this run, so
 * H4L-07 records that gap explicitly rather than letting it pass unnoticed.
 * It is covered on the emulator by H4-03 and H4-06 in tests/e2e/cash-h4.spec.js.
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
  loginUserField, loginPassField, loginSubmit,
  tid, isSmallCash, openCashPanel, closeCashPanel,
  cashReceivedVisible, selectPayment, quickTender, otherAmount, tenderText
} from './helpers.js';
import { creds } from './creds.js';

const LIVE = process.env.LIVE_URL || 'https://nottinghambengaliassociation.github.io/nba-food-stall-app/';
const C = creds();
const PKG_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;

/** Optional pin from the deploy facts, e.g. EXPECT_BUILD=b03fecd. */
const EXPECT_BUILD = process.env.EXPECT_BUILD || '';

/** scripts/write-version.mjs: a 7-character commit SHA in CI, never "-dirty". */
const CLEAN_BUILD = /^[0-9a-f]{7}$/;
const DATE_SHAPE = /^\d{1,2} [A-Z][a-z]{2} \d{4}$/;

const ROUTES = [
  ['landing', '#/'],
  ['cash', '#/cash'],
  ['kitchen', '#/kitchen'],
  ['reports', '#/reports'],
  ['reports-days', '#/reports/days'],
  ['reports-orders', '#/reports/orders']
];

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

test.skip(!process.env.LIVE_H4, 'set LIVE_H4=1 to run the read-only H4 live check');
test.describe.configure({ mode: 'serial' });

/** Append one line to qa/live-smoke-record.txt. Only ever safe values. */
function record(line) {
  // eslint-disable-next-line no-console
  console.log(`[LIVE-H4] ${line}`);
  try { appendFileSync(resolve(SHOTS, '../live-smoke-record.txt'), line + '\n'); } catch { /* ignore */ }
}

const shot = (page, name, full = true) =>
  page.screenshot({ path: resolve(SHOTS, `live-h4-${name}.png`), fullPage: full });

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
let MENU_BEFORE = null;

/** Sign in with the shared account. Nothing here is logged. */
async function signInLive(page) {
  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  await (await loginSubmit(page)).waitFor({ state: 'visible', timeout: 30000 });
  await (await loginUserField(page)).fill(C.user);
  await (await loginPassField(page)).fill(C.password);
  await (await loginSubmit(page)).click();
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 30000 }).toBe('#/');
}

/** Sign in and land on the live cash counter with the tiles painted. */
async function openLiveCash(page) {
  await signInLive(page);
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(800);
}

/** aria-pressed on both payment buttons, as a pair. */
async function pressed(page) {
  return {
    cash: await tid(page, 'pay-cash').getAttribute('aria-pressed'),
    card: await tid(page, 'pay-card').getAttribute('aria-pressed')
  };
}

/** CLAUDE.md H4 1: the order panel / sheet is on Card with no Cash received. */
async function expectOnCard(page, where) {
  expect(await pressed(page),
    `CLAUDE.md H4 1: ${where}, the order must start with Card selected`
  ).toEqual({ cash: 'false', card: 'true' });
  expect(await cashReceivedVisible(page),
    `CLAUDE.md H4 1-2: ${where}, Card is selected so Cash received must not be on screen`
  ).toBe(false);
}

/** Tap a tile the volunteer's way (closing the H3 sheet first if it covers it). */
async function addLive(page, id, times = 1) {
  await closeCashPanel(page);
  for (let i = 0; i < times; i += 1) {
    await tid(page, `tile-${id}`).click();
    await page.waitForTimeout(120);
  }
}

/**
 * Leave the till exactly as it was found: cart empty, nothing sent.
 * Steps every line down with its - button until the cart is gone.
 */
async function emptyTheCart(page) {
  for (let guard = 0; guard < 40; guard += 1) {
    if (isSmallCash(page)) {
      const bar = tid(page, 'order-bar-open');
      if (!(await bar.count()) || !(await bar.isVisible().catch(() => false))) {
        // Order bar hidden => cart empty (CLAUDE.md H3 3).
        if (!(await tid(page, 'review-sheet').isVisible().catch(() => false))) return true;
      }
    }
    await openCashPanel(page);
    const decs = page.locator('[data-testid^="line-dec-"]');
    const n = await decs.count();
    if (!n) return true;
    await decs.first().click();
    await page.waitForTimeout(180);
  }
  return false;
}

/** True when the cart is empty, judged the way the screen shows it. */
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

/* ------------------------------------------------------------- H4L-00 */

test('H4L-00 the live collections, before anything is opened', async ({}, info) => {
  const body = await liveFirestore('/orders?pageSize=300');
  const orders = (body.documents || []).map((d) => plain(d.fields));
  ORDERS_BEFORE = orders;
  MENU_BEFORE = docIds(await liveFirestore('/menu?pageSize=50'));
  record(`H4L-00 ${info.project.name}: live orders = ${orders.length} document(s), menu = ${MENU_BEFORE.length} document(s) before the check`);
  expect(MENU_BEFORE, 'CLAUDE.md Menu / H3 7: the live menu is the seven H3 items').toHaveLength(7);
});

/* ------------------------------------------------------------- H4L-01 */

test('H4L-01 the deployed version.js carries v1.3.2 and a clean build', async ({}, info) => {
  const src = await (await fetch(LIVE + 'js/version.js')).text();
  const version = (src.match(/APP_VERSION\s*=\s*["']([^"']+)["']/) || [])[1];
  const build = (src.match(/APP_BUILD\s*=\s*["']([^"']+)["']/) || [])[1];
  const date = (src.match(/APP_DATE\s*=\s*["']([^"']+)["']/) || [])[1];
  record(`H4L-01 ${info.project.name}: published js/version.js -> ${version} / ${build} / ${date}`);

  expect(version, 'CLAUDE.md Phase III part 2, 1: package.json is the single source of truth').toBe(PKG_VERSION);
  expect(version, 'CLAUDE.md H4 4: package.json version 1.3.2').toBe('1.3.2');
  expect(build, 'the deployed build must be a clean 7-character SHA').toMatch(CLEAN_BUILD);
  expect(build, 'the deployed build must not be dirty').not.toContain('-dirty');
  expect(date, 'APP_DATE is YYYY-MM-DD').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  if (EXPECT_BUILD) {
    expect(build, `the deploy pinned build ${EXPECT_BUILD}`).toBe(EXPECT_BUILD);
  }
  record(`H4L-01 ${info.project.name}: PASS - v${version}, build ${build}`);
});

/* ------------------------------------------------------------- H4L-02 */

test('H4L-02 the login card shows v1.3.2 with the deployed build', async ({ page }, info) => {
  const errors = attachConsole(page);
  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  const line = tid(page, 'login-version');
  await expect(line, 'CLAUDE.md Phase III part 2, 4: a version line on the login card')
    .toBeVisible({ timeout: 30000 });

  // version.js is imported dynamically (Phase III part 2, 3), so the label is
  // painted "dev" for the moment before the module lands.
  await expect
    .poll(async () => norm(await line.innerText()), { timeout: 20000, message: 'the version line never resolved past "dev"' })
    .not.toMatch(/Version dev/);

  const text = norm(await line.innerText());
  const m = text.match(/^Version\s+(\S+)\s+·\s+build\s+(\S+)\s+·\s+updated\s+(.+)$/);
  expect(m, `the login version line must read "Version x.y.z · build <sha> · updated <date>"; got "${text}"`).toBeTruthy();
  const [, version, build, date] = m;
  expect(version, 'CLAUDE.md H4 4: the live login card reads 1.3.2').toBe(PKG_VERSION);
  expect(build).toMatch(CLEAN_BUILD);
  expect(build).not.toContain('-dirty');
  if (EXPECT_BUILD) expect(build, `the deploy pinned build ${EXPECT_BUILD}`).toBe(EXPECT_BUILD);
  expect(date).toMatch(DATE_SHAPE);

  const title = norm(await line.getAttribute('title'));
  expect(title).toBe(`Version ${version}, build ${build}, updated ${date}`);
  expect(norm(await line.getAttribute('aria-label'))).toBe(title);

  await shot(page, `${info.project.name}-login-version`);
  const real = realErrors(errors);
  record(`H4L-02 ${info.project.name}: PASS - login card reads "Version ${version} · build ${build} · updated ${date}", ${real.length} console error(s)`);
  expect(real, `console errors on #/login:\n${real.join('\n')}`).toEqual([]);
});

/* ------------------------------------------------------------- H4L-03 */

test('H4L-03 signed in, every route loads clean, Online, with the v1.3.2 label', async ({ page }, info) => {
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
    // the small cash counter (CLAUDE.md H3 1).
    if (route === '#/cash' && isSmallCash(page)) {
      await tid(page, 'menu-button').click();
      await expect(tid(page, 'app-menu')).toBeVisible();
      const inMenu = tid(page, 'app-menu').locator('[data-testid="app-version"]');
      await expect(inMenu).toBeVisible();
      expect(norm(await inMenu.innerText()), `${route}: the ☰ version line`).toContain('v' + PKG_VERSION);
      await shot(page, `${info.project.name}-cash-menu-version`);
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
      if (route === '#/') await shot(page, `${info.project.name}-header-version`);
    }
    record(`H4L-03 ${info.project.name}: ${route} loaded signed in, pill "${norm(await pill.innerText())}"`);
  }

  const real = realErrors(errors);
  record(`H4L-03 ${info.project.name}: ${real.length ? 'FAIL' : 'PASS'} - ${ROUTES.length} routes signed in, v${PKG_VERSION} everywhere, ${real.length} console error(s)${real.length ? ': ' + real.join(' | ') : ''}`);
  expect(real, `console errors across the signed-in routes:\n${real.join('\n')}`).toEqual([]);
});

/* ------------------------------------------------------------- H4L-04 */

test('H4L-04 the live cash counter starts on Card with no Cash received', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await openLiveCash(page);

  if (!isSmallCash(page)) {
    // The tablet panel is always on screen, so the toggle is readable before
    // a single tile is tapped (CLAUDE.md H4 1, "on first load").
    await expectOnCard(page, 'on first load of the live till with an empty cart');
    await shot(page, `${info.project.name}-cash-first-load-card`);
  }

  // And with an order in hand. Tiles are local state only; the cart is emptied
  // again at the end of the test and no order is ever sent.
  await addLive(page, 'fuchka', 3);
  await openCashPanel(page);
  await expect(tid(page, 'order-total')).toContainText('£15.00', { timeout: 15000 });
  await expectOnCard(page, 'on first load of the live till with items in the cart');

  const onScreen = norm(await page.locator('body').innerText());
  expect(onScreen, 'with Card selected nothing of the Cash received block is visible')
    .not.toMatch(/Cash received/i);
  await shot(page, `${info.project.name}-cash-cart-card`);

  await emptyTheCart(page);
  expect(await cartIsEmpty(page), 'the live till must be left with an empty cart').toBe(true);

  const real = realErrors(errors);
  record(`H4L-04 ${info.project.name}: ${real.length ? 'FAIL' : 'PASS'} - live #/cash opens on Card, no Cash received, ${real.length} console error(s)`);
  expect(real, `console errors on live #/cash:\n${real.join('\n')}`).toEqual([]);
});

/* ------------------------------------------------------------- H4L-05 */

test('H4L-05 Cash reveals the calculator, Card hides and resets it', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await openLiveCash(page);

  await addLive(page, 'fuchka', 3);                 // £15.00
  await openCashPanel(page);
  await expectOnCard(page, 'before any payment tap on the live till');

  // CLAUDE.md H4 2: "Tapping Cash works as today and shows Cash received".
  await selectPayment(page, 'cash');
  expect(await pressed(page), 'tapping Cash selects it').toEqual({ cash: 'true', card: 'false' });
  expect(await cashReceivedVisible(page),
    'CLAUDE.md H4 2: Cash shows Cash received (optional)').toBe(true);
  expect(norm(await tenderText(page))).toMatch(/Cash received/i);
  await shot(page, `${info.project.name}-cash-received-revealed`);

  // Key an amount in, then go back to Card.
  await (await quickTender(page, 2000)).click();
  await page.waitForTimeout(300);
  const changeWord = isSmallCash(page) ? 'Change £5.00' : 'Change to give: £5.00';
  expect(norm(await tenderText(page)), 'the live calculator still works').toContain(changeWord);

  await tid(page, 'pay-card').click();
  await page.waitForTimeout(400);
  expect(await pressed(page), 'tapping Card selects Card').toEqual({ cash: 'false', card: 'true' });
  expect(await cashReceivedVisible(page),
    'CLAUDE.md H4 2: "Tapping Card again hides ... it"').toBe(false);

  // Back to Cash: cleared, not restored.
  await selectPayment(page, 'cash');
  expect(norm(await tenderText(page)), 'CLAUDE.md H4 2: Card "resets it"')
    .not.toMatch(/Change|Short|Enter an amount|Check amount/);
  const stillPressed = await page.locator(
    '[data-testid="tender-exact"], [data-testid="tender-500"], [data-testid="tender-1000"], [data-testid="tender-2000"], [data-testid="tender-5000"]'
  ).evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').length);
  expect(stillPressed, 'no quick cash button may stay selected through Card').toBe(0);

  // The same for a typed Other amount.
  const box = await otherAmount(page);
  await box.fill('17.50');
  await page.waitForTimeout(300);
  expect(norm(await tenderText(page)))
    .toContain(isSmallCash(page) ? 'Change £2.50' : 'Change to give: £2.50');
  await tid(page, 'pay-card').click();
  await page.waitForTimeout(400);
  await selectPayment(page, 'cash');
  expect(await (await otherAmount(page)).inputValue(),
    'CLAUDE.md H4 2: Card resets the Other amount too').toBe('');

  await emptyTheCart(page);
  expect(await cartIsEmpty(page), 'the live till must be left with an empty cart').toBe(true);

  const real = realErrors(errors);
  record(`H4L-05 ${info.project.name}: ${real.length ? 'FAIL' : 'PASS'} - Cash reveals, Card hides and resets, ${real.length} console error(s)`);
  expect(real, `console errors on the live payment toggle:\n${real.join('\n')}`).toEqual([]);
});

/* ------------------------------------------------------------- H4L-06 */

test('H4L-06 the live Review & send sheet opens on Card with no calculator', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  test.skip(!isSmallCash(page), 'CLAUDE.md H4 1 "the phone Review & send sheet"; this is the tablet panel');
  const errors = attachConsole(page);
  await openLiveCash(page);

  await addLive(page, 'fuchka', 2);
  await addLive(page, 'momo', 1);
  const bar = tid(page, 'order-bar-open');
  await expect(bar, 'CLAUDE.md H3 3: the order bar shows once the cart has items').toBeVisible({ timeout: 15000 });
  expect(norm(await bar.innerText()), 'the order bar counts the cart').toMatch(/3 items/);
  await bar.click();
  await expect(tid(page, 'review-sheet')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(400);

  await expectOnCard(page, 'when the live sheet first opens');
  const sheetText = norm(await tid(page, 'review-sheet').innerText());
  expect(sheetText, 'CLAUDE.md H4 1: the sheet opens on Card, so no calculator')
    .not.toMatch(/Cash received/i);
  // Send is on screen and untouched — this check never clicks it.
  await expect(tid(page, 'send-order'), 'the pinned Send footer (CLAUDE.md H3 4)').toBeVisible();
  await shot(page, `${info.project.name}-sheet-card-default`, false);

  await emptyTheCart(page);
  expect(await cartIsEmpty(page), 'the live till must be left with an empty cart').toBe(true);

  const real = realErrors(errors);
  record(`H4L-06 ${info.project.name}: ${real.length ? 'FAIL' : 'PASS'} - the live sheet opens on Card, ${real.length} console error(s)`);
  expect(real, `console errors on the live sheet:\n${real.join('\n')}`).toEqual([]);
});

/* ------------------------------------------------------------- H4L-07 */

test('H4L-07 Clear order puts the live panel back on Card', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  test.skip(isSmallCash(page), 'CLAUDE.md H3 4: the phone sheet has no Clear order control; H4L-08 covers it');
  await openLiveCash(page);

  await addLive(page, 'fuchka', 2);
  await openCashPanel(page);
  await selectPayment(page, 'cash');
  await (await quickTender(page, 5000)).click();
  await page.waitForTimeout(300);
  expect(await pressed(page), 'Cash is selected before Clear order').toEqual({ cash: 'true', card: 'false' });

  const clear = tid(page, 'clear-order');
  await expect(clear, 'CLAUDE.md H4 1 names "after Clear order"').toBeVisible({ timeout: 10000 });
  await clear.click();
  await page.waitForTimeout(600);
  await expectOnCard(page, 'the moment Clear order empties the live panel');

  await addLive(page, 'momo', 1);
  await openCashPanel(page);
  await expectOnCard(page, 'on the live order built after Clear order');
  await shot(page, `${info.project.name}-cash-after-clear-card`);

  await emptyTheCart(page);
  expect(await cartIsEmpty(page), 'the live till must be left with an empty cart').toBe(true);
  record(`H4L-07 ${info.project.name}: PASS - Clear order resets the live panel to Card`);
});

/* ------------------------------------------------------------- H4L-08 */

test('H4L-08 stepping the live cart down to empty returns the payment to Card', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  await openLiveCash(page);

  await addLive(page, 'momo', 1);
  await openCashPanel(page);
  await selectPayment(page, 'cash');
  await (await quickTender(page, 1000)).click();
  await page.waitForTimeout(300);
  expect(await pressed(page), 'Cash is selected before the cart empties').toEqual({ cash: 'true', card: 'false' });

  // The last - tap empties the cart (and, below 700 px, closes the sheet).
  await tid(page, 'line-dec-momo').click();
  await page.waitForTimeout(700);
  if (isSmallCash(page)) {
    await expect(tid(page, 'review-sheet'), 'CLAUDE.md H3 4: removing the last item closes the sheet')
      .toBeHidden({ timeout: 10000 });
  } else {
    await expect(tid(page, 'order-total')).toContainText('£0.00', { timeout: 10000 });
    await expectOnCard(page, 'as soon as the live cart empties');
  }

  // Next order: Card again (CLAUDE.md H4 1, "when the cart empties").
  await addLive(page, 'chat', 1);
  await openCashPanel(page);
  await expectOnCard(page, 'on the live order built after the cart emptied');
  await shot(page, `${info.project.name}-cash-after-empty-card`, !isSmallCash(page));

  await emptyTheCart(page);
  expect(await cartIsEmpty(page), 'the live till must be left with an empty cart').toBe(true);
  record(`H4L-08 ${info.project.name}: PASS - emptying the live cart with the - stepper resets to Card`);
});

/* ------------------------------------------------------------- H4L-09 */

test('H4L-09 the "after Send" reset is not verifiable live, and is recorded as such', async ({}, info) => {
  // CLAUDE.md H4 1 lists four reset moments. Three are checked above against
  // the live build (first load H4L-04, after Clear order H4L-07, cart empties
  // H4L-08). The fourth, "after Send", would require writing a real order to
  // live Firestore, which this run forbids. Stating it here rather than
  // quietly omitting it: the gap is deliberate and it is covered elsewhere.
  const covered = 'tests/e2e/cash-h4.spec.js H4-03 (tablet/phone panel) and H4-06 (phone sheet), on the emulator';
  record(`H4L-09 ${info.project.name}: NOT VERIFIABLE LIVE - CLAUDE.md H4 1 "after Send" needs an order write; covered by ${covered}`);
  expect(covered, 'the after-Send reset must have emulator coverage to fall back on').toContain('H4-03');
});

/* ------------------------------------------------------------- H4L-10 */

test('H4L-10 nothing was written to live Firestore', async ({}, info) => {
  const body = await liveFirestore('/orders?pageSize=300');
  const after = (body.documents || []).map((d) => plain(d.fields));
  record(`H4L-10 ${info.project.name}: live orders = ${after.length} document(s) after the check (was ${(ORDERS_BEFORE || []).length})`);
  expect(after.length, 'this check sends no order; the orders count must be unchanged')
    .toBe((ORDERS_BEFORE || []).length);
  expect(fingerprint(after), 'the orders collection changed during a read-only check')
    .toBe(fingerprint(ORDERS_BEFORE || []));

  const menu = docIds(await liveFirestore('/menu?pageSize=50'));
  expect(menu, 'the menu must be the same documents afterwards').toEqual(MENU_BEFORE);
  record(`H4L-10 ${info.project.name}: PASS - orders unchanged, menu unchanged`);
});
