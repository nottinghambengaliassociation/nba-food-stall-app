/**
 * Shared Playwright `test` for every spec except the login suite.
 *
 * CLAUDE.md → Login and sign out 6: "any route other than `#/login` with no
 * session redirects to `#/login`". Login therefore gates all the Phase I
 * screens, so every Phase I test starts from a signed-in browser. The session
 * is seeded straight into `localStorage["nba.session"]` — the shape the brief
 * specifies in FR Login 5 — rather than by driving the form, so that a login
 * defect shows up once, in the `G-*` suite, instead of failing everything.
 *
 * The username comes from `.secrets/app-login.env` (or the generated
 * login-config.js) at run time. No credential is ever hard-coded here.
 */
import { test as base, expect } from '@playwright/test';
import { loginUser } from './creds.js';

export const SESSION_KEY = 'nba.session';

/**
 * Install the init script that (a) clears localStorage once per tab, keeping
 * any seeded session, and (b) seeds a session if there is not one already.
 * Runs before any script on the page, on every navigation.
 */
export async function seedSession(context, user = loginUser()) {
  await context.addInitScript(([key, who]) => {
    try {
      if (!window.sessionStorage.getItem('__qa_cleared')) {
        window.localStorage.clear();
        window.sessionStorage.setItem('__qa_cleared', '1');
      }
      if (who && !window.localStorage.getItem(key)) {
        window.localStorage.setItem(key, JSON.stringify({ user: who, at: Date.now() }));
      }
    } catch { /* storage disabled; the test will fail on its own assertion */ }
  }, [SESSION_KEY, user]);
}

/** Read the session back out of a page. */
export async function readSession(page, key = SESSION_KEY) {
  return page.evaluate((k) => {
    const raw = window.localStorage.getItem(k);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return { __unparseable: raw }; }
  }, key);
}

/** Drop the session in an open page (does not reload). */
export async function clearSession(page, key = SESSION_KEY) {
  await page.evaluate((k) => window.localStorage.removeItem(k), key);
}

/**
 * `test` with a session in the default context, and with
 * `browser.newContext()` seeded too, so the two-context tests (till + kitchen)
 * are both signed in.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await seedSession(context);
    await use(context);
  },
  browser: async ({ browser }, use) => {
    const original = browser.newContext.bind(browser);
    browser.newContext = async (...args) => {
      const ctx = await original(...args);
      await seedSession(ctx);
      return ctx;
    };
    await use(browser);
    browser.newContext = original;
  }
});

export { expect };
