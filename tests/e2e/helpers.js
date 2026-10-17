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

export async function clearFirestore() {
  const res = await fetch(
    `${EMU}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error(`Could not clear Firestore emulator: ${res.status}`);
  // Let any in-flight write from a closing context land and be swept.
  await new Promise((r) => setTimeout(r, 250));
  const left = await readCollection('orders');
  if (left.length) {
    await fetch(`${EMU}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(data) })
  });
  if (!res.ok) throw new Error(`seedDoc ${collection} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Read a whole collection back out of the emulator. */
export async function readCollection(collection) {
  const res = await fetch(`${DOCS}/${collection}?pageSize=300`);
  if (!res.ok) return [];
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
  await page.addInitScript(() => {
    try {
      if (!window.sessionStorage.getItem('__qa_cleared')) {
        window.localStorage.clear();
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
    if (tender) await tid(page, `tender-${tender}`).click();
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
      total: 1000, payment: 'cash', tendered: 2000, status: 'collected',
      createdAtMs: t(12, 5), startedAtMs: t(12, 6), readyAtMs: t(12, 7), collectedAtMs: t(12, 8)
    },
    {
      orderNo: 'A-002', name: 'Sam', till: 'A', day,
      items: [line('momo', 'Momo', 1), line('chat', 'Papri Chat', 1)],
      total: 1000, payment: 'card', tendered: null, status: 'collected',
      createdAtMs: t(12, 20), startedAtMs: t(12, 21), readyAtMs: t(12, 25), collectedAtMs: t(12, 26)
    },
    {
      orderNo: 'A-003', name: 'Ahmed', till: 'A', day,
      items: [line('fuchka', 'Fuchka / Gol Gappa', 3)],
      total: 1500, payment: 'cash', tendered: 2000, status: 'ready',
      createdAtMs: t(12, 40), startedAtMs: t(12, 41), readyAtMs: t(12, 44)
    },
    {
      orderNo: 'A-004', name: 'Lucy', till: 'A', day,
      items: [line('samosa', 'Sweets Box Samosa / Shingara', 1)],
      total: 500, payment: 'card', tendered: null, status: 'collected',
      createdAtMs: t(13, 10), startedAtMs: t(13, 11), readyAtMs: t(13, 13), collectedAtMs: t(13, 14)
    },
    {
      orderNo: 'A-005', name: 'Josh', till: 'A', day,
      items: [line('momo', 'Momo', 4)],
      total: 2000, payment: 'cash', tendered: 2000, status: 'new',
      createdAtMs: t(13, 40)
    },
    {
      orderNo: 'A-006', name: 'Meera', till: 'A', day,
      items: [line('fountain', 'Chocolate Fountain', 10)],
      total: 5000, payment: 'card', tendered: null, status: 'cancelled',
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
