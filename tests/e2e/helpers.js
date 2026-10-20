// Shared helpers for the e2e suite. Everything here talks to the Firestore
// emulator over its REST API, or to the app through data-testid selectors
// listed in .claude/agents/neo.md.
import { expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SHOTS = resolve(ROOT, 'qa/screenshots');
export const EMU = 'http://127.0.0.1:8080';
export const PROJECT = 'demo-food-stall';
export const DOCS = `${EMU}/v1/projects/${PROJECT}/databases/(default)/documents`;

mkdirSync(SHOTS, { recursive: true });

/* ------------------------------------------------------------- emulator */

/**
 * fetch with a retry window: the emulator is shared with whoever else is
 * running `npm run test:e2e` on this machine and can restart under us.
 */
async function emuFetch(url, init, { timeout = 30000 } = {}) {
  const deadline = Date.now() + timeout;
  let lastErr;
  for (;;) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      if (Date.now() > deadline) throw lastErr;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/**
 * Empty the emulator and prove it stayed empty.
 *
 * A context that is still closing can flush a queued write a moment after the
 * DELETE lands, which used to leave a stale order behind and make the next
 * test read two documents with the same order number. So: delete, wait, read,
 * and only return once `orders` comes back empty TWICE in a row.
 */
export async function clearFirestore() {
  const wipe = async () => {
    const res = await emuFetch(
      `${EMU}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
      { method: 'DELETE' }
    );
    if (!res.ok) throw new Error(`Could not clear Firestore emulator: ${res.status}`);
  };

  await wipe();
  const deadline = Date.now() + 12000;
  let cleanReads = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 250));
    const left = await readCollection('orders');
    if (!left.length) {
      if (++cleanReads >= 2) return;
      continue;
    }
    cleanReads = 0;
    if (Date.now() > deadline) {
      throw new Error(
        'Firestore emulator would not stay empty: ' +
        JSON.stringify(left.map((o) => ({ orderNo: o.orderNo, status: o.status })))
      );
    }
    await wipe();
  }
}

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toValue(v);
  return fields;
}

function fromValue(v) {
  if (!v || typeof v !== 'object') return v;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return v;
}

function fromFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromValue(v);
  return out;
}

/** Write a document straight into the emulator, bypassing the UI. */
export async function seedDoc(collection, data, id) {
  const url = `${DOCS}/${collection}` + (id ? `?documentId=${encodeURIComponent(id)}` : '');
  const res = await emuFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(data) })
  });
  if (!res.ok) throw new Error(`seedDoc ${collection} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Read a whole collection back out of the emulator. */
export async function readCollection(collection) {
  const res = await emuFetch(`${DOCS}/${collection}?pageSize=300`).catch(() => null);
  if (!res || !res.ok) return [];
  const body = await res.json();
  return (body.documents || []).map((d) => ({
    _id: d.name.split('/').pop(),
    ...fromFields(d.fields || {})
  }));
}

/** Poll the emulator until a predicate over the orders collection holds. */
export async function waitForOrders(predicate, { timeout = 15000, label = 'orders' } = {}) {
  const deadline = Date.now() + timeout;
  let last = [];
  while (Date.now() < deadline) {
    last = await readCollection('orders');
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${label}. Orders now: ${JSON.stringify(last.map((o) => ({ orderNo: o.orderNo, status: o.status })))}`);
}

/* ----------------------------------------------------------------- dates */

/** Europe/London YYYY-MM-DD, the same rule the app uses for `day`. */
export function londonDay(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}`;
}

/** Epoch ms for a Europe/London wall-clock time today. */
export function londonTimeToday(hour, minute = 0) {
  const day = londonDay();
  const [y, m, d] = day.split('-').map(Number);
  // Work out London's UTC offset for that calendar day at midday.
  const probe = Date.UTC(y, m - 1, d, 12, 0);
  const local = new Date(probe).toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false, hour: '2-digit' });
  const offsetHours = Number(local.slice(0, 2)) - 12;
  return Date.UTC(y, m - 1, d, hour - offsetHours, minute);
}

/* ------------------------------------------------------------------- app */

/**
 * Open a route with a clean localStorage and a console-error collector.
 * Returns the array of console errors seen (kept up to date as the test runs).
 */
export async function openApp(page, route = '#/') {
  const errors = attachConsole(page);
  // Clear once per tab, not on every reload: C-14 and L-04 depend on
  // localStorage surviving a reload the way it does on a real till.
  // The signed-in session seeded by tests/e2e/session.js survives the clear:
  // login gates every route (CLAUDE.md -> Login and sign out 6), so wiping it
  // here would bounce every Phase I test to #/login.
  await page.addInitScript(() => {
    try {
      if (!window.sessionStorage.getItem('__qa_cleared')) {
        const session = window.localStorage.getItem('nba.session');
        window.localStorage.clear();
        if (session !== null) window.localStorage.setItem('nba.session', session);
        window.sessionStorage.setItem('__qa_cleared', '1');
      }
    } catch { /* ignore */ }
  });
  await page.goto('/' + route);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
  return errors;
}

/**
 * Set the till letter through the landing-page control, the way a volunteer
 * would (CLAUDE.md: "Till letter is set on the landing page (default A)").
 */
export async function setTill(page, letter) {
  await gotoRoute(page, '#/');
  const control = tid(page, 'till-letter');
  await expect(control).toBeVisible();
  const tag = await control.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') await control.selectOption(letter);
  else if (tag === 'input') { await control.fill(letter); await control.blur(); }
  else await control.click();
  await page.waitForTimeout(200);
}

/** Navigate inside the SPA without reloading localStorage. */
export async function gotoRoute(page, route) {
  await page.evaluate((r) => { window.location.hash = r.replace(/^#?/, '#'); }, route.replace(/^#/, ''));
  await page.waitForTimeout(250);
}

/** Collect console errors and uncaught page exceptions. */
export function attachConsole(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/**
 * Console noise that is the emulator or the test harness talking, not an app bug.
 * Everything else is reported.
 */
const IGNORE = [
  /Failed to load resource.*favicon/i,
  /\[Violation\]/i,
  /WebSocket connection to .*8080/i,
  /net::ERR_INTERNET_DISCONNECTED/i,
  /net::ERR_NETWORK_CHANGED/i,
  /net::ERR_NAME_NOT_RESOLVED.*gstatic/i,
  /@firebase\/firestore.*(could not reach|backend didn't respond|transport errored|offline)/i,
  /Failed to load resource: net::ERR_FAILED/i,
  /download the React DevTools/i
];

export function realErrors(errors) {
  return errors.filter((e) => !IGNORE.some((re) => re.test(e)));
}

export async function expectNoConsoleErrors(errors, where) {
  const real = realErrors(errors);
  expect(real, `console errors on ${where}:\n${real.join('\n')}`).toEqual([]);
}

/* ------------------------------------------------------------ interaction */

export const tid = (page, name) => page.locator(`[data-testid="${name}"]`);

/* ------------------------------------------- Hotfix H3: the small cash till
 * CLAUDE.md -> "Hotfix H3: phone cash counter layout (v1.3.1)" replaces the
 * always-open order panel with an order bar plus a "Review & send" sheet on
 * every screen narrower than 700 px. The order controls (name, cart lines,
 * payment, cash received, Send) live inside that sheet.
 *
 * These helpers make a test say what it means — "put an item in the cart",
 * "open the order panel" — at either size, so the cross-size specs keep one
 * code path. 700 px is the breakpoint from CLAUDE.md -> Design.
 */

/** Viewport width in CSS px (1280 if Playwright has no viewport set). */
export function viewportWidth(page) {
  const v = page.viewportSize();
  return v && v.width ? v.width : 1280;
}

/** True when the cash counter is in its H3 small layout. */
export const isSmallCash = (page) => viewportWidth(page) < 700;

const visible = async (locator) => {
  if (!(await locator.count())) return false;
  return locator.isVisible().catch(() => false);
};

/**
 * Make the order controls reachable. Tablet: they are always on screen, so
 * this is a no-op. Small: open the Review & send sheet from the order bar.
 * The cart must already hold at least one item (the bar is hidden when empty,
 * CLAUDE.md H3 3).
 */
export async function openCashPanel(page) {
  if (!isSmallCash(page)) return;
  if (await visible(tid(page, 'review-sheet'))) return;
  const bar = tid(page, 'order-bar-open');
  await expect(bar, 'CLAUDE.md H3 3: the order bar opens the Review & send sheet').toBeVisible({ timeout: 15000 });
  await bar.click();
  await expect(tid(page, 'review-sheet')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(200);
}

/** Close the sheet with its Add more button, if it is open. */
export async function closeCashPanel(page) {
  if (!isSmallCash(page)) return;
  if (!(await visible(tid(page, 'review-sheet')))) return;
  const addMore = tid(page, 'sheet-add-more');
  if (await visible(addMore)) {
    await addMore.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await expect(tid(page, 'review-sheet')).toBeHidden({ timeout: 10000 });
  await page.waitForTimeout(150);
}

/** Tap n times on a menu tile (closing the H3 sheet first if it covers them). */
export async function addItem(page, itemId, times = 1) {
  await closeCashPanel(page);
  for (let i = 0; i < times; i++) {
    await tid(page, `tile-${itemId}`).click();
    await page.waitForTimeout(60);
  }
}

/**
 * Build and send an order through the UI.
 * Returns the order number read back off the toast.
 */
export async function placeOrder(page, { items = {}, name = '', payment = 'cash', tender = null } = {}) {
  for (const [id, qty] of Object.entries(items)) await addItem(page, id, qty);
  await openCashPanel(page);
  if (name) await tid(page, 'customer-name').fill(name);
  // Hotfix H4 (v1.3.2): Card is the default, so the cash path is chosen
  // explicitly here. `selectPayment` is a no-op when it is already selected.
  if (payment === 'card') await selectPayment(page, 'card');
  else {
    await selectPayment(page, 'cash');
    // Phase II: `tender` is a pence amount or 'exact' for a quick button, or
    // a string like '17.50' typed into the Other amount box.
    if (tender !== null && tender !== undefined && tender !== '') {
      if (typeof tender === 'number' || tender === 'exact') {
        await (await quickTender(page, tender)).click();
      } else {
        await (await otherAmount(page)).fill(String(tender));
      }
      await page.waitForTimeout(120);
    }
  }
  await tid(page, 'send-order').click();
  const toast = tid(page, 'order-toast');
  await expect(toast).toBeVisible({ timeout: 10000 });
  const text = (await toast.innerText()) || '';
  const match = text.match(/[A-Z]-\d{3}/);
  return match ? match[0] : null;
}

/**
 * Height of an element in CSS pixels.
 * The screens re-render on every Firestore snapshot, so a node can detach
 * between the visibility check and the measurement; retry briefly.
 */
export async function heightOf(locator) {
  for (let i = 0; i < 12; i++) {
    const box = await locator.boundingBox().catch(() => null);
    if (box && box.height > 0) return box.height;
    await locator.page().waitForTimeout(150);
  }
  const box = await locator.boundingBox().catch(() => null);
  return box ? box.height : 0;
}

/** Width and height, with the same retry. */
export async function boxOf(locator) {
  for (let i = 0; i < 12; i++) {
    const box = await locator.boundingBox().catch(() => null);
    if (box && box.height > 0 && box.width > 0) return box;
    await locator.page().waitForTimeout(150);
  }
  return locator.boundingBox().catch(() => null);
}

/* ---------------------------------------------------------- screenshots */

export async function shot(page, project, screen, state) {
  await page.waitForTimeout(400);
  // The phone cash panel is a sticky sheet that scrolls inside itself; a
  // fullPage capture would clip whatever it has scrolled past. Reset every
  // inner scroller to the top so the screenshot shows the panel from its start.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) el.scrollTop = 0;
    }
  });
  await page.waitForTimeout(200);
  await page.screenshot({
    path: resolve(SHOTS, `${project}-${screen}-${state}.png`),
    fullPage: true
  });
}

/* ---------------------------------------------------------- order fixture */

const P = 500;
const line = (id, name, qty) => ({ id, name, qty, price: P });

/**
 * The scripted report day from qa/test-plan.md section 8, pinned to today's
 * London date so the reports screen picks it up by default.
 */
export function reportFixture(day = londonDay()) {
  const t = (h, m) => londonTimeToday(h, m);
  return [
    {
      orderNo: 'A-001', name: 'Priya', till: 'A', day,
      items: [line('fuchka', 'Fuchka / Gol Gappa', 2)],
      total: 1000, payment: 'cash', status: 'collected',
      createdAtMs: t(12, 5), startedAtMs: t(12, 6), readyAtMs: t(12, 7), collectedAtMs: t(12, 8)
    },
    {
      orderNo: 'A-002', name: 'Sam', till: 'A', day,
      items: [line('momo', 'Momo', 1), line('chat', 'Papri Chat', 1)],
      total: 1000, payment: 'card', status: 'collected',
      createdAtMs: t(12, 20), startedAtMs: t(12, 21), readyAtMs: t(12, 25), collectedAtMs: t(12, 26)
    },
    {
      orderNo: 'A-003', name: 'Ahmed', till: 'A', day,
      items: [line('fuchka', 'Fuchka / Gol Gappa', 3)],
      total: 1500, payment: 'cash', status: 'ready',
      createdAtMs: t(12, 40), startedAtMs: t(12, 41), readyAtMs: t(12, 44)
    },
    {
      orderNo: 'A-004', name: 'Lucy', till: 'A', day,
      items: [line('samosa', 'Sweets Box Samosa / Shingara', 1)],
      total: 500, payment: 'card', status: 'collected',
      createdAtMs: t(13, 10), startedAtMs: t(13, 11), readyAtMs: t(13, 13), collectedAtMs: t(13, 14)
    },
    {
      orderNo: 'A-005', name: 'Josh', till: 'A', day,
      items: [line('momo', 'Momo', 4)],
      total: 2000, payment: 'cash', status: 'new',
      createdAtMs: t(13, 40)
    },
    {
      orderNo: 'A-006', name: 'Meera', till: 'A', day,
      items: [line('fountain', 'Chocolate Fountain', 10)],
      total: 5000, payment: 'card', status: 'cancelled',
      createdAtMs: t(13, 20), cancelledAtMs: t(13, 21)
    }
  ];
}

export async function seedReportDay() {
  const fixture = reportFixture();
  for (const o of fixture) await seedDoc('orders', o);
  // Make sure the emulator really holds exactly the fixture before a test reads it.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const got = await readCollection('orders');
    if (got.length === fixture.length) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  const got = await readCollection('orders');
  throw new Error(`seedReportDay expected ${fixture.length} orders, emulator holds ${got.length}: ${got.map((o) => o.orderNo).join(',')}`);
}

/** Minimal RFC4180 parser, shared with the unit suite. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/* ------------------------------------------------- Phase II: locators ----
 * The brief fixes the wording, roles and ARIA of the new controls but
 * .claude/agents/neo.md does not list data-testids for them. These helpers
 * therefore try the testid that follows the existing naming convention first
 * and fall back to the semantics the brief and the mock-ups mandate, so the
 * tests assert the spec rather than one particular markup choice.
 */

/** First of several CSS selectors that matches something, as a locator. */
export async function firstOf(page, selectors, { timeout = 8000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if (await loc.count()) return loc;
    }
    if (Date.now() > deadline) return page.locator(selectors[0]).first();
    await page.waitForTimeout(100);
  }
}

/** Same, but resolves immediately to null when nothing matches. */
export async function anyOf(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.count()) return loc;
  }
  return null;
}

/* --- login screen (CLAUDE.md -> Login and sign out 1) --- */

export const LOGIN_USER_SEL = [
  '[data-testid="login-user"]',
  'input[autocomplete="username"]',
  'input[name="username"]',
  '#user', '#muser'
];
export const LOGIN_PASS_SEL = [
  '[data-testid="login-password"]',
  '[data-testid="login-pass"]',
  'input[autocomplete="current-password"]',
  'input[type="password"]',
  '#pass', '#mpass'
];
export const LOGIN_SUBMIT_SEL = [
  '[data-testid="sign-in"]',
  '[data-testid="login-submit"]',
  'form button[type="submit"]',
  'button[type="submit"]'
];
export const LOGIN_TOGGLE_SEL = [
  '[data-testid="toggle-password"]',
  '[data-testid="login-show"]',
  'button[aria-pressed][type="button"]'
];
export const SIGN_OUT_SEL = [
  'header [data-testid="sign-out"]',
  'header [aria-label="Sign out"]',
  'header button:has-text("Sign out")',
  'header a:has-text("Sign out")',
  '[data-testid="sign-out"]'
];

export const loginUserField = (page) => firstOf(page, LOGIN_USER_SEL);
export const loginPassField = (page) => firstOf(page, LOGIN_PASS_SEL);
export const loginSubmit = (page) => firstOf(page, LOGIN_SUBMIT_SEL);
/**
 * The Sign out control, wherever the screen keeps it.
 *
 * CLAUDE.md Login 7 puts it last on the right of every dark header. Hotfix H3
 * (v1.3.1) gives the cash counter below 700 px a one-row 52 px header and
 * moves Sign out into the ☰ dropdown (H3 1), so on that screen the ☰ is opened
 * first and `menu-signout` is returned.
 */
export async function signOutButton(page) {
  const header = page.locator('header').first().locator(SIGN_OUT_SEL.join(', '));
  if ((await header.count()) && (await header.first().isVisible().catch(() => false))) {
    return header.first();
  }
  const menuButton = tid(page, 'menu-button');
  if ((await menuButton.count()) && (await menuButton.isVisible().catch(() => false))) {
    if ((await menuButton.getAttribute('aria-expanded')) !== 'true') await menuButton.click();
    const item = tid(page, 'menu-signout');
    await expect(item, 'CLAUDE.md H3 1: Sign out lives in the ☰ menu on the small cash counter')
      .toBeVisible({ timeout: 10000 });
    return item;
  }
  return firstOf(page, SIGN_OUT_SEL);
}

/**
 * Sign in through the form. `password` is passed in by the caller, which reads
 * it from .secrets at run time; it is never logged by this helper.
 */
export async function signIn(page, user, password) {
  const u = await loginUserField(page);
  const p = await loginPassField(page);
  await u.fill(user);
  await p.fill(password);
  const submit = await loginSubmit(page);
  await submit.click();
}

/* --- cash received (CLAUDE.md -> Cash counter 3) --- */

const QUICK_GROUP = '[role="group"][aria-label="Quick cash amounts"]';

export const TENDER_OTHER_SEL = [
  '[data-testid="tender-other"]',
  '[data-testid="other-amount"]',
  'input[inputmode="decimal"]',
  '#tother', '#mother'
];
export const TENDER_CLEAR_SEL = [
  '[data-testid="tender-clear"]',
  '[data-testid="clear-tender"]',
  'button:has-text("Clear"):not(:has-text("Clear order"))'
];
export const TENDER_MSG_SEL = [
  '[data-testid="change-due"]',
  '[data-testid="tender-message"]',
  '[role="status"]'
];

/**
 * The Other amount box, revealing it first where it is behind a link.
 * CLAUDE.md H3 4: in the small Review & send sheet the box sits behind an
 * "Other amount" link; on tablet it is always on screen.
 */
export async function otherAmount(page) {
  const direct = page.locator(TENDER_OTHER_SEL.join(', ')).first();
  if ((await direct.count()) && (await direct.isVisible().catch(() => false))) {
    return firstOf(page, TENDER_OTHER_SEL);
  }
  await revealOtherAmount(page);
  return firstOf(page, TENDER_OTHER_SEL);
}

/** Tap the "Other amount" link if there is one and the box is not showing. */
export async function revealOtherAmount(page) {
  const toggle = tid(page, 'tender-other-toggle');
  if (!(await toggle.count())) return false;
  if (!(await toggle.isVisible().catch(() => false))) return false;
  await toggle.click();
  await page.waitForTimeout(200);
  return true;
}

export const tenderMessage = (page) => firstOf(page, TENDER_MSG_SEL);

/** A quick cash button: 'exact' or a pence amount. */
export async function quickTender(page, value) {
  const key = value === 'exact' ? 'exact' : String(value);
  const label = value === 'exact' ? 'Exact' : '£' + Number(value) / 100;
  return firstOf(page, [
    `[data-testid="tender-${key}"]`,
    `${QUICK_GROUP} button:text-is("${label}")`,
    `button:text-is("${label}")`
  ]);
}

/** All five quick buttons, in document order. */
export async function quickTenderButtons(page) {
  const byTestid = page.locator(
    '[data-testid="tender-exact"], [data-testid="tender-500"], [data-testid="tender-1000"], [data-testid="tender-2000"], [data-testid="tender-5000"]'
  );
  if (await byTestid.count()) return byTestid;
  const group = page.locator(`${QUICK_GROUP} button`);
  if (await group.count()) return group;
  return byTestid;
}

/** Whitespace-normalised visible text of the cash-received block, or ''. */
export async function tenderText(page) {
  const block = await anyOf(page, [
    '[data-testid="cash-received"]',
    `${QUICK_GROUP}`,
    '[data-testid="change-due"]'
  ]);
  if (!block) return '';
  const scope = await block.evaluateHandle((el) => {
    // Walk up to the block that holds the label, the buttons and the message.
    let n = el;
    for (let i = 0; i < 4 && n.parentElement; i++) {
      if (/Cash received/i.test(n.textContent || '')) break;
      n = n.parentElement;
    }
    return n;
  });
  const text = await scope.evaluate((el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim());
  return text;
}

/* --- payment toggle (CLAUDE.md -> Hotfix H4: "Card is the default payment") */

/** Every selector the Cash received block can be found by. */
export const CASH_BLOCK_SEL = [
  '[data-testid="cash-received"]',
  '[role="group"][aria-label="Quick cash amounts"]',
  '[data-testid="tender-exact"]',
  '[data-testid="tender-2000"]',
  '[data-testid="tender-other-toggle"]',
  '[data-testid="tender-other"]'
];

/** True when any part of the Cash received block is on screen. */
export async function cashReceivedVisible(page) {
  for (const sel of CASH_BLOCK_SEL) {
    const loc = page.locator(sel).first();
    if (!(await loc.count())) continue;
    if (await loc.isVisible().catch(() => false)) return true;
  }
  return false;
}

/**
 * Choose Cash or Card in the order panel (tablet) or the Review & send sheet.
 *
 * Hotfix H4 (v1.3.2) makes Card the selected payment on every new order, so a
 * test that means to exercise the cash path now has to say so. Tapping an
 * already-selected button would deselect the quick cash amount (CLAUDE.md
 * Cash 3), so this only taps when the button is not already pressed.
 */
export async function selectPayment(page, which) {
  const btn = tid(page, which === 'cash' ? 'pay-cash' : 'pay-card');
  await expect(btn, `the ${which} payment button must be on screen`).toBeVisible({ timeout: 10000 });
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  await expect(btn, `${which} must end up selected`).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
  await page.waitForTimeout(150);
}

/* -------------------------------------------- Phase III: range fixture ----
 * A scripted week for #/reports/days, pinned to the last seven London days so
 * the screen's default range ("Last 7 days ending today") covers it exactly.
 * Five trading days with two quiet days between them, one cancelled order and
 * one Phase I order carrying the legacy `tendered` field.
 * Hand-calculated expectations live in RANGE_EXPECT below and in
 * qa/test-plan.md section 27. The shape matches tests/unit/range-fixtures.js.
 */

/** Today's London day shifted by n days, as YYYY-MM-DD. */
export function londonDayOffset(n, from = londonDay()) {
  const ms = Date.parse(from + 'T00:00:00Z') + Math.round(n) * 86400000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Epoch ms for a Europe/London wall-clock time on any day string. */
export function londonTimeOn(day, hour, minute = 0) {
  const [y, m, d] = day.split('-').map(Number);
  const probe = Date.UTC(y, m - 1, d, 12, 0);
  const local = new Date(probe).toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false, hour: '2-digit' });
  const offsetHours = Number(local.slice(0, 2)) - 12;
  return Date.UTC(y, m - 1, d, hour - offsetHours, minute);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Sun 18 Oct", worked out here rather than taken from logic.js. */
export function dayLabelOf(day) {
  const d = new Date(Date.parse(day + 'T00:00:00Z'));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

export function weekdayOf(day) {
  return WEEKDAYS[new Date(Date.parse(day + 'T00:00:00Z')).getUTCDay()];
}

/** The five trading days and the two quiet ones, newest last. */
export function rangeDays(today = londonDay()) {
  return {
    d0: londonDayOffset(-6, today),
    d1: londonDayOffset(-5, today),
    quietA: londonDayOffset(-4, today),
    d3: londonDayOffset(-3, today),
    d4: londonDayOffset(-2, today),
    quietB: londonDayOffset(-1, today),
    d6: today
  };
}

export function rangeFixture(today = londonDay()) {
  const D = rangeDays(today);
  const t = (day, h, m) => londonTimeOn(day, h, m);
  const l = (id, name, qty) => ({ id, name, qty, price: 500 });
  return [
    { orderNo: 'A-001', name: 'Priya', till: 'A', day: D.d0, items: [l('fuchka', 'Fuchka / Gol Gappa', 2)], total: 1000, payment: 'cash', status: 'collected', createdAtMs: t(D.d0, 11, 0), readyAtMs: t(D.d0, 11, 2) },
    { orderNo: 'A-002', name: 'Sam', till: 'A', day: D.d0, items: [l('momo', 'Momo', 1)], total: 500, payment: 'card', status: 'collected', createdAtMs: t(D.d0, 11, 20), readyAtMs: t(D.d0, 11, 25) },

    { orderNo: 'B-001', name: 'Ahmed', till: 'B', day: D.d1, items: [l('chat', 'Papri Chat', 3)], total: 1500, payment: 'cash', status: 'collected', createdAtMs: t(D.d1, 12, 5), readyAtMs: t(D.d1, 12, 10) },
    { orderNo: 'B-002', name: 'Lucy', till: 'B', day: D.d1, items: [l('sweet_box', 'Sweet Box', 1), l('marshmallow', 'Marshmallow (V)', 1)], total: 1000, payment: 'card', status: 'ready', createdAtMs: t(D.d1, 12, 40), readyAtMs: t(D.d1, 12, 45) },
    { orderNo: 'B-003', name: 'Gone', till: 'B', day: D.d1, items: [l('fuchka', 'Fuchka / Gol Gappa', 2)], total: 1000, payment: 'cash', status: 'cancelled', createdAtMs: t(D.d1, 12, 50), cancelledAtMs: t(D.d1, 12, 51) },

    // The legacy day: retired ids, and a Phase I `tendered` field to be ignored.
    { orderNo: 'A-010', name: 'Meera', till: 'A', day: D.d3, items: [l('samosa', 'Sweets Box Samosa / Shingara', 2)], total: 1000, payment: 'cash', status: 'collected', tendered: 2000, createdAtMs: t(D.d3, 13, 0), readyAtMs: t(D.d3, 13, 4) },
    { orderNo: 'A-011', name: 'Josh', till: 'A', day: D.d3, items: [l('straw', 'Chocolate Strawberry & Marshmallow (V)', 1)], total: 500, payment: 'card', status: 'collected', createdAtMs: t(D.d3, 13, 10), readyAtMs: t(D.d3, 13, 12) },

    { orderNo: 'A-020', name: 'Rina', till: 'A', day: D.d4, items: [l('fuchka', 'Fuchka / Gol Gappa', 10)], total: 5000, payment: 'cash', status: 'collected', createdAtMs: t(D.d4, 14, 0), readyAtMs: t(D.d4, 14, 5) },
    { orderNo: 'A-021', name: 'Dev', till: 'A', day: D.d4, items: [l('momo', 'Momo', 4)], total: 2000, payment: 'card', status: 'collected', createdAtMs: t(D.d4, 14, 40), readyAtMs: t(D.d4, 14, 44) },
    { orderNo: 'A-022', name: 'Kate', till: 'A', day: D.d4, items: [l('fountain', 'Chocolate Fountain', 2)], total: 1000, payment: 'cash', status: 'ready', createdAtMs: t(D.d4, 15, 10), readyAtMs: t(D.d4, 15, 14) },

    { orderNo: 'A-030', name: 'Nina', till: 'A', day: D.d6, items: [l('fuchka', 'Fuchka / Gol Gappa', 1), l('momo', 'Momo', 1), l('chat', 'Papri Chat', 1)], total: 1500, payment: 'cash', status: 'collected', createdAtMs: t(D.d6, 10, 0), readyAtMs: t(D.d6, 10, 3) },
    { orderNo: 'A-031', name: 'Omar', till: 'A', day: D.d6, items: [l('choc_strawberry', 'Chocolate Strawberry', 3)], total: 1500, payment: 'card', status: 'new', createdAtMs: t(D.d6, 10, 20) }
  ];
}

/** Hand-calculated expectations for rangeFixture(). Every figure is a literal. */
export function rangeExpect(today = londonDay()) {
  const D = rangeDays(today);
  return {
    days: D,
    trading: [D.d0, D.d1, D.d3, D.d4, D.d6],
    quiet: [D.quietA, D.quietB],
    rows: [
      { day: D.d0, orders: 2, items: 3, sales: 1500, cash: 1000, card: 500, avgOrder: 750, peak: '11:00–11:30' },
      { day: D.d1, orders: 2, items: 5, sales: 2500, cash: 1500, card: 1000, avgOrder: 1250, peak: '12:00–12:30' },
      { day: D.d3, orders: 2, items: 3, sales: 1500, cash: 1000, card: 500, avgOrder: 750, peak: '13:00–13:30' },
      { day: D.d4, orders: 3, items: 16, sales: 8000, cash: 6000, card: 2000, avgOrder: 2667, peak: '14:00–14:30' },
      { day: D.d6, orders: 2, items: 6, sales: 3000, cash: 1500, card: 1500, avgOrder: 1500, peak: '10:00–10:30' }
    ],
    totals: {
      sales: 16500, orders: 11, items: 33, itemsPerOrder: '3.0',
      cash: 11000, card: 5500, avgOrder: 1500,
      bestDay: D.d4, bestSales: 8000, averagePerDay: 3300, ordersPerDay: 2, tradingDays: 5
    },
    items: [
      { id: 'fuchka', name: 'Fuchka / Gol Gappa', units: { [D.d0]: 2, [D.d1]: 0, [D.d3]: 0, [D.d4]: 10, [D.d6]: 1 }, total: 13, sales: 6500, bestDay: D.d4 },
      { id: 'momo', name: 'Momo', units: { [D.d0]: 1, [D.d1]: 0, [D.d3]: 0, [D.d4]: 4, [D.d6]: 1 }, total: 6, sales: 3000, bestDay: D.d4 },
      { id: 'chat', name: 'Papri Chat', units: { [D.d0]: 0, [D.d1]: 3, [D.d3]: 0, [D.d4]: 0, [D.d6]: 1 }, total: 4, sales: 2000, bestDay: D.d1 },
      { id: 'sweet_box', name: 'Sweet Box', units: { [D.d0]: 0, [D.d1]: 1, [D.d3]: 0, [D.d4]: 0, [D.d6]: 0 }, total: 1, sales: 500, bestDay: D.d1 },
      { id: 'choc_strawberry', name: 'Chocolate Strawberry', units: { [D.d0]: 0, [D.d1]: 0, [D.d3]: 0, [D.d4]: 0, [D.d6]: 3 }, total: 3, sales: 1500, bestDay: D.d6 },
      { id: 'marshmallow', name: 'Marshmallow (V)', units: { [D.d0]: 0, [D.d1]: 1, [D.d3]: 0, [D.d4]: 0, [D.d6]: 0 }, total: 1, sales: 500, bestDay: D.d1 },
      { id: 'fountain', name: 'Chocolate Fountain', units: { [D.d0]: 0, [D.d1]: 0, [D.d3]: 0, [D.d4]: 2, [D.d6]: 0 }, total: 2, sales: 1000, bestDay: D.d4 },
      { id: 'samosa', name: 'Sweets Box Samosa / Shingara', units: { [D.d0]: 0, [D.d1]: 0, [D.d3]: 2, [D.d4]: 0, [D.d6]: 0 }, total: 2, sales: 1000, bestDay: D.d3 },
      { id: 'straw', name: 'Chocolate Strawberry & Marshmallow (V)', units: { [D.d0]: 0, [D.d1]: 0, [D.d3]: 1, [D.d4]: 0, [D.d6]: 0 }, total: 1, sales: 500, bestDay: D.d3 }
    ]
  };
}

/** Seed the scripted range and wait until the emulator really holds it. */
export async function seedRangeDays(today = londonDay()) {
  const fixture = rangeFixture(today);
  for (const o of fixture) await seedDoc('orders', o);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const got = await readCollection('orders');
    if (got.length === fixture.length) return fixture;
    await new Promise((r) => setTimeout(r, 150));
  }
  const got = await readCollection('orders');
  throw new Error(`seedRangeDays expected ${fixture.length} orders, emulator holds ${got.length}`);
}

/** Seed settings/event = { name, from, to } (CLAUDE.md Phase III 2). */
export async function seedEvent(name, from, to) {
  await seedDoc('settings', { name, from, to }, 'event');
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const docs = await readCollection('settings');
    if (docs.some((d) => d._id === 'event')) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('seedEvent: settings/event never appeared in the emulator');
}

/** "£1,234.50" from integer pence, computed here rather than by logic.js. */
export function gbp(pence) {
  const neg = pence < 0 ? '-' : '';
  const abs = Math.abs(Math.round(pence));
  const pounds = Math.floor(abs / 100);
  const pennies = String(abs % 100).padStart(2, '0');
  return `${neg}£${pounds.toLocaleString('en-GB')}.${pennies}`;
}

/** Whitespace-normalised innerText of a locator. */
export async function textOf(locator) {
  return (await locator.innerText()).replace(/\s+/g, ' ').trim();
}

/* --------------------------------------- Phase IV: the orders-list fixture ----
 * A scripted single day for #/reports/orders, pinned to today's London date so
 * the screen's default day covers it exactly. Deliberately contains:
 *   - every status, including one cancelled order (CLAUDE.md Phase IV 3);
 *   - two tills and a cash/card mix (filters);
 *   - two retired-id orders, one of which still carries the Phase I `tendered`
 *     field (Hotfix H1 6, Phase IV 9);
 *   - one order on the previous day, which must never show on today's list
 *     (CLAUDE.md Phase IV 2: `?day=` opens that day).
 * Hand-calculated expectations live in ordersExpect() and in qa/test-plan.md
 * section 32. Every figure there is a literal, not a computation.
 */

export function ordersFixture(day = londonDay()) {
  const t = (h, m) => londonTimeOn(day, h, m);
  const l = (id, name, qty) => ({ id, name, qty, price: 500 });
  const prev = londonDayOffset(-1, day);
  return [
    // Legacy orders: retired menu ids, and A-010 carries the Phase I `tendered`.
    { orderNo: 'A-010', name: 'Josh', till: 'A', day, payment: 'cash', status: 'collected', tendered: 2000,
      items: [l('samosa', 'Sweets Box Samosa / Shingara', 2)], total: 1000,
      createdAtMs: t(9, 30), startedAtMs: t(9, 31), readyAtMs: t(9, 34), collectedAtMs: t(9, 35) },
    { orderNo: 'A-011', name: 'Rina', till: 'A', day, payment: 'card', status: 'collected',
      items: [l('straw', 'Chocolate Strawberry & Marshmallow (V)', 1)], total: 500,
      createdAtMs: t(9, 40), startedAtMs: t(9, 41), readyAtMs: t(9, 43), collectedAtMs: t(9, 44) },

    { orderNo: 'A-040', name: 'Lucy', till: 'A', day, payment: 'cash', status: 'collected',
      items: [l('sweet_box', 'Sweet Box', 2), l('samosa_only', 'Samosa', 1)], total: 1500,
      createdAtMs: t(10, 5), startedAtMs: t(10, 6), readyAtMs: t(10, 9), collectedAtMs: t(10, 10) },
    { orderNo: 'A-041', name: 'Priya', till: 'A', day, payment: 'cash', status: 'collected',
      items: [l('fuchka', 'Fuchka / Gol Gappa', 2), l('momo', 'Momo', 1)], total: 1500,
      createdAtMs: t(10, 12), startedAtMs: t(10, 13), readyAtMs: t(10, 16), collectedAtMs: t(10, 17) },
    { orderNo: 'B-017', name: 'Tom', till: 'B', day, payment: 'card', status: 'collected',
      items: [l('fuchka', 'Fuchka / Gol Gappa', 3)], total: 1500,
      createdAtMs: t(10, 20), startedAtMs: t(10, 22), readyAtMs: t(10, 25), collectedAtMs: t(10, 26) },
    { orderNo: 'A-042', name: 'Sam', till: 'A', day, payment: 'card', status: 'ready',
      items: [l('fuchka', 'Fuchka / Gol Gappa', 1), l('choc_strawberry', 'Chocolate Strawberry', 1)], total: 1000,
      createdAtMs: t(10, 30), startedAtMs: t(10, 31), readyAtMs: t(10, 35) },
    { orderNo: 'A-043', name: 'Meera', till: 'A', day, payment: 'cash', status: 'preparing',
      items: [l('fountain', 'Chocolate Fountain', 1), l('sweet_box', 'Sweet Box', 1)], total: 1000,
      createdAtMs: t(10, 40), startedAtMs: t(10, 42) },
    { orderNo: 'B-019', name: 'Ahmed', till: 'B', day, payment: 'cash', status: 'new',
      items: [l('momo', 'Momo', 2), l('chat', 'Papri Chat', 1)], total: 1500,
      createdAtMs: t(10, 50) },
    { orderNo: 'A-044', name: 'Guest', till: 'A', day, payment: 'card', status: 'cancelled',
      items: [l('samosa_only', 'Samosa', 2)], total: 1000,
      createdAtMs: t(10, 55), cancelledAtMs: t(10, 56) },

    // Yesterday. Only `?day=<prev>` or the date input may show it.
    { orderNo: 'A-900', name: 'Yesterday', till: 'A', day: prev, payment: 'cash', status: 'collected',
      items: [l('fuchka', 'Fuchka / Gol Gappa', 1)], total: 500,
      createdAtMs: londonTimeOn(prev, 12, 0), startedAtMs: londonTimeOn(prev, 12, 1), readyAtMs: londonTimeOn(prev, 12, 3), collectedAtMs: londonTimeOn(prev, 12, 4) }
  ];
}

/** Hand-calculated expectations for ordersFixture(). Every figure is a literal. */
export function ordersExpect(day = londonDay()) {
  return {
    day,
    prevDay: londonDayOffset(-1, day),
    /** Newest first by createdAtMs (CLAUDE.md Phase IV 5). */
    newestFirst: ['A-044', 'B-019', 'A-043', 'A-042', 'B-017', 'A-041', 'A-040', 'A-011', 'A-010'],
    notToday: ['A-900'],
    rowCount: 9,          // cancelled orders are listed
    liveTotal: 9500,      // £15+£15+£15+£10+£10+£15+£10+£5 = £95.00, cancelled £10 excluded
    cancelledCount: 1,
    summary: '9 orders · £95.00 (excludes 1 cancelled)',
    rows: {
      'A-044': { time: '10:55', name: 'Guest', items: '2× Samosa', total: '£10.00', pay: 'Card', status: 'Cancelled', wait: '—' },
      'B-019': { time: '10:50', name: 'Ahmed', items: '2× Momo, 1× Papri Chat', total: '£15.00', pay: 'Cash', status: 'New', wait: '—' },
      'A-043': { time: '10:40', name: 'Meera', items: '1× Chocolate Fountain, 1× Sweet Box', total: '£10.00', pay: 'Cash', status: 'Preparing', wait: '—' },
      'A-042': { time: '10:30', name: 'Sam', items: '1× Fuchka, 1× Choc Strawberry', total: '£10.00', pay: 'Card', status: 'Ready', wait: '5 min' },
      'B-017': { time: '10:20', name: 'Tom', items: '3× Fuchka', total: '£15.00', pay: 'Card', status: 'Collected', wait: '5 min' },
      'A-041': { time: '10:12', name: 'Priya', items: '2× Fuchka, 1× Momo', total: '£15.00', pay: 'Cash', status: 'Collected', wait: '4 min' },
      'A-040': { time: '10:05', name: 'Lucy', items: '2× Sweet Box, 1× Samosa', total: '£15.00', pay: 'Cash', status: 'Collected', wait: '4 min' },
      'A-011': { time: '09:40', name: 'Rina', items: '1× Chocolate Strawberry & Marshmallow (V)', total: '£5.00', pay: 'Card', status: 'Collected', wait: '3 min' },
      'A-010': { time: '09:30', name: 'Josh', items: '2× Sweets Box Samosa / Shingara', total: '£10.00', pay: 'Cash', status: 'Collected', wait: '4 min' }
    },
    /** Each filter: the rows it leaves, newest first, and the summary figures. */
    filters: {
      all: { rows: ['A-044', 'B-019', 'A-043', 'A-042', 'B-017', 'A-041', 'A-040', 'A-011', 'A-010'], total: 9500, cancelled: 1 },
      new: { rows: ['B-019'], total: 1500, cancelled: 0 },
      preparing: { rows: ['A-043'], total: 1000, cancelled: 0 },
      ready: { rows: ['A-042'], total: 1000, cancelled: 0 },
      collected: { rows: ['B-017', 'A-041', 'A-040', 'A-011', 'A-010'], total: 6000, cancelled: 0 },
      cancelled: { rows: ['A-044'], total: 0, cancelled: 1 },
      cash: { rows: ['B-019', 'A-043', 'A-041', 'A-040', 'A-010'], total: 6500, cancelled: 0 },
      card: { rows: ['A-044', 'A-042', 'B-017', 'A-011'], total: 3000, cancelled: 1 }
    },
    searches: {
      'a-04': { rows: ['A-044', 'A-043', 'A-042', 'A-041', 'A-040'], total: 5000, cancelled: 1 },
      'priya': { rows: ['A-041'], total: 1500, cancelled: 0 },
      'PRIYA': { rows: ['A-041'], total: 1500, cancelled: 0 },
      '  priya  ': { rows: ['A-041'], total: 1500, cancelled: 0 },
      'b-0': { rows: ['B-019', 'B-017'], total: 3000, cancelled: 0 },
      'zzz': { rows: [], total: 0, cancelled: 0 }
    },
    /** status=collected + pay=cash + search "a-0" */
    combination: { rows: ['A-041', 'A-040', 'A-010'], total: 4000, cancelled: 0 },
    detail: {
      'A-041': {
        no: 'A-041', name: 'Priya', status: 'Collected', till: 'A', pay: 'Cash', time: '10:12', wait: '4 min',
        steps: [['placed', '10:12'], ['started', '10:13'], ['ready', '10:16'], ['collected', '10:17']],
        lines: [
          { id: 'fuchka', qty: 2, price: '£5.00', line: '£10.00' },
          { id: 'momo', qty: 1, price: '£5.00', line: '£5.00' }
        ],
        total: '£15.00'
      },
      'A-043': {
        no: 'A-043', name: 'Meera', status: 'Preparing', till: 'A', pay: 'Cash', time: '10:40', wait: '—',
        steps: [['placed', '10:40'], ['started', '10:42'], ['ready', '—'], ['collected', '—']],
        total: '£10.00'
      },
      'A-044': {
        no: 'A-044', name: 'Guest', status: 'Cancelled', till: 'A', pay: 'Card', time: '10:55', wait: '—',
        steps: [['placed', '10:55'], ['cancelled', '10:56']],
        total: '£10.00'
      }
    },
    /**
     * One CSV row per line of the orders currently shown. The Orders export
     * follows the list, so the cancelled order's line is in it too
     * (CLAUDE.md Phase IV 8 "the orders currently shown" + 5 "cancelled
     * orders are listed"), unlike the One day and Sales by day exports.
     */
    csvLines: { all: 14, cash: 9, cancelled: 1 }
  };
}

/** Seed the scripted day and wait until the emulator really holds it. */
export async function seedOrdersDay(day = londonDay()) {
  const fixture = ordersFixture(day);
  for (const o of fixture) await seedDoc('orders', o);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const got = await readCollection('orders');
    if (got.length === fixture.length) return fixture;
    await new Promise((r) => setTimeout(r, 150));
  }
  const got = await readCollection('orders');
  throw new Error(`seedOrdersDay expected ${fixture.length} orders, emulator holds ${got.length}`);
}

/* ------------------------------------------ Phase IV: locators ----
 * The orchestrator's DOM contract and .claude/agents/neo.md give two names for
 * five of the Phase IV elements (orders-row-/order-row-, orders-open-/
 * order-open-, orders-back/order-back, export-orders-csv/orders-export-csv,
 * report-view-orders/report-toggle-orders). The contract name is tried first
 * and the neo.md name second, so a test asserts the brief rather than one
 * particular spelling. Noted in qa/test-plan.md section 34.
 */

export const ordersNav = (page) => firstOf(page, [
  '[data-testid="report-view-orders"]', '[data-testid="report-toggle-orders"]'
]);
export const ordersRow = (page, no) => firstOf(page, [
  `[data-testid="orders-row-${no}"]`, `[data-testid="order-row-${no}"]`
]);
export const ordersOpen = (page, no) => firstOf(page, [
  `[data-testid="orders-open-${no}"]`, `[data-testid="order-open-${no}"]`
]);
export const ordersCard = (page, no) => firstOf(page, [
  `[data-testid="orders-card-${no}"]`, `[data-testid="order-card-${no}"]`
]);
export const ordersBack = (page) => firstOf(page, [
  '[data-testid="orders-back"]', '[data-testid="order-back"]'
]);
export const ordersExport = (page) => firstOf(page, [
  '[data-testid="export-orders-csv"]', '[data-testid="orders-export-csv"]'
]);

/**
 * The row (tablet) or card (phone) for an order, whichever this project shows.
 * One locator over all four spellings, so it still resolves for an order that
 * has not arrived yet (the live-update cases wait on it).
 */
export function orderEntry(page, no) {
  return page.locator([
    `[data-testid="orders-row-${no}"]`, `[data-testid="order-row-${no}"]`,
    `[data-testid="orders-card-${no}"]`, `[data-testid="order-card-${no}"]`
  ].join(', ')).first();
}

/** The control that opens an order's detail: the Order button or the phone card. */
export async function openOrder(page, no) {
  const target = await anyOf(page, [
    `[data-testid="orders-open-${no}"]`, `[data-testid="order-open-${no}"]`,
    `[data-testid="orders-card-${no}"]`, `[data-testid="order-card-${no}"]`
  ]);
  if (!target) throw new Error(`no way to open order ${no}: expected orders-open-${no} or orders-card-${no}`);
  await target.click();
  await page.waitForTimeout(400);
  return target;
}

/** Order numbers currently listed, in document order. */
export async function listedOrders(page) {
  return page.evaluate(() => {
    const seen = [];
    for (const el of document.querySelectorAll('[data-testid]')) {
      const m = /^orders?-(?:row|card)-([A-Z]-\d{3})$/.exec(el.dataset.testid);
      if (m && !seen.includes(m[1])) seen.push(m[1]);
    }
    return seen;
  });
}

/** Whitespace-normalised text of the order detail panel, or '' when absent. */
export async function detailText(page) {
  const panel = await anyOf(page, ['[data-testid="order-detail"]']);
  if (!panel) return '';
  return (await panel.innerText()).replace(/\s+/g, ' ').trim();
}

/** A named field of the detail panel: its own testid if present, else the panel text. */
export async function detailField(page, testid) {
  const loc = await anyOf(page, [`[data-testid="${testid}"]`]);
  if (!loc) return null;
  return (await loc.innerText()).replace(/\s+/g, ' ').trim();
}

/* ============================================ Phase V: edit or cancel (v1.4.0)
 *
 * Spec: CLAUDE.md -> "Phase V: Edit or cancel an open order, plus Samosa Chat
 * (v1.4.0)" 1-8, and design/CashOpenOrders.dc.html,
 * design/CashOpenOrdersSmall.dc.html, design/FoodCounterChanges.dc.html.
 * Plan: qa/test-plan.md sections 46-53.
 *
 * CLAUDE.md names three test ids for Phase V (`open-orders`, `edit-delta`,
 * `cancel-reason-<key>`). Everything else below tries the convention name
 * first and falls back to the role, the aria-label or the button wording the
 * brief and the mock-ups fix, so a case fails on behaviour, not on spelling.
 */

/** The 8th tile, added by Phase V 7. */
export const MENU_IDS_P5 = [
  'fuchka', 'momo', 'chat', 'sweet_box',
  'samosa_only', 'choc_strawberry', 'marshmallow', 'samosa_chat'
];

/* ------------------------------------------------------------- locators */

const OPEN_ORDERS_BTN_SEL = [
  '[data-testid="open-orders"]',
  'header button[aria-label*="Open orders" i]',
  'header button:has-text("Open orders")'
];
const OPEN_PANEL_SEL = [
  '[data-testid="open-orders-drawer"]',
  '[data-testid="open-orders-panel"]',
  '[data-testid="open-orders-sheet"]',
  '[role="dialog"][aria-label*="Open orders" i]'
];
const OPEN_CLOSE_SEL = [
  '[data-testid="open-orders-close"]',
  '[data-testid="open-orders-drawer"] button:has-text("Close")',
  '[role="dialog"][aria-label*="Open orders" i] button:has-text("Close")'
];
const OPEN_SEARCH_SEL = [
  '[data-testid="open-orders-search"]',
  'input[aria-label*="Search open orders" i]',
  'input[placeholder*="Search order number" i]',
  'input[placeholder*="Search number or name" i]'
];

export const openOrdersButton = (page) => page.locator(OPEN_ORDERS_BTN_SEL.join(', ')).first();
export const openOrdersPanel = (page) => page.locator(OPEN_PANEL_SEL.join(', ')).first();
export const openOrdersSearch = (page) => page.locator(OPEN_SEARCH_SEL.join(', ')).first();
export const openOrdersClose = (page) => page.locator(OPEN_CLOSE_SEL.join(', ')).first();
export const openOrdersEmpty = (page) => page.locator('[data-testid="open-orders-empty"]').first();

export const openOrderRow = (page, no) => page.locator([
  `[data-testid="open-order-${no}"]`,
  `[data-testid="open-row-${no}"]`,
  `[data-testid="open-orders-row-${no}"]`
].join(', ')).first();

export const openEditButton = (page, no) => page.locator([
  `[data-testid="edit-${no}"]`,
  `[data-testid="open-edit-${no}"]`
].join(', ')).first();

export const openCancelButton = (page, no) => page.locator([
  `[data-testid="cancel-${no}"]`,
  `[data-testid="open-cancel-${no}"]`
].join(', ')).first();

/** The count on the header button: its own testid, else the button's text. */
export async function openOrdersCount(page) {
  const badge = tid(page, 'open-orders-count').first();
  if ((await badge.count()) && (await badge.isVisible().catch(() => false))) {
    const n = Number((await badge.innerText()).replace(/\D+/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  const btn = openOrdersButton(page);
  if (!(await btn.count())) return null;
  const m = (await btn.innerText()).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Open the Open orders drawer (tablet) or bottom sheet (phone).
 * CLAUDE.md Phase V 1.
 */
export async function openOpenOrders(page) {
  if (isSmallCash(page)) await closeCashPanel(page);
  const panel = openOrdersPanel(page);
  if ((await panel.count()) && (await panel.isVisible().catch(() => false))) return panel;
  const btn = openOrdersButton(page);
  await expect(btn,
    'CLAUDE.md Phase V 1: an "Open orders" button with a count badge in the cash counter header'
  ).toBeVisible({ timeout: 15000 });
  await btn.click();
  await expect(panel,
    'CLAUDE.md Phase V 1: Open orders opens a right-hand drawer (tablet) or a bottom sheet (phone)'
  ).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(250);
  return panel;
}

/** Close it with its own Close button. */
export async function closeOpenOrders(page) {
  const panel = openOrdersPanel(page);
  if (!(await panel.count()) || !(await panel.isVisible().catch(() => false))) return;
  const close = openOrdersClose(page);
  if (await close.count()) await close.click();
  else await page.keyboard.press('Escape');
  await expect(panel).toBeHidden({ timeout: 10000 });
  await page.waitForTimeout(150);
}

/** Order numbers currently listed in the panel, in document order. */
export async function listedOpenOrders(page) {
  return page.evaluate(() => {
    const seen = [];
    for (const el of document.querySelectorAll('[data-testid]')) {
      const m = /^open-(?:order|row|orders-row)-([A-Z]-\d{3})$/.exec(el.dataset.testid);
      if (m && !seen.includes(m[1])) seen.push(m[1]);
    }
    return seen;
  });
}

/* ------------------------------------------------------------ edit mode */

export const editBanner = (page) => page.locator([
  '[data-testid="edit-banner"]', '[data-testid="edit-mode"]'
].join(', ')).first();
export const editDelta = (page) => tid(page, 'edit-delta').first();
export const saveChanges = (page) => page.locator([
  '[data-testid="save-changes"]', '[data-testid="edit-save"]',
  'button:has-text("Save changes")'
].join(', ')).first();
export const discardChanges = (page) => page.locator([
  '[data-testid="discard-changes"]', '[data-testid="edit-discard"]',
  'button:has-text("Discard changes")', 'button:has-text("Discard")'
].join(', ')).first();
export const editBlocked = (page) => page.locator([
  '[data-testid="edit-blocked"]', '[data-testid="edit-conflict"]'
].join(', ')).first();
export const editEmptyOffer = (page) => page.locator([
  '[data-testid="edit-empty"]', '[data-testid="edit-no-items"]'
].join(', ')).first();
export const editEmptyCancel = (page) => page.locator([
  '[data-testid="edit-empty-cancel"]', '[data-testid="edit-cancel-order"]'
].join(', ')).first();
export const lineChangeTag = (page, id) => page.locator([
  `[data-testid="line-change-${id}"]`, `[data-testid="line-tag-${id}"]`
].join(', ')).first();
export const lineRemoved = (page, id) => page.locator([
  `[data-testid="line-removed-${id}"]`, `[data-testid="removed-${id}"]`
].join(', ')).first();

/** True when the order panel / sheet is in edit mode. */
export async function inEditMode(page) {
  const banner = editBanner(page);
  if ((await banner.count()) && (await banner.isVisible().catch(() => false))) return true;
  const save = saveChanges(page);
  return (await save.count()) ? save.isVisible().catch(() => false) : false;
}

/**
 * Tap Edit on an open order and wait until the panel (tablet) or the cart and
 * Review sheet (phone) is in edit mode. CLAUDE.md Phase V 2.
 */
export async function startEdit(page, no) {
  await openOpenOrders(page);
  const edit = openEditButton(page, no);
  await expect(edit, `CLAUDE.md Phase V 1: an Edit button on the ${no} row`).toBeVisible({ timeout: 10000 });
  await edit.click();
  await expect(editBanner(page),
    `CLAUDE.md Phase V 2: an amber banner "Editing ${no} · <name>" once Edit is tapped`
  ).toBeVisible({ timeout: 10000 });
  if (isSmallCash(page)) await openCashPanel(page);
  await page.waitForTimeout(250);
}

/** Save an edit and wait for the write to land. */
export async function saveEdit(page) {
  const save = saveChanges(page);
  await expect(save, 'CLAUDE.md Phase V 2: "Save changes · £x.xx"').toBeVisible({ timeout: 10000 });
  await expect(save, 'Save must be enabled once something has changed').toBeEnabled({ timeout: 10000 });
  await save.click();
  await page.waitForTimeout(400);
}

/* --------------------------------------------------------- cancel dialog */

/**
 * The confirm, for visibility and text. A comma list resolves in DOM order,
 * and the app puts `cancel-dialog` on the backdrop wrapper with
 * `role="alertdialog"` on the card inside it, so this is usually the wrapper —
 * whose text is the card's text. The role itself is asserted separately with
 * `cancelDialogRole()`, because CLAUDE.md Phase V 3 pins the role, not which
 * element carries it.
 */
export const cancelDialog = (page) => page.locator([
  '[role="alertdialog"]', '[data-testid="cancel-dialog"]'
].join(', ')).first();

/** Every element carrying role="alertdialog" (CLAUDE.md Phase V 3). */
export const cancelDialogRole = (page) => page.locator('[role="alertdialog"]');
export const cancelReasonButton = (page, key) => page.locator(`[data-testid="cancel-reason-${key}"]`).first();
export const cancelRefund = (page) => page.locator([
  '[data-testid="cancel-refund"]', '[role="alertdialog"] [data-testid="refund"]'
].join(', ')).first();
export const cancelKeep = (page) => page.locator([
  '[data-testid="cancel-keep"]', '[role="alertdialog"] button:has-text("Keep order")'
].join(', ')).first();
export const cancelConfirm = (page) => page.locator([
  '[data-testid="cancel-confirm"]', '[role="alertdialog"] button:has-text("Cancel order")'
].join(', ')).first();

/** Open the cancel dialog for an order from the Open orders list. */
export async function openCancelDialog(page, no) {
  await openOpenOrders(page);
  const btn = openCancelButton(page, no);
  await expect(btn, `CLAUDE.md Phase V 1: a "Cancel…" button on the ${no} row`).toBeVisible({ timeout: 10000 });
  await btn.click();
  await expect(cancelDialog(page),
    'CLAUDE.md Phase V 3: the cancel confirm is a role="alertdialog"'
  ).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(200);
  return cancelDialog(page);
}

/** The whole cancel flow: open, pick a reason, confirm. */
export async function cancelOrderWithReason(page, no, reason = 'changed_mind') {
  await openCancelDialog(page, no);
  const pick = cancelReasonButton(page, reason);
  await expect(pick,
    `CLAUDE.md Phase V 3: a one-tap reason button cancel-reason-${reason}`
  ).toBeVisible({ timeout: 10000 });
  await pick.click();
  const confirm = cancelConfirm(page);
  await expect(confirm, 'CLAUDE.md Phase V 3: "Cancel order" enables once a reason is picked')
    .toBeEnabled({ timeout: 10000 });
  await confirm.click();
  await page.waitForTimeout(400);
}

/* ------------------------------------------------------- the open-day fixture
 * Today's scripted board for the Open orders drawer, mirroring
 * design/CashOpenOrders.dc.html. Hand-calculated expectations live in
 * qa/test-plan.md section 49.
 */

export function p5Fixture(day = londonDay()) {
  const t = (h, m) => londonTimeOn(day, h, m);
  const l = (id, name, qty) => ({ id, name, qty, price: 500 });
  return [
    { orderNo: 'A-039', name: 'Dev', till: 'A', day, payment: 'card', status: 'cancelled',
      items: [l('fuchka', 'Fuchka / Gol Gappa', 1)], total: 500,
      createdAtMs: t(13, 40), cancelledAtMs: t(13, 42), cancelReason: 'mistake', cancelledFrom: 'new' },
    { orderNo: 'A-040', name: 'Lucy', till: 'A', day, payment: 'cash', status: 'collected',
      items: [l('sweet_box', 'Sweet Box', 2)], total: 1000,
      createdAtMs: t(13, 50), startedAtMs: t(13, 51), readyAtMs: t(13, 54), collectedAtMs: t(13, 55) },
    { orderNo: 'A-041', name: 'Ahmed', till: 'A', day, payment: 'cash', status: 'preparing',
      items: [l('momo', 'Momo', 2), l('chat', 'Papri Chat', 1)], total: 1500,
      createdAtMs: t(14, 1), startedAtMs: t(14, 2) },
    { orderNo: 'A-042', name: 'Sam', till: 'A', day, payment: 'card', status: 'ready',
      items: [l('fuchka', 'Fuchka / Gol Gappa', 1), l('choc_strawberry', 'Chocolate Strawberry', 1)], total: 1000,
      createdAtMs: t(14, 3), startedAtMs: t(14, 4), readyAtMs: t(14, 6) },
    { orderNo: 'B-012', name: 'Meera', till: 'B', day, payment: 'cash', status: 'new',
      items: [l('momo', 'Momo', 1), l('samosa_chat', 'Samosa Chat', 1)], total: 1000,
      createdAtMs: t(14, 7) },
    { orderNo: 'A-044', name: 'Josh', till: 'A', day, payment: 'card', status: 'new',
      items: [l('chat', 'Papri Chat', 1), l('marshmallow', 'Chocolate Marshmallow (V)', 2)], total: 1500,
      createdAtMs: t(14, 9) }
  ];
}

/** Hand-calculated expectations for p5Fixture(). Every figure is a literal. */
export const P5_EXPECT = {
  /** Status new, preparing or ready, every till, newest first (Phase V 1). */
  open: ['A-044', 'B-012', 'A-042', 'A-041'],
  openCount: 4,
  /** Listed nowhere: collected and cancelled are not "open". */
  closed: ['A-040', 'A-039'],
  rows: {
    'A-041': { name: 'Ahmed', status: 'Preparing', items: '2× Momo, 1× Papri Chat', total: '£15.00', pay: 'Cash', till: 'A', time: '14:01' },
    'A-042': { name: 'Sam', status: 'Ready', items: '1× Fuchka, 1× Choc Strawberry', total: '£10.00', pay: 'Card', till: 'A', time: '14:03' },
    'B-012': { name: 'Meera', status: 'New', items: '1× Momo, 1× Samosa Chat', total: '£10.00', pay: 'Cash', till: 'B', time: '14:07' },
    'A-044': { name: 'Josh', status: 'New', items: '1× Papri Chat, 2× Choc Marshmallow', total: '£15.00', pay: 'Card', till: 'A', time: '14:09' }
  }
};

/** Seed the scripted open day and wait until the emulator really holds it. */
export async function seedP5Day(day = londonDay()) {
  const fixture = p5Fixture(day);
  for (const o of fixture) await seedDoc('orders', o);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const got = await readCollection('orders');
    if (got.length === fixture.length) return fixture;
    await new Promise((r) => setTimeout(r, 150));
  }
  const got = await readCollection('orders');
  throw new Error(`seedP5Day expected ${fixture.length} orders, emulator holds ${got.length}`);
}

/**
 * Replace a document that already exists (REST PATCH with no updateMask is a
 * full replace). Used to simulate a change made somewhere else.
 */
export async function patchDoc(collection, id, data) {
  const res = await emuFetch(`${DOCS}/${collection}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(data) })
  });
  if (!res.ok) throw new Error(`patchDoc ${collection}/${id} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** One order out of the emulator by its order number. */
export async function orderByNo(no) {
  const all = await readCollection('orders');
  return all.find((o) => o.orderNo === no) || null;
}

/** Wait until the stored order matches a predicate, and return it. */
export async function waitForOrder(no, predicate, opts = {}) {
  const orders = await waitForOrders(
    (list) => list.some((o) => o.orderNo === no && predicate(o)),
    { label: `${no} ${opts.label || 'to change'}`, timeout: opts.timeout || 15000 }
  );
  return orders.find((o) => o.orderNo === no);
}

/**
 * Tap a food-counter action button from another context, selecting the lane
 * first: below 700 px the board is tabs, so a card in another lane is not
 * merely off screen, it is not rendered (CLAUDE.md Food counter 1).
 */
export async function kitchenAdvance(page, no, lane) {
  const tab = page.locator(`[data-testid="tab-${lane}"]`);
  if ((await tab.count()) && (await tab.isVisible().catch(() => false))) {
    await tab.click();
    await page.waitForTimeout(300);
  }
  await page.locator(`[data-testid="action-${no}"]`).click({ timeout: 20000 });
}

/** A stable JSON snapshot of an order, for "nothing was written" assertions. */
export async function orderSnapshot(no) {
  const o = await orderByNo(no);
  if (!o) return null;
  const { _id, createdAt, ...rest } = o;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

/* ------------------------------------ Phase VI: the order-history fixture ----
 * A scripted 40-day range for #/reports/history, pinned to today's London day
 * so the screen's default "Last 7 days" covers the first ten orders exactly.
 * The same table, with absolute days, is in tests/unit/history-fixtures.js;
 * the hand-calculated expectations are in qa/test-plan.md section 58.
 *
 * Document ids are fixed (h01..h15) because CLAUDE.md Phase VI 2 puts
 * `order=<docId>` in the hash and Phase VI 7 copies a link to it.
 */

const HISTORY_NAMES = {
  fuchka: 'Fuchka / Gol Gappa',
  momo: 'Momo',
  chat: 'Papri Chat',
  sweet_box: 'Sweet Box',
  samosa_only: 'Samosa',
  choc_strawberry: 'Chocolate Strawberry',
  marshmallow: 'Chocolate Marshmallow (V)',
  samosa_chat: 'Samosa Chat',
  fountain: 'Chocolate Fountain'   // retired in H3: not in the menu any more
};

const hLine = (id, qty) => ({ id, name: HISTORY_NAMES[id] || id, qty, price: 500 });

/** The nine trading days of the fixture, as day strings. */
export function historyDays(today = londonDay()) {
  return {
    t: today,
    t1: londonDayOffset(-1, today),
    t3: londonDayOffset(-3, today),
    t6: londonDayOffset(-6, today),
    t7: londonDayOffset(-7, today),
    t13: londonDayOffset(-13, today),
    t29: londonDayOffset(-29, today),
    t30: londonDayOffset(-30, today),
    t39: londonDayOffset(-39, today)
  };
}

export function historyFixture(today = londonDay()) {
  const D = historyDays(today);
  const at = (day, h, m) => londonTimeOn(day, h, m);
  const stamps = (day, h, m, status) => {
    const out = { createdAtMs: at(day, h, m) };
    if (status === 'new') return out;
    out.startedAtMs = at(day, h, m + 2);
    if (status === 'preparing') return out;
    out.readyAtMs = at(day, h, m + 6);
    if (status === 'ready') return out;
    out.collectedAtMs = at(day, h, m + 8);
    return out;
  };
  const make = (id, day, orderNo, h, m, name, till, payment, status, items, extra = {}) => ({
    id,
    doc: {
      orderNo, name, till, day, items, payment, status,
      total: items.reduce((sum, l) => sum + l.qty * l.price, 0),
      ...stamps(day, h, m, status),
      ...extra
    }
  });

  return [
    make('h01', D.t, 'A-003', 13, 12, 'Ruma', 'A', 'card', 'collected', [hLine('samosa_chat', 2)]),

    make('h02', D.t, 'A-002', 13, 5, 'Guest', 'A', 'cash', 'cancelled', [hLine('momo', 1)], {
      cancelledAtMs: at(D.t, 13, 9),
      cancelReason: 'mistake',
      cancelledFrom: 'new',
      history: [{
        atMs: at(D.t, 13, 9), action: 'cancel', till: 'A', fromStatus: 'new', reason: 'mistake',
        before: { items: [hLine('momo', 1)], total: 500, name: 'Guest', payment: 'cash' }, deltaPence: 0
      }]
    }),

    make('h03', D.t, 'A-001', 12, 58, 'Arjun', 'A', 'card', 'collected',
      [hLine('fuchka', 1), hLine('samosa_chat', 1)]),

    make('h04', D.t1, 'B-012', 15, 20, 'Meera', 'B', 'card', 'ready',
      [hLine('momo', 1), hLine('sweet_box', 1)]),

    make('h05', D.t1, 'A-031', 15, 10, 'Ahmed', 'A', 'cash', 'collected', [hLine('momo', 3)], {
      editCount: 1,
      editedAtMs: at(D.t1, 15, 13),
      history: [{
        atMs: at(D.t1, 15, 13), action: 'edit', till: 'A', fromStatus: 'preparing',
        before: { items: [hLine('momo', 2), hLine('chat', 1)], total: 1500, name: 'Ahmed', payment: 'cash' },
        deltaPence: 0
      }]
    }),

    make('h06', D.t1, 'A-030', 15, 2, 'Priya', 'A', 'card', 'collected',
      [hLine('fuchka', 2), hLine('marshmallow', 1)]),

    make('h07', D.t3, 'A-012', 11, 40, 'Tom', 'A', 'cash', 'preparing',
      [hLine('samosa_only', 1), hLine('choc_strawberry', 1)]),

    make('h08', D.t3, 'C-001', 11, 5, 'Dev', 'C', 'card', 'cancelled', [hLine('fuchka', 1)], {
      cancelledAtMs: at(D.t3, 11, 23),
      cancelReason: 'not_collected',
      cancelledFrom: 'ready',
      history: [{
        atMs: at(D.t3, 11, 23), action: 'cancel', till: 'C', fromStatus: 'ready', reason: 'not_collected',
        before: { items: [hLine('fuchka', 1)], total: 500, name: 'Dev', payment: 'card' }, deltaPence: 0
      }]
    }),

    make('h09', D.t6, 'A-001', 16, 40, 'Josh', 'A', 'card', 'new',
      [hLine('chat', 1), hLine('marshmallow', 2)]),

    // Edited twice: 1 -> 3 -> 2 Sweet Box.
    make('h10', D.t6, 'B-002', 16, 31, 'Sohini', 'B', 'cash', 'collected', [hLine('sweet_box', 2)], {
      startedAtMs: at(D.t6, 16, 34),
      readyAtMs: at(D.t6, 16, 37),
      collectedAtMs: at(D.t6, 16, 39),
      editCount: 2,
      editedAtMs: at(D.t6, 16, 36),
      history: [
        {
          atMs: at(D.t6, 16, 33), action: 'edit', till: 'B', fromStatus: 'new',
          before: { items: [hLine('sweet_box', 1)], total: 500, name: 'Sohini', payment: 'cash' },
          deltaPence: 1000
        },
        {
          atMs: at(D.t6, 16, 36), action: 'edit', till: 'A', fromStatus: 'preparing',
          before: { items: [hLine('sweet_box', 3)], total: 1500, name: 'Sohini', payment: 'cash' },
          deltaPence: -500
        }
      ]
    }),

    // Phase I order: carries `tendered` and none of the Phase V fields.
    make('h11', D.t7, 'A-007', 12, 30, 'Lucy', 'A', 'cash', 'collected', [hLine('fuchka', 2)], {
      tendered: 2000
    }),

    make('h12', D.t13, 'B-005', 18, 5, 'Nadia', 'B', 'card', 'collected',
      [hLine('fountain', 1), hLine('momo', 1)]),

    make('h13', D.t29, 'A-050', 10, 10, 'Imran', 'A', 'cash', 'collected', [hLine('chat', 3)]),

    make('h14', D.t30, 'A-001', 9, 15, 'Ekta', 'A', 'card', 'collected', [hLine('sweet_box', 1)]),

    make('h15', D.t39, 'B-001', 19, 45, 'Raj', 'B', 'cash', 'collected', [hLine('momo', 2)])
  ];
}

/** Hand-calculated expectations for the fixture (qa/test-plan.md 58.1). */
export function historyExpect(today = londonDay()) {
  const D = historyDays(today);
  return {
    days: D,
    defaultRange: { from: D.t6, to: D.t },
    defaultIds: ['h01', 'h02', 'h03', 'h04', 'h05', 'h06', 'h07', 'h08', 'h09', 'h10'],
    summary: {
      orders: 10, tradingDays: 4, sales: '£95.00', cancelled: 2,
      cancelledNote: '£10.00 not taken', edited: 2,
      text: '10 orders · £95.00 (excludes 2 cancelled)'
    },
    groups: [
      { day: D.t, ids: ['h01', 'h02', 'h03'], meta: '3 orders · £20.00 (excludes 1 cancelled)' },
      { day: D.t1, ids: ['h04', 'h05', 'h06'], meta: '3 orders · £40.00' },
      { day: D.t3, ids: ['h07', 'h08'], meta: '2 orders · £10.00 (excludes 1 cancelled)' },
      { day: D.t6, ids: ['h09', 'h10'], meta: '2 orders · £25.00' }
    ],
    ranges: {
      today: { from: D.t, to: D.t, ids: ['h01', 'h02', 'h03'], text: '3 orders · £20.00 (excludes 1 cancelled)' },
      '7d': { from: D.t6, to: D.t, ids: ['h01', 'h02', 'h03', 'h04', 'h05', 'h06', 'h07', 'h08', 'h09', 'h10'], text: '10 orders · £95.00 (excludes 2 cancelled)' },
      '30d': {
        from: D.t29, to: D.t,
        ids: ['h01', 'h02', 'h03', 'h04', 'h05', 'h06', 'h07', 'h08', 'h09', 'h10', 'h11', 'h12', 'h13'],
        text: '13 orders · £130.00 (excludes 2 cancelled)'
      },
      event: { from: D.t3, to: D.t1, ids: ['h04', 'h05', 'h06', 'h07', 'h08'], text: '5 orders · £50.00 (excludes 1 cancelled)' }
    },
    filters: [
      { label: 'status collected', set: { status: 'collected' }, ids: ['h01', 'h03', 'h05', 'h06', 'h10'], text: '5 orders · £60.00' },
      { label: 'status cancelled', set: { status: 'cancelled' }, ids: ['h02', 'h08'], text: '2 orders · £0.00 (excludes 2 cancelled)' },
      { label: 'status open', set: { status: 'open' }, ids: ['h04', 'h07', 'h09'], text: '3 orders · £35.00' },
      { label: 'pay cash', set: { pay: 'cash' }, ids: ['h02', 'h05', 'h07', 'h10'], text: '4 orders · £35.00 (excludes 1 cancelled)' },
      { label: 'pay card', set: { pay: 'card' }, ids: ['h01', 'h03', 'h04', 'h06', 'h08', 'h09'], text: '6 orders · £60.00 (excludes 1 cancelled)' },
      { label: 'till A', set: { till: 'A' }, ids: ['h01', 'h02', 'h03', 'h05', 'h06', 'h07', 'h09'], text: '7 orders · £75.00 (excludes 1 cancelled)' },
      { label: 'till B', set: { till: 'B' }, ids: ['h04', 'h10'], text: '2 orders · £20.00' },
      { label: 'till C', set: { till: 'C' }, ids: ['h08'], text: '1 orders · £0.00 (excludes 1 cancelled)' },
      { label: 'item momo', set: { item: 'momo' }, ids: ['h02', 'h04', 'h05'], text: '3 orders · £25.00 (excludes 1 cancelled)' },
      { label: 'item samosa_chat', set: { item: 'samosa_chat' }, ids: ['h01', 'h03'], text: '2 orders · £20.00' },
      { label: 'edited only', set: { edited: true }, ids: ['h05', 'h10'], text: '2 orders · £25.00' },
      { label: 'search a-00', set: { q: 'a-00' }, ids: ['h01', 'h02', 'h03', 'h09'], text: '4 orders · £35.00 (excludes 1 cancelled)' },
      { label: 'search a-001', set: { q: 'a-001' }, ids: ['h03', 'h09'], text: '2 orders · £25.00' },
      { label: 'search AHMED', set: { q: 'AHMED' }, ids: ['h05'], text: '1 orders · £15.00' },
      { label: 'collected + cash + till A', set: { status: 'collected', pay: 'cash', till: 'A' }, ids: ['h05'], text: '1 orders · £15.00' },
      { label: 'open + card', set: { status: 'open', pay: 'card' }, ids: ['h04', 'h09'], text: '2 orders · £25.00' },
      { label: 'cancelled + till B', set: { status: 'cancelled', till: 'B' }, ids: [], text: '0 orders · £0.00' }
    ]
  };
}

/** Seed the scripted history range and wait until the emulator holds it all. */
export async function seedHistoryRange(today = londonDay()) {
  const fixture = historyFixture(today);
  for (const { id, doc } of fixture) await seedDoc('orders', doc, id);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const got = await readCollection('orders');
    if (got.length === fixture.length) return fixture;
    await new Promise((r) => setTimeout(r, 150));
  }
  const got = await readCollection('orders');
  throw new Error(`seedHistoryRange expected ${fixture.length} orders, emulator holds ${got.length}`);
}

/**
 * 230 identical £5 orders over three days, for the 100-row cap and the
 * "export everything, not just the 100 shown" case (qa/test-plan.md 58.2).
 * Written with the emulator's batchWrite endpoint: 230 single POSTs would add
 * most of a minute to the run.
 */
export function historyBulkFixture(today = londonDay()) {
  const plan = [[today, 90], [londonDayOffset(-1, today), 90], [londonDayOffset(-2, today), 50]];
  const out = [];
  for (const [day, count] of plan) {
    for (let i = 1; i <= count; i++) {
      const minutes = i - 1;
      const h = 10 + Math.floor(minutes / 60);
      const m = minutes % 60;
      const at = (plus) => londonTimeOn(day, h, m + plus);
      out.push({
        id: `b-${day}-${String(i).padStart(3, '0')}`,
        doc: {
          orderNo: `A-${String(i).padStart(3, '0')}`,
          name: `Guest ${i}`, till: 'A', day,
          items: [hLine('fuchka', 1)],
          total: 500, payment: 'card', status: 'collected',
          createdAtMs: at(0), startedAtMs: at(2), readyAtMs: at(6), collectedAtMs: at(8)
        }
      });
    }
  }
  return out;
}

export async function seedHistoryBulk(today = londonDay()) {
  const fixture = historyBulkFixture(today);
  const chunks = [];
  for (let i = 0; i < fixture.length; i += 200) chunks.push(fixture.slice(i, i + 200));
  for (const chunk of chunks) {
    const res = await emuFetch(`${DOCS}:batchWrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: chunk.map(({ id, doc }) => ({
          update: { name: `projects/${PROJECT}/databases/(default)/documents/orders/${id}`, fields: toFields(doc) }
        }))
      })
    });
    if (!res.ok) {
      // Fall back to one POST per document if the emulator build has no
      // batchWrite: slower, but the case still runs.
      for (const { id, doc } of chunk) await seedDoc('orders', doc, id);
    }
  }
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const got = await countOrders();
    if (got >= fixture.length) return fixture;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`seedHistoryBulk expected ${fixture.length} orders, emulator holds ${await countOrders()}`);
}

/** How many documents `orders` holds, paging past the 300-document read. */
export async function countOrders() {
  let count = 0;
  let token = '';
  for (;;) {
    const url = `${DOCS}/orders?pageSize=300&mask.fieldPaths=day` + (token ? `&pageToken=${token}` : '');
    const res = await emuFetch(url).catch(() => null);
    if (!res || !res.ok) return count;
    const body = await res.json();
    count += (body.documents || []).length;
    token = body.nextPageToken || '';
    if (!token) return count;
  }
}

/* --------------------------------------------- Phase VI: request watching */

/**
 * Watch what the page asks the emulator for.
 *
 * The Firestore Web SDK tunnels everything through two WebChannel endpoints,
 * `/Listen/channel` and `/Write/channel`, and form-encodes a batch of protocol
 * messages into `req<n>___data__` parameters. A one-shot `getDocs` is an
 * `addTarget` followed by a `removeTarget`; a live `onSnapshot` is an
 * `addTarget` that is never removed. So the transport cannot be read by URL
 * alone: the bodies have to be decoded, which is what this does.
 *
 * CLAUDE.md Phase VI 3: the history screen makes one query per range change,
 * is not a listener, and never writes.
 */
export function watchFirestore(page) {
  const messages = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!/127\.0\.0\.1:8080|localhost:8080/.test(url)) return;
    let body = '';
    try { body = req.postData() || ''; } catch { body = ''; }
    if (!body) return;
    let params;
    try { params = new URLSearchParams(body); } catch { return; }
    for (const [key, value] of params) {
      if (!/^req\d+___data__$/.test(key)) continue;
      let data;
      try { data = JSON.parse(value); } catch { continue; }
      messages.push({ url, method: req.method(), data, text: JSON.stringify(data) });
    }
  });

  const adds = () => messages.filter((m) => m.data && m.data.addTarget);
  return {
    messages,
    reset: () => { messages.length = 0; },
    /** Query targets opened for a range, found by the day bound in the query. */
    queriesFor: (day) => adds().filter((m) => m.text.includes(day)),
    /** Their target ids. */
    targetsFor: (day) => adds().filter((m) => m.text.includes(day))
      .map((m) => m.data.addTarget.targetId),
    /** Target ids the client has asked the server to stop watching. */
    removedTargets: () => messages
      .filter((m) => m.data && m.data.removeTarget !== undefined)
      .map((m) => m.data.removeTarget),
    /** Document writes, by collection: ["orders/abc", "menu/fuchka"]. */
    writtenDocs: () => {
      const out = [];
      for (const m of messages) {
        for (const w of (m.data && Array.isArray(m.data.writes) ? m.data.writes : [])) {
          const name = (w.update && w.update.name) || w.delete || '';
          const path = String(name).split('/documents/').pop();
          if (path) out.push(path);
        }
      }
      return out;
    },
    writesTo: (collection) => {
      const prefix = collection + '/';
      const out = [];
      for (const m of messages) {
        for (const w of (m.data && Array.isArray(m.data.writes) ? m.data.writes : [])) {
          const name = (w.update && w.update.name) || w.delete || '';
          const path = String(name).split('/documents/').pop();
          if (path.startsWith(prefix)) out.push(path);
        }
      }
      return out;
    }
  };
}

/** Let the page read and write the clipboard (127.0.0.1 is a secure context). */
export async function grantClipboard(context) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:5173' })
    .catch(() => { /* older Chromium: the write still works, the read may not */ });
}

/**
 * Make every Firestore query fail *permanently*, so the error state can be
 * observed. A plain abort is not enough: an unreachable backend makes the SDK
 * go offline and serve `getDocs` from the local cache, which is the documented
 * behaviour (DECISIONS.md, 20 Oct 2026) and not an error. A 403 is mapped to
 * PERMISSION_DENIED, which is not retryable, so the read really does reject.
 */
export async function breakFirestore(page) {
  await page.route(/127\.0\.0\.1:8080|localhost:8080/, (route) => route.fulfill({
    status: 403,
    contentType: 'text/plain; charset=utf-8',
    // The SDK sends these with credentials, so a wildcard origin would be a
    // CORS console error of the harness's own making.
    headers: {
      'Access-Control-Allow-Origin': 'http://127.0.0.1:5173',
      'Access-Control-Allow-Credentials': 'true'
    },
    body: 'Forbidden'
  }));
}

export async function mendFirestore(page) {
  await page.unroute(/127\.0\.0\.1:8080|localhost:8080/);
}

/** Hold every Firestore request back by `ms`, so "Loading orders…" is visible. */
export async function slowFirestore(page, ms = 2000) {
  await page.route(/127\.0\.0\.1:8080|localhost:8080/, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}
