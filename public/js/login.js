// Login screen, session, route guard and sign out.
// The one shared volunteer account. This is a screen gate, not security:
// Firestore rules stay open in Phase I (CLAUDE.md "Login and sign out" 9).
//
// The plain password lives only in the password <input>. It is hashed with
// SHA-256 and compared against loginPasswordSha256 from the generated,
// gitignored public/js/login-config.js. It is never stored, logged or copied
// into an attribute.

import { el, clear, svgNode } from './ui.js';
import { normaliseUser, sha256Hex } from './logic.js';
import { createVersionLine } from './app-version.js';

export { sha256Hex };

export const SESSION_KEY = 'nba.session';

const WRONG_MESSAGE = 'Username or password is wrong. Check and try again.';
const HELP_LINE = "One shared login for stall volunteers. Ask the stall lead if you don't have it.";

const SIGN_OUT_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="M16 17l5-5-5-5"></path><path d="M21 12H9"></path></svg>`;

/* ---------------------------------------------------------------- session */

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** The signed-in volunteer, or null. */
export function getSession() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.user !== 'string' || !parsed.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasSession() {
  return getSession() !== null;
}

/** Start a session. No expiry: it lasts until Sign out. */
export function startSession(user) {
  const store = storage();
  const session = { user: String(user || '').trim(), at: Date.now() };
  if (store) store.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

/** End the session. Till letter and order sequences in localStorage are left alone. */
export function clearSession() {
  const store = storage();
  if (store) store.removeItem(SESSION_KEY);
}

/* ----------------------------------------------------------------- config */

let configPromise = null;

/**
 * Load the generated login config.
 * Returns { user, hash } when it is usable, or null when it is missing or
 * still holds PASTE_ placeholders.
 */
export function loadLoginConfig() {
  if (!configPromise) {
    configPromise = import('./login-config.js')
      .then((mod) => {
        const user = typeof mod.loginUser === 'string' ? mod.loginUser : '';
        const hash = typeof mod.loginPasswordSha256 === 'string' ? mod.loginPasswordSha256 : '';
        const placeholder = (v) => !v || v.startsWith('PASTE_');
        if (placeholder(user) || placeholder(hash)) return null;
        return { user, hash: hash.trim().toLowerCase() };
      })
      .catch(() => null);
  }
  return configPromise;
}

/** Username trimmed and case-insensitive; password exact (compared as a hash). */
export async function checkCredentials(username, password, config) {
  if (!config) return false;
  const typed = normaliseUser(username);
  const expected = normaliseUser(config.user);
  if (!typed || typed !== expected) return false;
  const hash = await sha256Hex(password);
  return hash === config.hash;
}

/* ------------------------------------------------------------ login screen */

export function mountLogin(outlet, ctx) {
  const slot = el('div', { class: 'login__slot' });

  const card = el('div', { class: 'login__card' }, [
    el('img', {
      class: 'login__logo',
      src: 'img/nba-logo.png',
      alt: 'Nottingham Bengali Association logo',
      width: '168',
      height: '168'
    }),
    el('div', { class: 'login__heads' }, [
      el('h1', { class: 'login__title', text: 'Nottingham Bengali Association' }),
      el('p', { class: 'login__sub', text: 'Food Stall Application' })
    ]),
    slot,
    // Version line, always on the card (CLAUDE.md Phase III part 2, 4).
    createVersionLine()
  ]);

  outlet.appendChild(el('main', { class: 'login' }, [card]));

  let cancelled = false;

  loadLoginConfig().then((config) => {
    if (cancelled) return;
    clear(slot);
    if (!config) {
      slot.appendChild(el('div', { class: 'login__blocked', role: 'alert', testid: 'login-not-configured' }, [
        el('b', { text: 'Login not configured' }),
        el('span', {
          class: 'login__blocked-note',
          text: 'This device has no sign-in details yet. Ask the organiser to finish the setup.'
        })
      ]));
      return;
    }
    slot.appendChild(buildForm(config, ctx));
  });

  return () => { cancelled = true; };
}

function buildForm(config, ctx) {
  const errorBox = el('div', { class: 'login__error', role: 'alert', testid: 'login-error' });
  errorBox.hidden = true;

  const userInput = el('input', {
    type: 'text',
    id: 'login-user',
    testid: 'login-user',
    name: 'username',
    autocomplete: 'username',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false'
  });

  const passInput = el('input', {
    type: 'password',
    id: 'login-password',
    testid: 'login-password',
    name: 'password',
    autocomplete: 'current-password',
    autocapitalize: 'none',
    spellcheck: 'false'
  });

  const showBtn = el('button', {
    type: 'button',
    class: 'login__show',
    testid: 'login-toggle-password',
    text: 'Show',
    'aria-pressed': 'false',
    'aria-controls': 'login-password',
    onclick: () => {
      const showing = passInput.type === 'text';
      passInput.type = showing ? 'password' : 'text';
      showBtn.textContent = showing ? 'Show' : 'Hide';
      showBtn.setAttribute('aria-pressed', showing ? 'false' : 'true');
      passInput.focus();
    }
  });

  const submit = el('button', {
    type: 'submit',
    class: 'login__submit',
    testid: 'login-submit',
    text: 'Sign in'
  });

  function setError(on) {
    errorBox.hidden = !on;
    if (on) errorBox.textContent = WRONG_MESSAGE;
    userInput.dataset.invalid = on ? 'true' : 'false';
    passInput.dataset.invalid = on ? 'true' : 'false';
    userInput.setAttribute('aria-invalid', on ? 'true' : 'false');
    passInput.setAttribute('aria-invalid', on ? 'true' : 'false');
  }
  setError(false);

  const clearError = () => { if (!errorBox.hidden) setError(false); };
  userInput.addEventListener('input', clearError);
  passInput.addEventListener('input', clearError);

  const form = el('form', { class: 'login__form', novalidate: true }, [
    errorBox,
    el('div', { class: 'login__field' }, [
      el('label', { class: 'login__label', for: 'login-user', text: 'Username' }),
      userInput
    ]),
    el('div', { class: 'login__field' }, [
      el('label', { class: 'login__label', for: 'login-password', text: 'Password' }),
      el('div', { class: 'login__pass' }, [passInput, showBtn])
    ]),
    submit
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // No lockout, no counter, no delay: a wrong tap must not cost the queue time.
    const username = userInput.value;
    checkCredentials(username, passInput.value, config)
      .then((ok) => {
        passInput.value = '';
        if (!ok) {
          setError(true);
          passInput.focus();
          return;
        }
        setError(false);
        startSession(username);
        if (ctx && typeof ctx.onSignedIn === 'function') ctx.onSignedIn();
        else location.hash = '#/';
      })
      .catch((err) => {
        console.error('sign-in check failed', err);
        passInput.value = '';
        setError(true);
        passInput.focus();
      });
  });

  return el('div', { class: 'login__body' }, [
    form,
    el('p', { class: 'login__help', text: HELP_LINE })
  ]);
}

/* ---------------------------------------------------------------- sign out */

/**
 * The header Sign out button: icon plus text at 700px and wider, icon-only
 * 44x44 below. `guard()` returns true when there is an unsent order to warn about.
 */
export function createSignOutButton({ guard, onSignOut } = {}) {
  return el('button', {
    type: 'button',
    class: 'signout',
    testid: 'sign-out',
    'aria-label': 'Sign out',
    onclick: () => {
      // The guard returns false, true, or { title, note } when the screen
      // wants its own wording (Phase V: leaving edit mode).
      const dirty = typeof guard === 'function' ? guard() : false;
      if (dirty) openSignOutConfirm(() => doSignOut(onSignOut), dirty === true ? {} : dirty);
      else doSignOut(onSignOut);
    }
  }, [
    svgNode(SIGN_OUT_ICON),
    el('span', { class: 'signout__text', text: 'Sign out' })
  ]);
}

function doSignOut(onSignOut) {
  clearSession();
  if (typeof onSignOut === 'function') onSignOut();
  else location.hash = '#/login';
}

/**
 * In-page confirm. Never window.confirm: Playwright cannot drive it and it
 * looks wrong on a tablet. `options` lets a screen reword it (Phase V) and
 * keep its own confirm button label; the test ids never change.
 */
export function openSignOutConfirm(onConfirm, options = {}) {
  const existing = document.querySelector('[data-testid="signout-confirm"]');
  if (existing) existing.remove();

  const previous = document.activeElement;

  const cancel = el('button', {
    type: 'button',
    class: 'modal__btn modal__btn--ghost',
    testid: 'signout-cancel',
    text: 'Cancel',
    onclick: () => close()
  });

  const confirm = el('button', {
    type: 'button',
    class: 'modal__btn modal__btn--danger',
    testid: 'signout-confirm-ok',
    text: options.confirmLabel || 'Sign out',
    onclick: () => { close(); onConfirm(); }
  });

  const dialog = el('div', {
    class: 'modal__card',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'signout-confirm-title'
  }, [
    el('h2', {
      id: 'signout-confirm-title',
      class: 'modal__title',
      testid: 'signout-confirm-title',
      text: options.title || 'Discard the unsent order and sign out?'
    }),
    el('p', {
      class: 'modal__note',
      text: options.note || 'The items in the order panel have not been sent to the food counter.'
    }),
    el('div', { class: 'modal__row' }, [cancel, confirm])
  ]);

  const backdrop = el('div', { class: 'modal', testid: 'signout-confirm' }, [dialog]);

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  }

  function close() {
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    if (previous && typeof previous.focus === 'function') previous.focus();
  }

  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  cancel.focus();
  return close;
}
