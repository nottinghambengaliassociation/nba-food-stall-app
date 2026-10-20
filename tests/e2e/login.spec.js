/**
 * G-01..G-20 — login, session, route guard and sign out.
 * Spec: CLAUDE.md -> "Login and sign out" 1..9, mock-ups design/Login.dc.html
 * and design/LoginMobile.dc.html.
 *
 * CREDENTIALS: read at run time from the gitignored .secrets/app-login.env by
 * ./creds.js. Nothing in this file contains the real username or password, and
 * no assertion message ever interpolates them. Failed logins use the obviously
 * fake WRONG_PASSWORD. Screenshots are taken with the password field masked.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { creds, WRONG_PASSWORD, PLACEHOLDER_CONFIG_BODY, loginConfigured } from './creds.js';
import { seedSession, readSession, SESSION_KEY } from './session.js';
import {
  clearFirestore, attachConsole, expectNoConsoleErrors, realErrors, heightOf, boxOf,
  loginUserField, loginPassField, loginSubmit, signIn, signOutButton, firstOf, anyOf,
  tid, addItem, gotoRoute, shot, SHOTS, placeOrder, waitForOrders, readCollection, setTill, londonDay,
  openCashPanel, closeCashPanel
} from './helpers.js';

const C = creds();
const HAVE_CREDS = C.available && loginConfigured();
const SKIP_MSG = 'no usable .secrets/app-login.env + public/js/login-config.js on this machine';

// Every route other than #/login is guarded (CLAUDE.md Login 6), including
// the Phase IV orders list and the Phase VI order history.
const GUARDED = ['#/', '#/cash', '#/kitchen', '#/reports', '#/reports/days', '#/reports/orders', '#/reports/history'];

/** Open the app signed out. localStorage is cleared once per tab, not per load. */
async function freshPage(page, route = '#/login') {
  const errors = attachConsole(page);
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
  await (await loginSubmit(page)).waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  return errors;
}

/** Open the app already signed in (session seeded, not typed). */
async function signedInPage(page, context, route = '#/') {
  const errors = attachConsole(page);
  await seedSession(context, C.user || 'volunteer');
  await page.goto('/' + route);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
  return errors;
}

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

function rgb(str) {
  const m = String(str).match(/(\d+(?:\.\d+)?)/g);
  return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
}
const isRed = ([r, g, b]) => r >= 120 && r >= g + 60 && r >= b + 60;

test.describe('Phase II A — login screen', () => {
  test('G-01 login screen furniture: logo, headings, fields, helper line', async ({ page }, info) => {
    const errors = await freshPage(page);

    const logo = page.locator('img[src*="nba-logo"], img[alt*="Nottingham" i]').first();
    await expect(logo, 'CLAUDE.md Login 1: the NBA logo public/img/nba-logo.png').toBeVisible();
    expect(norm(await logo.getAttribute('alt')), 'the logo needs a non-empty alt').not.toBe('');
    const logoBox = await boxOf(logo);
    const want = info.project.name === 'phone' ? 132 : 168;
    expect(
      Math.round(logoBox.width),
      `logo is ${Math.round(logoBox.width)}px wide; the mock-ups use ${want}px (CLAUDE.md Login 1: "about 168 px tablet, 132 px phone")`
    ).toBeGreaterThanOrEqual(want - 12);
    expect(Math.round(logoBox.width)).toBeLessThanOrEqual(want + 12);

    await expect(
      page.getByRole('heading', { name: /Nottingham Bengali Association/ }).first(),
      'CLAUDE.md Login 1: heading "Nottingham Bengali Association"'
    ).toBeVisible();

    const sub = page.getByText('Food Stall Application', { exact: true }).first();
    await expect(sub, 'CLAUDE.md Login 1: subheading "Food Stall Application"').toBeVisible();
    const subColour = await sub.evaluate((el) => getComputedStyle(el).color);
    expect(rgb(subColour), `subheading colour is ${subColour}; CLAUDE.md Design: NBA red dark #B5050F`).toEqual([181, 5, 15]);

    const user = await loginUserField(page);
    const pass = await loginPassField(page);
    await expect(user).toBeVisible();
    await expect(pass).toBeVisible();
    expect(await pass.getAttribute('type')).toBe('password');

    // Both fields are labelled (real <label>, aria-label or aria-labelledby).
    for (const [name, field] of [['Username', user], ['Password', pass]]) {
      const labelled = await field.evaluate((el) => {
        const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        return !!(byFor || el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'));
      });
      expect(labelled, `the ${name} input has no associated label`).toBe(true);
    }

    const helper = norm(await page.locator('body').innerText());
    expect(
      helper,
      'CLAUDE.md Login 1 helper line'
    ).toContain("One shared login for stall volunteers. Ask the stall lead if you don't have it.");

    await expectNoConsoleErrors(errors, '#/login');
  });

  test('G-02 field and button sizes', async ({ page }, info) => {
    await freshPage(page);
    const minField = info.project.name === 'phone' ? 56 : 60;
    for (const [name, loc] of [['Username', await loginUserField(page)], ['Password', await loginPassField(page)]]) {
      const h = await heightOf(loc);
      expect(
        h,
        `${name} field is ${h}px tall; CLAUDE.md Login 1 says 60 px (mock-up uses ${minField}px at this size)`
      ).toBeGreaterThanOrEqual(minField - 1);
    }
    const submit = await loginSubmit(page);
    const h = await heightOf(submit);
    expect(h, `Sign in is ${h}px tall; CLAUDE.md Login 1: "at least 64 px"`).toBeGreaterThanOrEqual(63.5);
    const style = await submit.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, fg: s.color, text: (el.innerText || '').trim() };
    });
    expect(rgb(style.bg), `Sign in background is ${style.bg}; CLAUDE.md Login 1: #B5050F`).toEqual([181, 5, 15]);
    expect(rgb(style.fg), `Sign in text colour is ${style.fg}; CLAUDE.md Login 1: white text`).toEqual([255, 255, 255]);
    expect(style.text).toMatch(/Sign in/i);
  });

  test('G-03 Show/Hide sits inside the password field and toggles it', async ({ page }) => {
    await freshPage(page);
    const pass = await loginPassField(page);
    const located = await firstOf(page, [
      '[data-testid="toggle-password"]',
      '[data-testid="login-show"]',
      'button:text-is("Show")',
      'button:text-is("Hide")',
      'button[aria-pressed]'
    ]);
    await expect(located, 'CLAUDE.md Login 1: a Show/Hide button inside the password field').toBeVisible();
    // Hold a handle: the button's own label changes, so a text-based locator
    // would stop matching after the first click.
    const toggle = await located.elementHandle();
    const info = async () => toggle.evaluate((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(),
      pressed: el.getAttribute('aria-pressed'),
      box: (({ x, y, width, height }) => ({ x, y, width, height }))(el.getBoundingClientRect())
    }));

    let state = await info();
    expect(state.tag).toBe('button');
    expect(state.type).toBe('button');

    const passBox = await boxOf(pass);
    const togBox = state.box;
    expect(
      togBox.x >= passBox.x - 2 && togBox.x + togBox.width <= passBox.x + passBox.width + 2 &&
      togBox.y >= passBox.y - 2 && togBox.y + togBox.height <= passBox.y + passBox.height + 2,
      `the Show/Hide button (${JSON.stringify(togBox)}) is not inside the password field (${JSON.stringify(passBox)})`
    ).toBe(true);
    expect(togBox.height, 'the Show/Hide control should be a comfortable tap target').toBeGreaterThanOrEqual(43.5);

    expect(state.text, 'the control reads "Show" while the password is masked').toMatch(/^Show$/i);
    await toggle.click();
    await expect.poll(() => pass.getAttribute('type')).toBe('text');
    state = await info();
    expect(state.text, 'the control reads "Hide" while the password is visible').toMatch(/^Hide$/i);
    expect(state.pressed).toBe('true');
    await toggle.click();
    await expect.poll(() => pass.getAttribute('type')).toBe('password');
    state = await info();
    expect(state.pressed).toBe('false');
    expect(state.text).toMatch(/^Show$/i);
  });

  test('G-04 "Login not configured" when the config is a placeholder or missing', async ({ page }) => {
    // (a) placeholders
    await page.route('**/login-config.js', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: PLACEHOLDER_CONFIG_BODY }));
    const errors = await freshPage(page);
    await expect(
      page.getByText(/Login not configured/i).first(),
      'CLAUDE.md Login 4: "If login-config.js is missing or has placeholders: show \'Login not configured\'"'
    ).toBeVisible({ timeout: 15000 });
    expect(await page.locator('input[type="password"]').count(), 'no form is shown in the unconfigured state').toBe(0);
    await expectNoConsoleErrors(errors, '#/login with placeholder config');
    await page.unroute('**/login-config.js');

    // (b) missing entirely
    const page2 = await page.context().newPage();
    const errors2 = attachConsole(page2);
    await page2.route('**/login-config.js', (route) => route.fulfill({ status: 404, body: 'not found' }));
    await page2.goto('/#/login');
    await expect(page2.getByText(/Login not configured/i).first()).toBeVisible({ timeout: 15000 });
    expect(await page2.locator('input[type="password"]').count()).toBe(0);
    const uncaught = realErrors(errors2).filter((e) => e.startsWith('pageerror:'));
    expect(uncaught, 'a missing login-config.js must not crash the app').toEqual([]);
    await page2.close();
  });

  test('G-20 login screenshots, password always masked', async ({ page }, info) => {
    await freshPage(page);
    const pass = await loginPassField(page);
    expect(await pass.getAttribute('type'), 'a screenshot must never reveal the password').toBe('password');
    await shot(page, info.project.name, 'login', 'empty');

    // The error state, driven with an obviously fake password.
    await signIn(page, 'volunteer', WRONG_PASSWORD);
    await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 10000 });
    expect(await (await loginPassField(page)).getAttribute('type')).toBe('password');
    await shot(page, info.project.name, 'login', 'error');
  });

  test('G-19 login screen quality: axe, console, 360px, Enter submits', async ({ page }) => {
    const errors = await freshPage(page);
    const a11y = await new AxeBuilder({ page }).analyze();
    const bad = a11y.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    expect(bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`), 'axe on #/login').toEqual([]);

    const fontSize = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    expect(fontSize, 'CLAUDE.md Design: body text at least 17px').toBeGreaterThanOrEqual(16.9);

    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth
    }));
    expect(overflow.scroll, 'CLAUDE.md Design: no horizontal scroll at 360px').toBeLessThanOrEqual(overflow.client + 1);

    // Enter in the password field submits the form (it is a real <form>).
    const pass = await loginPassField(page);
    await (await loginUserField(page)).fill('someone');
    await pass.fill(WRONG_PASSWORD);
    await pass.press('Enter');
    await expect(page.locator('[role="alert"]').first(), 'Enter must submit the login form').toBeVisible({ timeout: 10000 });
    await expectNoConsoleErrors(errors, '#/login');
  });
});

test.describe('Phase II A — credentials', () => {
  test.skip(!HAVE_CREDS, SKIP_MSG);

  test('G-05 correct credentials sign in and write the session', async ({ page }) => {
    const errors = await freshPage(page);
    const before = Date.now();
    await signIn(page, C.user, C.password);
    await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 15000 }).toBe('#/');

    const session = await readSession(page);
    expect(session, 'CLAUDE.md Login 5: localStorage["nba.session"]').toBeTruthy();
    expect(Object.keys(session).sort(), 'session shape is {"user","at"}').toEqual(['at', 'user']);
    expect(String(session.user).toLowerCase()).toBe(C.user.trim().toLowerCase());
    expect(typeof session.at).toBe('number');
    expect(session.at).toBeGreaterThanOrEqual(before - 60000);
    expect(session.at).toBeLessThanOrEqual(Date.now() + 1000);

    // The plain password must not be parked in storage anywhere.
    const dump = await page.evaluate(() => JSON.stringify([window.localStorage, window.sessionStorage]));
    expect(dump.includes(C.password), 'the plain password must never be stored').toBe(false);
    await expectNoConsoleErrors(errors, 'sign in');
  });

  test('G-06 username is trimmed and case-insensitive', async ({ page }) => {
    await freshPage(page);
    await signIn(page, `  ${C.user.toUpperCase()}  `, C.password);
    await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 15000 }).toBe('#/');
    expect(await readSession(page), 'CLAUDE.md Login 2: username trimmed and case-insensitive').toBeTruthy();
  });

  test('G-07 the password is matched exactly', async ({ page }) => {
    await freshPage(page);
    const variants = [` ${C.password}`];
    const flipped = C.password.split('').map((c) =>
      c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()).join('');
    if (flipped !== C.password) variants.push(flipped);

    for (const [i, variant] of variants.entries()) {
      await signIn(page, C.user, variant);
      await expect(
        page.locator('[role="alert"]').first(),
        `password variant ${i + 1} (whitespace/case change) must be rejected: CLAUDE.md Login 2 "password exact"`
      ).toBeVisible({ timeout: 10000 });
      expect(await readSession(page)).toBeNull();
      expect(await page.evaluate(() => window.location.hash)).toMatch(/#\/login/);
    }
  });

  test('G-08 wrong attempt: message, red fields, cleared and refocused password', async ({ page }) => {
    await freshPage(page);
    const user = await loginUserField(page);
    const pass = await loginPassField(page);
    const borderBefore = {
      user: await user.evaluate((el) => getComputedStyle(el).borderTopColor),
      pass: await pass.evaluate((el) => getComputedStyle(el).borderTopColor)
    };

    await signIn(page, C.user, WRONG_PASSWORD);

    const alert = page.locator('[role="alert"]').first();
    await expect(alert, 'CLAUDE.md Login 3: a red role="alert" box').toBeVisible({ timeout: 10000 });
    expect(
      norm(await alert.innerText()),
      'CLAUDE.md Login 3 exact wording'
    ).toBe('Username or password is wrong. Check and try again.');

    for (const [name, field] of [['username', user], ['password', pass]]) {
      const colour = await field.evaluate((el) => getComputedStyle(el).borderTopColor);
      expect(isRed(rgb(colour)), `the ${name} field border is ${colour}; CLAUDE.md Login 3: "outline both fields red"`).toBe(true);
      expect(colour, `the ${name} border did not change from its resting colour`).not.toBe(borderBefore[name]);
    }

    expect(await pass.inputValue(), 'CLAUDE.md Login 3: "clear the password"').toBe('');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), id: el.id } : null;
    });
    const passId = await pass.getAttribute('id');
    expect(
      focused && focused.tag === 'input' && (focused.type === 'password' || focused.type === 'text') &&
      (!passId || focused.id === passId),
      `CLAUDE.md Login 3: "focus the password field"; focus is on ${JSON.stringify(focused)}`
    ).toBe(true);

    expect(await readSession(page)).toBeNull();
    expect(await page.evaluate(() => window.location.hash)).toMatch(/#\/login/);
    // No screenshot here: the username field still holds the real shared
    // username and qa/screenshots/ is committed. G-20 captures the error state
    // with a made-up username instead.
  });

  test('G-09 no lockout, no attempt counter, no delay', async ({ page }) => {
    await freshPage(page);
    const pass = await loginPassField(page);
    const submit = await loginSubmit(page);
    const alert = page.locator('[role="alert"]').first();
    const timings = [];

    for (let i = 1; i <= 12; i++) {
      await (await loginUserField(page)).fill(C.user);
      await pass.fill(`${WRONG_PASSWORD}-${i}`);
      const t0 = Date.now();
      await submit.click();
      await expect(alert, `attempt ${i} produced no error message`).toBeVisible({ timeout: 10000 });
      await expect.poll(() => pass.inputValue()).toBe('');
      timings.push(Date.now() - t0);

      expect(await submit.isDisabled(), `Sign in was disabled after ${i} wrong attempts; CLAUDE.md Login 3: "No lockout"`).toBe(false);
      expect(await pass.isDisabled(), `the password field was disabled after ${i} wrong attempts`).toBe(false);
      expect(await pass.evaluate((el) => el.readOnly), `the password field went read-only after ${i} wrong attempts`).toBe(false);
      expect(await readSession(page)).toBeNull();
    }

    const body = norm(await page.locator('body').innerText()).toLowerCase();
    for (const word of ['attempt', 'locked', 'lock out', 'too many', 'try again in', 'remaining', 'seconds']) {
      expect(body.includes(word), `the login screen shows "${word}" after 12 wrong attempts; CLAUDE.md Login 3: "No lockout, no attempt counter, no delay, unlimited retries"`).toBe(false);
    }
    expect(Math.max(...timings), `slowest wrong attempt took ${Math.max(...timings)}ms; the brief allows no delay`).toBeLessThan(1500);
    expect(
      timings[11] - timings[0],
      `attempt 12 took ${timings[11]}ms vs attempt 1 at ${timings[0]}ms — that is an escalating delay`
    ).toBeLessThan(500);

    // The 13th attempt, with the right password, must work straight away.
    await signIn(page, C.user, C.password);
    await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 15000 }).toBe('#/');
    expect(await readSession(page), 'a correct attempt straight after 12 wrong ones must sign in').toBeTruthy();
  });

});

test.describe('Phase II A — route guard and session', () => {
  test('G-10 signed out, every guarded route redirects to #/login', async ({ page }) => {
    const errors = await freshPage(page, '#/cash');
    for (const route of [...GUARDED, '#/nope']) {
      await page.evaluate((r) => { window.location.hash = r.replace(/^#/, '#'); }, route);
      await page.waitForTimeout(500);
      const hash = await page.evaluate(() => window.location.hash);
      expect(hash, `CLAUDE.md Login 6: ${route} with no session must redirect to #/login`).toMatch(/^#\/login/);
      await expect(await loginSubmit(page)).toBeVisible();
      // No content from the guarded screen is left behind.
      expect(await tid(page, 'send-order').count(), 'cash UI leaked through the guard').toBe(0);
      expect(await tid(page, 'report-date').count(), 'reports UI leaked through the guard').toBe(0);
    }
    // Same by deep link / full load.
    for (const route of GUARDED) {
      await page.goto('/' + route);
      await page.waitForTimeout(600);
      expect(await page.evaluate(() => window.location.hash), `deep link ${route}`).toMatch(/^#\/login/);
    }
    await expectNoConsoleErrors(errors, 'route guard');
  });

  test('G-11 signed in, #/login redirects to #/', async ({ page, context }) => {
    await signedInPage(page, context, '#/login');
    await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 10000 }).toBe('#/');
    await expect(tid(page, 'nav-cash')).toBeVisible();
  });

  test('G-12 the session has no expiry: reloads and an offline spell keep it', async ({ page, context }) => {
    await signedInPage(page, context, '#/');
    for (const route of GUARDED) {
      await page.goto('/' + route);
      await page.waitForTimeout(400);
      await page.reload();
      await page.waitForTimeout(600);
      expect(await page.evaluate(() => window.location.hash), `reloading ${route} signed the volunteer out`).toMatch(new RegExp('^' + route.replace('/', '\\/')));
      expect(await readSession(page), `the session was dropped on ${route}`).toBeTruthy();
    }
    await context.setOffline(true);
    await page.goto('/#/cash');
    await page.waitForTimeout(800);
    expect(await readSession(page), 'CLAUDE.md Login 5: a dropped connection never sends a volunteer back to the login screen').toBeTruthy();
    expect(await page.evaluate(() => window.location.hash)).toBe('#/cash');
    await context.setOffline(false);
  });
});

test.describe('Phase II A — sign out', () => {
  test.beforeEach(async () => { await clearFirestore(); });

  test('G-13 Sign out is last in the dark header on every screen', async ({ page, context }, info) => {
    await signedInPage(page, context, '#/');
    const phone = info.project.name === 'phone';
    const small = (page.viewportSize()?.width ?? 1280) < 700;
    for (const route of GUARDED) {
      await gotoRoute(page, route);
      await expect(page.locator('header').first()).toBeVisible();
      await page.waitForTimeout(300);

      // Hotfix H3 1: below 700 px the cash counter's header is one 52 px row
      // (till picker, connection, next number, ☰) and Sign out moves into the
      // ☰ dropdown, red, still keeping the unsent-order confirm. Everything
      // else keeps the Login 7 header button.
      if (small && route === '#/cash') {
        const menuButton = tid(page, 'menu-button');
        await expect(menuButton, 'CLAUDE.md H3 1: the small cash header carries ☰').toBeVisible();
        expect(await menuButton.getAttribute('aria-expanded')).toBe('false');
        await menuButton.click();
        const item = tid(page, 'menu-signout');
        await expect(item, 'CLAUDE.md H3 1: ☰ lists Sign out').toBeVisible();
        expect(norm(await item.innerText())).toMatch(/Sign out/i);
        const geo = await item.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const menu = el.closest('[data-testid="app-menu"]');
          const siblings = [...menu.querySelectorAll('button, a[href]')];
          return {
            height: r.height,
            lastInteractive: siblings[siblings.length - 1] === el,
            colour: getComputedStyle(el).color
          };
        });
        expect(geo.height, 'the menu item is a 48px touch target').toBeGreaterThanOrEqual(47.5);
        expect(geo.lastInteractive, 'CLAUDE.md H3 1 lists Sign out last in the ☰ menu').toBe(true);
        const [r, g, b] = (geo.colour.match(/\d+/g) || []).map(Number);
        expect(r > 120 && g < 90 && b < 90, `Sign out is ${geo.colour}; CLAUDE.md H3 1 draws it red`).toBe(true);
        await page.keyboard.press('Escape');
        continue;
      }

      const inHeader = page.locator('header').first().locator(
        '[data-testid="sign-out"], [aria-label="Sign out"], button:has-text("Sign out"), a:has-text("Sign out")'
      );
      expect(await inHeader.count(), `${route}: CLAUDE.md Login 7 wants exactly one Sign out in the header`).toBe(1);
      const btn = inHeader.first();
      await expect(btn).toBeVisible();

      const geometry = await page.locator('header').first().evaluate((header, testid) => {
        const controls = [...header.querySelectorAll('button, a[href], input, select, [role=button]')]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        const so = controls.find((el) =>
          el.dataset.testid === 'sign-out' ||
          el.getAttribute('aria-label') === 'Sign out' ||
          /sign out/i.test((el.textContent || '').trim()));
        if (!so) return null;
        const r = so.getBoundingClientRect();
        const others = controls.filter((el) => el !== so).map((el) => ({
          id: el.dataset.testid || (el.textContent || '').trim().slice(0, 16),
          right: Math.round(el.getBoundingClientRect().right)
        }));
        return {
          right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height),
          text: (so.innerText || '').trim(),
          ariaLabel: so.getAttribute('aria-label'),
          hasSvg: !!so.querySelector('svg'),
          others
        };
      }, 'sign-out');

      expect(geometry, `${route}: no Sign out control found in the header`).toBeTruthy();
      const furtherRight = geometry.others.filter((o) => o.right > geometry.right + 1);
      expect(
        furtherRight,
        `${route}: CLAUDE.md Login 7 wants Sign out "last item on the right"; these sit further right: ${JSON.stringify(furtherRight)}`
      ).toEqual([]);
      expect(geometry.hasSvg, `${route}: Sign out should carry an inline SVG icon (no emoji)`).toBe(true);

      if (phone) {
        expect(geometry.text, `${route}: below 700px Sign out is icon-only`).toBe('');
        expect(geometry.ariaLabel, `${route}: CLAUDE.md Login 7 requires aria-label="Sign out" on the phone`).toBe('Sign out');
        expect(Math.abs(geometry.width - 44) <= 2 && Math.abs(geometry.height - 44) <= 2,
          `${route}: phone Sign out is ${geometry.width}x${geometry.height}, the brief says 44x44`).toBe(true);
      } else {
        expect(geometry.text, `${route}: at 700px and wider Sign out shows its label`).toMatch(/Sign out/);
        expect(geometry.height, `${route}: Sign out is ${geometry.height}px tall`).toBeGreaterThanOrEqual(43.5);
      }
    }
  });

  test('G-14 Sign out clears the session but keeps the till letter and sequences', async ({ page, context }) => {
    await signedInPage(page, context, '#/');
    await setTill(page, 'B');
    await gotoRoute(page, '#/cash');
    await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 15000 });
    const no = await placeOrder(page, { items: { momo: 1 }, name: 'Till B', payment: 'card' });
    expect(no).toBe('B-001');
    await waitForOrders((o) => o.some((x) => x.orderNo === 'B-001'), { label: 'B-001' });

    const before = await page.evaluate(() => ({ ...window.localStorage }));
    const seqKeys = Object.keys(before).filter((k) => k.startsWith('seq:'));
    expect(seqKeys.length, 'the till must have written a seq:<till>:<day> key').toBeGreaterThan(0);

    await gotoRoute(page, '#/kitchen');
    await (await signOutButton(page)).click();
    await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 10000 }).toMatch(/^#\/login/);

    const after = await page.evaluate(() => ({ ...window.localStorage }));
    expect(after[SESSION_KEY], 'CLAUDE.md Login 7: sign out clears nba.session').toBeUndefined();
    for (const k of seqKeys) {
      expect(after[k], `CLAUDE.md Login 7: "keep till letter and order sequences" — ${k} was dropped`).toBe(before[k]);
    }
    // App settings only: the Firestore SDK keeps its own localStorage entries
    // (firestore_* / firebase*) and those are not the till's state.
    const appKeys = Object.keys(before).filter((k) =>
      k !== SESSION_KEY && !k.startsWith('seq:') && !/^(firestore|firebase|__)/i.test(k));
    for (const k of appKeys) {
      expect(after[k], `sign out dropped ${k}; the till letter and its settings must survive`).toBe(before[k]);
    }
    expect(
      Object.values(after).some((v) => v === 'B') || appKeys.length > 0,
      'the till letter must still be stored after a sign out'
    ).toBe(true);

    // Sign back in and carry on at B-002, with till B still selected.
    if (HAVE_CREDS) {
      await signIn(page, C.user, C.password);
      await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 15000 }).toBe('#/');
      const till = tid(page, 'till-letter');
      const value = await till.evaluate((el) => (el.value !== undefined && el.value !== '' ? el.value : el.textContent).trim());
      expect(value, 'the till letter must survive a sign out').toBe('B');
      await gotoRoute(page, '#/cash');
      await expect(tid(page, 'tile-momo')).toBeVisible({ timeout: 15000 });
      const next = await placeOrder(page, { items: { momo: 1 }, name: 'Till B again', payment: 'card' });
      expect(next, 'the daily sequence must continue after a sign out').toBe('B-002');
    }
  });

  test('G-15..G-17 cash counter discard confirm, Cancel and Sign out', async ({ page, context }, info) => {
    await signedInPage(page, context, '#/cash');
    await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 15000 });

    // Spy on window.confirm: the brief forbids it.
    await page.evaluate(() => {
      window.__confirmCalls = 0;
      window.confirm = (...args) => { window.__confirmCalls++; return false; };
    });

    await addItem(page, 'fuchka', 2);
    await openCashPanel(page);
    await tid(page, 'customer-name').fill('G17-DISCARD');
    const total = norm(await tid(page, 'order-total').innerText());
    await closeCashPanel(page);

    await (await signOutButton(page)).click();
    await page.waitForTimeout(400);

    expect(await page.evaluate(() => window.__confirmCalls), 'CLAUDE.md Login 8: "Never window.confirm"').toBe(0);

    const confirmBox = await firstOf(page, [
      '[data-testid="signout-confirm"]',
      '[role="dialog"]',
      'text=Discard the unsent order and sign out?'
    ]);
    await expect(confirmBox, 'CLAUDE.md Login 8: an in-page confirm with items in the panel').toBeVisible({ timeout: 10000 });
    const confirmText = norm(await confirmBox.innerText());
    expect(confirmText).toContain('Discard the unsent order and sign out?');
    expect(await readSession(page), 'still signed in while the confirm is open').toBeTruthy();
    await shot(page, info.project.name, 'cash', 'confirm');

    // G-16 Cancel
    const cancel = page.getByRole('button', { name: /^Cancel$/i }).first();
    await expect(cancel, 'the confirm needs a Cancel button').toBeVisible();
    await cancel.click();
    await page.waitForTimeout(400);
    expect(await readSession(page), 'Cancel must not sign the volunteer out').toBeTruthy();
    expect(await page.evaluate(() => window.location.hash)).toBe('#/cash');
    await openCashPanel(page);
    expect(norm(await tid(page, 'order-total').innerText()), 'Cancel must keep the unsent order').toBe(total);
    await closeCashPanel(page);
    expect(await tid(page, 'qty-fuchka').count()).toBeGreaterThan(0);

    // G-17 confirm the sign out
    await (await signOutButton(page)).click();
    await page.waitForTimeout(300);
    const box2 = await firstOf(page, ['[data-testid="signout-confirm"]', '[role="dialog"]', 'text=Discard the unsent order and sign out?']);
    const confirmSignOut = box2.getByRole('button', { name: /sign out/i }).first();
    await expect(confirmSignOut, 'the confirm needs a Sign out button').toBeVisible();
    await confirmSignOut.click();
    await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 10000 }).toMatch(/^#\/login/);
    expect(await readSession(page)).toBeNull();
    expect(await page.evaluate(() => window.__confirmCalls)).toBe(0);
    const orders = await readCollection('orders');
    expect(
      orders.filter((o) => o.name === 'G17-DISCARD').map((o) => o.orderNo),
      'discarding the panel must not write the unsent order'
    ).toEqual([]);
  });

  test('G-18 an empty cash panel signs out with no confirm', async ({ page, context }) => {
    await signedInPage(page, context, '#/cash');
    await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => { window.__confirmCalls = 0; window.confirm = () => { window.__confirmCalls++; return false; }; });
    await (await signOutButton(page)).click();
    await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 10000 }).toMatch(/^#\/login/);
    expect(await readSession(page)).toBeNull();
    expect(await page.evaluate(() => window.__confirmCalls)).toBe(0);
  });
});
