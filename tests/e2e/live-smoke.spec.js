// S-01..S-08 — live smoke against LIVE_URL. Skipped unless LIVE_SMOKE=1,
// so `npm run test:e2e` stays offline and deterministic.
// Run with:  LIVE_SMOKE=1 npx playwright test tests/e2e/live-smoke.spec.js
//
// This hits the REAL shared Firestore, not the emulator. Nothing here deletes
// anything: the QA-SMOKE orders it creates are left in place for Trinity.
//
// CREDENTIALS: read at run time from the gitignored .secrets/app-login.env by
// ./creds.js. The username and password are never recorded, never logged and
// never captured in a screenshot; failed-login cases use a made-up username
// and an obviously fake password. qa/live-smoke-record.txt is committed, so
// record() must only ever be handed values that are safe in public.
import { test, expect } from '@playwright/test';
import {
  attachConsole, realErrors, SHOTS, loginUserField, loginPassField, loginSubmit, firstOf
} from './helpers.js';
import { creds, WRONG_PASSWORD } from './creds.js';
import { resolve } from 'node:path';
import { appendFileSync } from 'node:fs';

const LIVE = process.env.LIVE_URL || 'https://nottinghambengaliassociation.github.io/nba-food-stall-app/';
const ROUTES = ['#/', '#/cash', '#/kitchen', '#/reports'];
const GUARDED = ['#/cash', '#/kitchen', '#/reports'];
// The order-placing test writes to the real project, so run it once, not once
// per viewport. Tablet is the shape a till actually runs on.
const WRITE_PROJECT = 'tablet';
const C = creds();
const FAKE_USER = 'not-a-real-volunteer';

/** Append one line to qa/live-smoke-record.txt immediately. */
function record(line) {
  // eslint-disable-next-line no-console
  console.log(`[LIVE-SMOKE] ${line}`);
  try { appendFileSync(resolve(SHOTS, '../live-smoke-record.txt'), line + '\n'); } catch { /* ignore */ }
}

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const shot = (page, name, full = true) =>
  page.screenshot({ path: resolve(SHOTS, `live-${name}.png`), fullPage: full });

/** Sign in with the real shared account. Nothing here is logged. */
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
 * Read the live project straight from Firestore's REST API, using the web API
 * key the deployed app already serves to every browser. The key is held in a
 * local variable and is never recorded or printed. Read-only: this helper only
 * ever GETs documents or POSTs a runQuery.
 */
async function liveFirestore(path, body) {
  const cfg = await (await fetch(LIVE + 'js/firebase-config.js')).text();
  const apiKey = (cfg.match(/apiKey:\s*["']([^"']+)["']/) || [])[1];
  const projectId = (cfg.match(/projectId:\s*["']([^"']+)["']/) || [])[1];
  if (!apiKey || !projectId) throw new Error('could not read the deployed firebase config');
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const url = `${base}${path}${path.includes('?') ? '&' : '?'}key=${apiKey}`;
  const res = await fetch(url, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
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
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, val(v)]));
}

test.skip(!process.env.LIVE_SMOKE, 'set LIVE_SMOKE=1 to run the live smoke test');
test.describe.configure({ mode: 'serial' });

test('S-01 #/login loads, renders the form and logs no console errors', async ({ page }, info) => {
  const errors = attachConsole(page);
  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });

  const unconfigured = (await page.getByText(/Login not configured/i).count()) > 0;
  record(`S-01 ${info.project.name}: "Login not configured" shown = ${unconfigured}`);
  expect(unconfigured, 'the deployed login-config.js must hold real values, not placeholders').toBe(false);

  const pass = await loginPassField(page);
  await expect(await loginUserField(page), 'the Username field must render').toBeVisible({ timeout: 30000 });
  await expect(pass, 'the Password field must render').toBeVisible();
  await expect(await loginSubmit(page), 'the Sign in button must render').toBeVisible();
  expect(await pass.getAttribute('type'), 'the password must stay masked for the screenshot').toBe('password');
  await expect(page.getByText(/One shared login for stall volunteers/)).toBeVisible();

  await page.waitForTimeout(2000);
  await shot(page, `${info.project.name}-login`);

  const real = realErrors(errors);
  record(`S-01 ${info.project.name}: PASS - #/login rendered the form, screenshot live-${info.project.name}-login.png, ${real.length} console errors${real.length ? ': ' + real.join(' | ') : ''}`);
  expect(real, `console errors on the live #/login:\n${real.join('\n')}`).toEqual([]);
});

test('S-02 the route guard redirects every guarded route to #/login', async ({ page }, info) => {
  const errors = attachConsole(page);
  for (const route of GUARDED) {
    await page.goto(LIVE + route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash, `${route} with no session must redirect to #/login on the live site`).toMatch(/^#\/login/);
    await expect(await loginSubmit(page)).toBeVisible({ timeout: 20000 });
    const session = await page.evaluate(() => window.localStorage.getItem('nba.session'));
    expect(session, 'no session may be created by the guard').toBeNull();
  }
  const real = realErrors(errors);
  record(`S-02 ${info.project.name}: PASS - ${GUARDED.join(', ')} all redirected to #/login with no session, ${real.length} console errors`);
  expect(real, `console errors while being redirected:\n${real.join('\n')}`).toEqual([]);
});

test('S-03 a wrong password is rejected and the real credentials sign in', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await page.goto(LIVE + '#/login', { waitUntil: 'domcontentloaded' });
  await (await loginSubmit(page)).waitFor({ state: 'visible', timeout: 30000 });

  // Made-up username, obviously fake password: safe to capture.
  await (await loginUserField(page)).fill(FAKE_USER);
  await (await loginPassField(page)).fill(WRONG_PASSWORD);
  await (await loginSubmit(page)).click();

  const alert = page.locator('[role="alert"]').first();
  await expect(alert, 'a wrong password must show the error box').toBeVisible({ timeout: 20000 });
  expect(norm(await alert.innerText())).toBe('Username or password is wrong. Check and try again.');
  const passField = await loginPassField(page);
  expect(await passField.inputValue(), 'the password must be cleared').toBe('');
  expect(await passField.getAttribute('type'), 'the password must stay masked').toBe('password');
  expect(await page.evaluate(() => window.localStorage.getItem('nba.session'))).toBeNull();
  await shot(page, `${info.project.name}-login-error`);
  record(`S-03a ${info.project.name}: PASS - wrong password (made-up username) showed the exact error, password cleared, no session; screenshot live-${info.project.name}-login-error.png`);

  // Now the real credentials.
  await (await loginUserField(page)).fill(C.user);
  await (await loginPassField(page)).fill(C.password);
  await (await loginSubmit(page)).click();
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 30000 }).toBe('#/');
  const session = await page.evaluate(() => {
    const raw = window.localStorage.getItem('nba.session');
    return raw ? JSON.parse(raw) : null;
  });
  expect(session, 'a correct sign-in must store nba.session').toBeTruthy();
  expect(Object.keys(session).sort()).toEqual(['at', 'user']);

  const real = realErrors(errors);
  record(`S-03b ${info.project.name}: PASS - the real credentials signed in and landed on #/ with a {user,at} session, ${real.length} console errors${real.length ? ': ' + real.join(' | ') : ''}`);
  expect(real).toEqual([]);
});

test('S-04 every route loads signed in, with no console errors', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  const errors = attachConsole(page);
  await signInLive(page);
  for (const route of ROUTES) {
    const name = route === '#/' ? 'landing' : route.replace('#/', '');
    await page.goto(LIVE + route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header').first(), `${route} did not render on the live site`).toBeVisible({ timeout: 30000 });
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash, `${route} bounced away while signed in`).toMatch(new RegExp('^' + route.replace('/', '\\/')));
    await page.waitForTimeout(3000);
    await shot(page, `${info.project.name}-${name}`);
    record(`S-04 ${info.project.name}: ${route} loaded signed in, screenshot live-${info.project.name}-${name}.png`);
  }
  const real = realErrors(errors);
  record(`S-04 ${info.project.name}: ${real.length ? 'FAIL' : 'PASS'} - ${ROUTES.length} routes loaded signed in, ${real.length} console errors${real.length ? ': ' + real.join(' | ') : ''}`);
  if (errors.length) record(`S-04 ${info.project.name} raw console output (incl. ignored noise): ${errors.join(' | ')}`);
  expect(real, `console errors on the live site:\n${real.join('\n')}`).toEqual([]);
});

test('S-05 the connection pill reads Online and the config banner is absent', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  await signInLive(page);
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const bannerShown = (await page.getByText(/storage not configured/i).count()) > 0;
  expect(bannerShown, 'the deployed firebase-config.js must be wired up, so the banner must be absent').toBe(false);

  const pill = page.locator('[data-testid="conn-pill"]');
  await expect(pill.first(), 'the cash screen must show a connection pill').toBeVisible({ timeout: 20000 });
  await expect(pill.first()).toContainText(/Online/i, { timeout: 25000 });
  await shot(page, `${info.project.name}-cash-pill`, false);
  record(`S-05 ${info.project.name}: PASS - no "Storage not configured" banner, connection pill reads "${norm(await pill.first().innerText())}"`);
});

test('S-06 Sign out clears the session, keeps the till letter and returns to #/login', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  await signInLive(page);

  // Set a non-default till so "the till letter survives" means something.
  const till = page.locator('[data-testid="till-letter"]');
  await expect(till).toBeVisible({ timeout: 20000 });
  const tag = await till.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') await till.selectOption('C');
  else { await till.fill('C'); await till.blur(); }
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => ({ ...window.localStorage }));

  await (await firstOf(page, [
    'header [data-testid="sign-out"]', 'header [aria-label="Sign out"]',
    'header button:has-text("Sign out")', 'header a:has-text("Sign out")'
  ])).click();

  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 20000 }).toMatch(/^#\/login/);
  const after = await page.evaluate(() => ({ ...window.localStorage }));
  expect(after['nba.session'], 'sign out must clear nba.session').toBeUndefined();
  const appKeys = Object.keys(before).filter((k) =>
    k !== 'nba.session' && !/^(firestore|firebase|__)/i.test(k));
  for (const k of appKeys) {
    expect(after[k], `sign out dropped ${k}; the till letter must survive`).toBe(before[k]);
  }
  expect(Object.values(after), 'the till letter C must survive the sign out').toContain('C');
  await shot(page, `${info.project.name}-signed-out`);
  record(`S-06 ${info.project.name}: PASS - sign out returned to #/login, nba.session cleared, till letter C and ${appKeys.length} app key(s) preserved`);
});

test('S-07 Cash received calculator on the live cash counter', async ({ page }, info) => {
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');
  await signInLive(page);
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  const tile = page.locator('[data-testid="tile-fuchka"]');
  await expect(tile, 'the live menu must render').toBeVisible({ timeout: 30000 });

  for (let i = 0; i < 3; i++) { await tile.click(); await page.waitForTimeout(150); }
  await expect(page.locator('[data-testid="order-total"]')).toContainText('£15.00');
  const cash = page.locator('[data-testid="pay-cash"]');
  if (await cash.count()) await cash.click();
  // H3 (v1.3.1): the short wording applies to every viewport below 700 px.
  const phone = (page.viewportSize()?.width ?? 1280) < 700;
  const body = () => page.locator('body').innerText().then(norm);

  // Exact = the order total.
  await (await firstOf(page, ['[data-testid="tender-exact"]', 'button:text-is("Exact")'])).click();
  await page.waitForTimeout(600);
  expect(await body(), 'Exact must read as change £0.00')
    .toContain(phone ? 'Change £0.00' : 'Change to give: £0.00');
  record(`S-07a ${info.project.name}: PASS - Exact on a £15.00 order shows "${phone ? 'Change £0.00' : 'Change to give: £0.00'}"`);

  // A short amount.
  const other = await firstOf(page, ['[data-testid="tender-other"]', 'input[inputmode="decimal"]']);
  await other.fill('10');
  await page.waitForTimeout(600);
  expect(await body(), 'a short amount must read as Short by £5.00')
    .toContain(phone ? 'Short £5.00' : 'Short by £5.00');
  expect(await page.locator('[data-testid="send-order"]').isDisabled(), 'a short amount must not block sending').toBe(false);
  record(`S-07b ${info.project.name}: PASS - £10 on a £15.00 order shows "${phone ? 'Short £5.00' : 'Short by £5.00'}" and Send stays enabled`);

  // A change state for the screenshot, then leave the panel unsent.
  await other.fill('20');
  await page.waitForTimeout(600);
  expect(await body()).toContain(phone ? 'Change £5.00' : 'Change to give: £5.00');
  await shot(page, `${info.project.name}-cash-received`);
  record(`S-07c ${info.project.name}: PASS - £20 on a £15.00 order shows "${phone ? 'Change £5.00' : 'Change to give: £5.00'}"; screenshot live-${info.project.name}-cash-received.png (order left unsent)`);
});

test('S-08 QA-SMOKE order round trip against the real project', async ({ page }, info) => {
  test.skip(info.project.name !== WRITE_PROJECT, `writes to the real project run once, on ${WRITE_PROJECT} only`);
  test.skip(!C.available, 'no .secrets/app-login.env on this machine');

  await signInLive(page);
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  test.skip((await page.getByText(/storage not configured/i).count()) > 0, 'live Firebase is not configured; QA-SMOKE order skipped');

  const tile = page.locator('[data-testid="tile-momo"]');
  await expect(tile, 'the live menu must render (seeded on first load if empty)').toBeVisible({ timeout: 30000 });

  const day = await page.evaluate(() => {
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
    return `${p.year}-${p.month}-${p.day}`;
  });
  record(`S-08 London day for the smoke orders: ${day}`);

  const send = async (name, { tender = null } = {}) => {
    await tile.click();
    await page.locator('[data-testid="customer-name"]').fill(name);
    if (tender) {
      const cash = page.locator('[data-testid="pay-cash"]');
      if (await cash.count()) await cash.click();
      await (await firstOf(page, [`[data-testid="tender-${tender}"]`, `button:text-is("£${tender / 100}")`])).click();
      await page.waitForTimeout(400);
    } else {
      await page.locator('[data-testid="pay-card"]').click();
    }
    await page.locator('[data-testid="send-order"]').click();
    const toast = page.locator('[data-testid="order-toast"]');
    await expect(toast).toBeVisible({ timeout: 25000 });
    const no = ((await toast.innerText()).match(/[A-Z]-\d{3}/) || [])[0];
    expect(no, 'the live till must issue an order number').toBeTruthy();
    return no;
  };

  // Order 1: cash with £20 keyed into Cash received on a £5.00 order.
  const first = await send('QA-SMOKE', { tender: 2000 });
  record(`S-08 CREATED LIVE ORDER 1: ${first} name=QA-SMOKE payment=cash cash-received-keyed=£20 day=${day} (to be taken to collected)`);
  await shot(page, 'cash-qa-smoke-sent', false);

  await page.goto(LIVE + '#/kitchen', { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`[data-testid="order-card-${first}"]`), `${first} must reach the live kitchen`).toBeVisible({ timeout: 30000 });
  await shot(page, 'kitchen-qa-smoke', false);

  for (const step of ['Start', 'Ready', 'Collected']) {
    const action = page.locator(`[data-testid="action-${first}"]`);
    await expect(action, `${step} for ${first}`).toBeVisible({ timeout: 30000 });
    await action.click();
    await page.waitForTimeout(1500);
  }
  await expect(
    page.locator(`[data-testid="order-card-${first}"]`),
    'a collected order must leave the live kitchen board'
  ).toHaveCount(0, { timeout: 25000 });
  record(`S-08 ${first} went New -> Preparing -> Ready -> Collected and left the kitchen board`);

  // Order 2: cancelled from the till.
  await page.goto(LIVE + '#/cash', { waitUntil: 'domcontentloaded' });
  await expect(tile).toBeVisible({ timeout: 30000 });
  const second = await send('QA-SMOKE');
  record(`S-08 CREATED LIVE ORDER 2: ${second} name=QA-SMOKE payment=card day=${day} (to be cancelled)`);

  const cancel = page.locator(`[data-testid="cancel-${second}"]`);
  await expect(cancel, 'cancel must be available while the live order is new').toBeVisible({ timeout: 25000 });
  await cancel.click();
  await expect(page.locator(`[data-testid="recent-${second}"]`)).toContainText(/cancel/i, { timeout: 25000 });
  record(`S-08 ${second} cancelled from the recent strip`);
  await shot(page, 'cash-qa-smoke-cancelled', false);

  // THE KEY ASSERTION: the documents in the real project carry no trace of
  // cash received.
  const query = await liveFirestore('/:runQuery', {
    structuredQuery: {
      from: [{ collectionId: 'orders' }],
      where: { fieldFilter: { field: { fieldPath: 'day' }, op: 'EQUAL', value: { stringValue: day } } },
      limit: 100
    }
  });
  const today = query.filter((r) => r.document).map((r) => plain(r.document.fields));
  const smoke = today.filter((o) => o.name === 'QA-SMOKE');
  record(`S-08 live Firestore holds ${today.length} order(s) for ${day}, ${smoke.length} named QA-SMOKE: ${smoke.map((o) => `${o.orderNo}/${o.status}/${o.payment}`).join(', ')}`);
  expect(smoke.map((o) => o.orderNo).sort(), 'both smoke orders must be in the live project').toEqual([first, second].sort());

  for (const o of smoke) {
    const keys = Object.keys(o);
    expect(keys, `${o.orderNo} must not store tendered (cash received is screen-only)`).not.toContain('tendered');
    expect(keys, `${o.orderNo} must not store changeGiven`).not.toContain('changeGiven');
  }
  const one = smoke.find((o) => o.orderNo === first);
  record(`S-08 PASS - KEY ASSERTION: ${first} was sent with £20 keyed in and its live document keys are [${Object.keys(one).sort().join(', ')}] - no tendered, no changeGiven`);
  expect(one.payment).toBe('cash');
  expect(one.status).toBe('collected');

  // The live menu must hold the seven H3 documents, untouched by this run.
  // CLAUDE.md -> Menu / H3 7: scripts/reset-live.mjs leaves exactly these and
  // deletes `samosa`, `straw` and `fountain`.
  const menu = await liveFirestore('/menu?pageSize=50');
  const menuIds = (menu.documents || []).map((d) => d.name.split('/').pop()).sort();
  record(`S-08 live menu intact: ${menuIds.length} documents [${menuIds.join(', ')}]`);
  expect(menuIds, 'the live menu must hold the seven H3 items').toEqual(
    ['chat', 'choc_strawberry', 'fuchka', 'marshmallow', 'momo', 'samosa_only', 'sweet_box']
  );

  // The collected order counts, the cancelled one does not.
  await page.goto(LIVE + '#/reports', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="kpi-orders"]')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);
  const orders = norm(await page.locator('[data-testid="kpi-orders"]').innerText());
  const sales = norm(await page.locator('[data-testid="kpi-sales"]').innerText());
  await shot(page, 'reports-qa-smoke');
  record(`S-08 live reports for ${day}: orders=${orders} sales=${sales} (cancelled ${second} excluded)`);
  expect(orders, 'the cancelled order must not be counted').toMatch(/\b1\b/);
});
