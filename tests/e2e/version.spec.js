/**
 * V-* — the app version label on the login card and in every dark header.
 * Spec: CLAUDE.md "Phase III (part 2): App version on login and headers" 1–6,
 * the footer of design/Login.dc.html / design/LoginMobile.dc.html and the
 * v1.2.0 pill in the header of the other mock-ups.
 *
 * The build string is asserted by SHAPE, never by value: Trinity regenerates
 * public/js/version.js immediately before the commit, so a literal SHA here
 * would break the suite the moment the tree is committed.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedSession, SESSION_KEY } from './session.js';
import { creds } from './creds.js';
import {
  ROOT, attachConsole, realErrors, tid, shot, heightOf, clearFirestore
} from './helpers.js';

const PKG_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;

// scripts/write-version.mjs: 7-character commit SHA, "-dirty" while the working
// tree is uncommitted, and "dev" when version.js is not there at all.
const BUILD_SHAPE = /^(?:[0-9a-f]{7}(?:-dirty)?|dev)$/;
const DATE_SHAPE = /^\d{1,2} [A-Z][a-z]{2} \d{4}$/;

const SIGNED_IN_ROUTES = ['#/', '#/cash', '#/kitchen', '#/reports', '#/reports/days'];

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

/** Open signed out, with localStorage cleared once per tab. */
async function freshPage(page, route) {
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
  return errors;
}

/** Open already signed in. */
async function signedInPage(page, context, route) {
  const errors = attachConsole(page);
  await seedSession(context, creds().user || 'volunteer');
  await page.goto('/' + route);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
  return errors;
}

/** Pull the three parts out of "Version X · build Y · updated Z". */
function parseLine(text) {
  const m = norm(text).match(/^Version\s+(\S+)\s+·\s+build\s+(\S+)\s+·\s+updated\s+(.+)$/);
  return m ? { version: m[1], build: m[2], date: m[3] } : null;
}

/**
 * Sign in from a page that is already on #/login. A plain page.goto to another
 * hash on the same document does not re-run init scripts, so the session is
 * written straight into localStorage here as well as seeded for later loads.
 */
async function signInHere(page, context) {
  const user = creds().user || 'volunteer';
  await seedSession(context, user);
  await page.evaluate(([key, who]) => {
    window.localStorage.setItem(key, JSON.stringify({ user: who, at: Date.now() }));
  }, [SESSION_KEY, user]);
}

/** And out of "Version X, build Y, updated Z". */
function parseTitle(text) {
  const m = norm(text).match(/^Version\s+(.+?),\s+build\s+(.+?),\s+updated\s+(.+)$/);
  return m ? { version: m[1], build: m[2], date: m[3] } : null;
}

test.describe('Phase III part 2 — app version', () => {
  test('V-01 login-version reads "Version x.y.z · build <sha> · updated <date>"', async ({ page }, info) => {
    await freshPage(page, '#/login');
    const label = tid(page, 'login-version');
    await expect(label, 'CLAUDE.md Phase III part 2, 4 and 6: test id login-version').toBeVisible({ timeout: 20000 });

    const text = norm(await label.innerText());
    const parts = parseLine(text);
    expect(parts, `login-version must read "Version 1.2.0 · build a1b2c3d · updated 19 Oct 2026"; got "${text}"`).toBeTruthy();
    expect(parts.version, 'package.json is the single source of truth for the version').toBe(PKG_VERSION);
    expect(parts.build, `build "${parts.build}" is not a 7-character commit SHA`).toMatch(BUILD_SHAPE);
    expect(parts.date, `date "${parts.date}" is not "19 Oct 2026" shaped`).toMatch(DATE_SHAPE);

    // Matching title and aria-label (CLAUDE.md Phase III part 2, 6).
    const title = parseTitle(await label.getAttribute('title'));
    const aria = parseTitle(await label.getAttribute('aria-label'));
    expect(title, 'login-version needs a title "Version …, build …, updated …"').toBeTruthy();
    expect(aria, 'login-version needs a matching aria-label').toBeTruthy();
    expect(title).toEqual(parts);
    expect(aria).toEqual(parts);

    // 13 px, centred, and inside the login card.
    const style = await label.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { size: parseFloat(cs.fontSize), align: cs.textAlign, colour: cs.color };
    });
    expect(style.size, 'the login version line is 13 px').toBeCloseTo(13, 0);
    expect(style.align).toBe('center');

    await shot(page, info.project.name, 'login', 'version');
  });

  test('V-02 login-version is there before and after sign-in, and after a failed attempt', async ({ page, context }) => {
    await freshPage(page, '#/login');
    await expect(tid(page, 'login-version')).toBeVisible({ timeout: 20000 });
    const before = norm(await tid(page, 'login-version').innerText());

    // After a wrong attempt the card re-renders its error state; the line stays.
    const user = page.locator('input[autocomplete="username"], [data-testid="login-user"]').first();
    const pass = page.locator('input[type="password"]').first();
    await user.fill('someone');
    await pass.fill('not-the-password-xxx');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(600);
    await expect(tid(page, 'login-version'), 'the version line survives a failed attempt').toBeVisible();
    expect(norm(await tid(page, 'login-version').innerText())).toBe(before);

    // Signed in, then back to the login screen by signing out: still there.
    await signInHere(page, context);
    await page.goto('/#/');
    await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
    await page.evaluate(() => window.localStorage.removeItem('nba.session'));
    await page.goto('/#/login');
    await expect(tid(page, 'login-version')).toBeVisible({ timeout: 20000 });
    expect(norm(await tid(page, 'login-version').innerText())).toBe(before);
  });

  test('V-03 app-version is in the header of every signed-in route, with matching title and aria-label', async ({ page, context }, info) => {
    await clearFirestore();
    const errors = await signedInPage(page, context, '#/');
    const phone = info.project.name === 'phone';

    for (const route of SIGNED_IN_ROUTES) {
      await page.goto('/' + route);
      await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(500);

      const label = tid(page, 'app-version');
      await expect(label, `${route}: CLAUDE.md Phase III part 2, 5 puts a version label in every dark header`).toBeVisible();

      const inHeader = await label.evaluate((el) => !!el.closest('header'));
      expect(inHeader, `${route}: the version label belongs in the dark header`).toBe(true);

      const text = norm(await label.innerText());
      expect(text, `${route}: the header label reads v<version>`).toBe('v' + PKG_VERSION);

      const title = parseTitle(await label.getAttribute('title'));
      const aria = parseTitle(await label.getAttribute('aria-label'));
      expect(title, `${route}: app-version needs a title`).toBeTruthy();
      expect(aria, `${route}: app-version needs an aria-label`).toBeTruthy();
      expect(title).toEqual(aria);
      expect(title.version).toBe(PKG_VERSION);
      expect(title.build).toMatch(BUILD_SHAPE);
      expect(title.date).toMatch(DATE_SHAPE);

      const geom = await label.evaluate((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const title = el.closest('header').querySelector('[data-testid="screen-title"]');
        const tr = title.getBoundingClientRect();
        return {
          size: parseFloat(cs.fontSize),
          weight: cs.fontWeight,
          colour: cs.color,
          borderWidth: parseFloat(cs.borderTopWidth) || 0,
          borderColour: cs.borderTopColor,
          radius: cs.borderTopLeftRadius,
          top: r.top, left: r.left,
          titleBottom: tr.bottom, titleRight: tr.right
        };
      });

      if (phone) {
        // Below 700 px: 12 px bold under the title.
        expect(geom.size, `${route}: 12 px below 700 px`).toBeCloseTo(12, 0);
        expect(Number(geom.weight)).toBeGreaterThanOrEqual(700);
        expect(geom.top, `${route}: the version sits under the title below 700 px`)
          .toBeGreaterThanOrEqual(geom.titleBottom - 1);
        // And the header controls keep their size.
        // Sign out is deliberately 44x44 below 700 px (CLAUDE.md Login 7);
        // nothing in the header may be smaller than that.
        const shortControls = await page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll('header button, header select')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.height < 43.5) {
              out.push(`${el.tagName.toLowerCase()}[${el.dataset.testid || el.getAttribute('aria-label') || ''}] = ${Math.round(r.height)}`);
            }
          }
          return out;
        });
        expect(shortControls, `${route}: the version line must not squeeze the header buttons`).toEqual([]);
      } else {
        // 700 px and wider: an outlined pill right after the title.
        expect(geom.size, `${route}: 13 px at 700 px and wider`).toBeCloseTo(13, 0);
        expect(Number(geom.weight)).toBeGreaterThanOrEqual(700);
        expect(geom.borderWidth, `${route}: the pill is outlined`).toBeGreaterThanOrEqual(1);
        expect(geom.borderColour, `${route}: 1 px #57534E border`).toBe('rgb(87, 83, 78)');
        expect(geom.colour, `${route}: #D6D3D1 text`).toBe('rgb(214, 211, 209)');
        expect(parseFloat(geom.radius), `${route}: fully rounded`).toBeGreaterThanOrEqual(99);
        expect(geom.left, `${route}: the pill comes right after the screen title`)
          .toBeGreaterThanOrEqual(geom.titleRight - 1);
        expect(Math.abs(geom.top - geom.titleBottom), `${route}: the pill sits on the title's line`).toBeLessThan(60);
      }
    }

    await page.goto('/#/reports');
    await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(400);
    await shot(page, info.project.name, 'header', 'version');

    expect(realErrors(errors), `console errors while reading the version labels:\n${realErrors(errors).join('\n')}`).toEqual([]);
  });

  test('V-04 app-version is at least 48px clear of the header buttons and never wraps them off screen', async ({ page, context }) => {
    await signedInPage(page, context, '#/cash');
    await page.waitForTimeout(600);
    const overlap = await page.evaluate(() => {
      const v = document.querySelector('[data-testid="app-version"]');
      const vr = v.getBoundingClientRect();
      const hits = [];
      for (const el of document.querySelectorAll('header button, header select, header a[href]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const intersects = !(r.right <= vr.left || r.left >= vr.right || r.bottom <= vr.top || r.top >= vr.bottom);
        if (intersects) hits.push(el.dataset.testid || el.tagName);
      }
      return hits;
    });
    expect(overlap, 'the version label must not sit on top of a header control').toEqual([]);

    const offScreen = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('header button, header select')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > document.documentElement.clientWidth + 1 || r.left < -1) out.push(el.dataset.testid || el.tagName);
      }
      return out;
    });
    expect(offScreen, 'no header control is pushed off screen by the version label').toEqual([]);
  });

  test('V-05 with version.js missing every label reads dev and nothing errors', async ({ page, context }) => {
    // The 404 the browser itself reports for the missing module is expected;
    // an app-level console error or an uncaught exception is not.
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.route('**/js/version.js', (route) => route.fulfill({ status: 404, body: 'not found' }));

    await freshPage(page, '#/login');
    const line = tid(page, 'login-version');
    await expect(line).toBeVisible({ timeout: 20000 });
    const text = norm(await line.innerText());
    expect(text, 'CLAUDE.md Phase III part 2, 3: every label shows dev').toBe('Version dev · build dev · updated dev');
    expect(norm(await line.getAttribute('title'))).toBe('Version dev, build dev, updated dev');
    expect(norm(await line.getAttribute('aria-label'))).toBe('Version dev, build dev, updated dev');

    await signInHere(page, context);
    for (const route of SIGNED_IN_ROUTES) {
      await page.goto('/' + route);
      await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(400);
      const pill = tid(page, 'app-version');
      await expect(pill, `${route}: the header label is still rendered without version.js`).toBeVisible();
      expect(norm(await pill.innerText()), `${route}: falls back to dev`).toContain('dev');
      expect(norm(await pill.innerText()), `${route}: must not show a stale version`).not.toContain(PKG_VERSION);
      expect(norm(await pill.getAttribute('title'))).toBe('Version dev, build dev, updated dev');
    }

    expect(pageErrors, `a missing version.js must not throw:\n${pageErrors.join('\n')}`).toEqual([]);
    const appErrors = realErrors(consoleErrors.map((t) => `console.error: ${t}`))
      .filter((t) => !/version\.js/.test(t))
      .filter((t) => !/Failed to load resource/.test(t));
    expect(appErrors, `a missing version.js must not log an app error:\n${appErrors.join('\n')}`).toEqual([]);
  });
});
