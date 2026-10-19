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

export async function clearFirestore() {
  const res = await emuFetch(
    `${EMU}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error(`Could not clear Firestore emulator: ${res.status}`);
  // Let any in-flight write from a closing context land and be swept.
  await new Promise((r) => setTimeout(r, 250));
  const left = await readCollection('orders');
  if (left.length) {
    await emuFetch(`${EMU}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    await new Promise((r) => setTimeout(r, 250));
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

/** Tap n times on a menu tile. */
export async function addItem(page, itemId, times = 1) {
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
  if (name) await tid(page, 'customer-name').fill(name);
  if (payment === 'card') await tid(page, 'pay-card').click();
  else {
    const cash = tid(page, 'pay-cash');
    if (await cash.count()) await cash.click();
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
export const signOutButton = (page) => firstOf(page, SIGN_OUT_SEL);

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

export const otherAmount = (page) => firstOf(page, TENDER_OTHER_SEL);
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
