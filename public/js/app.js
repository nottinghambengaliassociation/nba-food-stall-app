// App shell: header, storage banner, routing, shared settings.

import { el, clear, setText } from './ui.js';
import { currentRoute, currentQuery, startRouter, href } from './router.js';
import { start, status, seedMenuIfEmpty, onConnection } from './store.js';
import { peekOrderNo, dayString } from './logic.js';
import { mountLanding } from './landing.js';
import { mountLogin, createSignOutButton, hasSession } from './login.js';
import { mountCash } from './cash.js';
import { mountKitchen } from './kitchen.js';
import { mountReports } from './reports.js';
import { mountReportsDays } from './reports-days.js';
import { mountReportsOrders } from './reports-orders.js';
import { createVersionPill } from './app-version.js';

const TILL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const TITLES = {
  '/': 'Charity food stall',
  '/login': 'Sign in',
  '/cash': 'Cash counter',
  '/kitchen': 'Food counter',
  '/reports': 'Reports',
  '/reports/days': 'Reports',
  '/reports/orders': 'Reports'
};

const settings = {
  get till() {
    const saved = (localStorage.getItem('till') || 'A').toUpperCase().slice(0, 1);
    return TILL_LETTERS.includes(saved) ? saved : 'A';
  },
  set till(value) {
    localStorage.setItem('till', String(value).toUpperCase().slice(0, 1));
  },
  get beep() {
    return localStorage.getItem('beep') !== 'off';
  },
  set beep(on) {
    localStorage.setItem('beep', on ? 'on' : 'off');
  }
};

const tillListeners = new Set();

// Screens register a guard that returns true while they hold work that would
// be lost: the cash counter uses it so Sign out can ask first.
const unsentGuards = new Set();

function hasUnsentWork() {
  for (const fn of unsentGuards) {
    try { if (fn()) return true; } catch (err) { console.error(err); }
  }
  return false;
}

const ctx = {
  settings,
  onTillChange(fn) {
    tillListeners.add(fn);
    return () => tillListeners.delete(fn);
  },
  setUnsentGuard(fn) {
    unsentGuards.add(fn);
    return () => unsentGuards.delete(fn);
  },
  setTill(letter) {
    settings.till = letter;
    for (const fn of tillListeners) {
      try { fn(settings.till); } catch (err) { console.error(err); }
    }
    refreshHeaderSub();
  },
  refreshHeaderSub: refreshHeaderSub
};

let nodes = {};
let unmount = null;
let mountedRoute = null;
// A screen may ask to handle hash query changes itself (the orders report
// keeps the selected order in the hash, so Back works) instead of being torn
// down and rebuilt on every tap.
let queryChangeHandler = null;

function buildShell() {
  const root = document.getElementById('app');
  clear(root);
  root.className = 'app';

  const title = el('h1', { class: 'header__title', testid: 'screen-title' });
  // App version pill, right after the screen title (CLAUDE.md Phase III part 2).
  const version = createVersionPill();
  const sub = el('span', { class: 'header__sub', testid: 'till-badge' });
  const slotLeft = el('div', { class: 'header__left header__slot' });
  const pill = el('span', {
    class: 'pill',
    testid: 'conn-pill',
    'aria-live': 'polite',
    role: 'status'
  });
  const slotRight = el('div', { class: 'header__right header__slot' });
  const tillWrap = el('span', { class: 'till-field' });
  const nav = el('nav', { class: 'header__right', 'aria-label': 'Screens' });
  const signOut = createSignOutButton({
    guard: hasUnsentWork,
    onSignOut: () => { location.hash = '#/login'; }
  });

  const header = el('header', { class: 'header' }, [
    el('div', { class: 'header__left' }, [title, version, sub, slotLeft]),
    el('div', { class: 'header__right' }, [pill, slotRight, tillWrap, nav, signOut])
  ]);

  const banner = el('div', { testid: 'banner-slot' });
  const outlet = el('div', { class: 'outlet', id: 'outlet' });

  root.append(header, banner, outlet);
  nodes = { root, header, title, version, sub, pill, slotLeft, slotRight, tillWrap, nav, signOut, banner, outlet };
}

function renderBanner() {
  clear(nodes.banner);
  if (status.state === 'unconfigured' || status.state === 'error') {
    nodes.banner.appendChild(el('p', {
      class: 'banner',
      role: 'alert',
      testid: 'storage-banner'
    }, [
      'Storage not configured',
      el('span', {
        class: 'banner__note',
        text: 'This device cannot reach the order database, so orders cannot be saved or shown. Ask the organiser to finish the Firebase setup.'
      })
    ]));
  }
}

function renderPill(state) {
  const online = state.online;
  nodes.pill.className = 'pill' + (online ? '' : ' pill--offline');
  clear(nodes.pill);
  nodes.pill.append(
    el('span', { class: 'pill__dot' }),
    document.createTextNode(online ? 'Online · synced' : `Offline · ${state.queued} queued`)
  );
}

function refreshHeaderSub() {
  const route = currentRoute();
  if (route === '/cash') {
    setText(nodes.sub, `Till ${settings.till} · next ${peekOrderNo(settings.till, dayString())}`);
    nodes.sub.hidden = false;
  } else if (route === '/kitchen') {
    setText(nodes.sub, dayString());
    nodes.sub.hidden = false;
  } else {
    setText(nodes.sub, '');
    nodes.sub.hidden = true;
  }
}

function renderTillSelect(route) {
  clear(nodes.tillWrap);
  // The till letter only changes behaviour at the till, and the landing page
  // owns the setting itself, so the header control lives on /cash alone.
  if (route !== '/cash') return;
  const select = el('select', {
    id: 'till-letter',
    testid: 'till-letter',
    onchange: (e) => ctx.setTill(e.target.value)
  }, TILL_LETTERS.map((l) => el('option', { value: l, text: l, selected: l === settings.till })));
  select.value = settings.till;
  nodes.tillWrap.append(el('label', { for: 'till-letter', text: 'Till' }), select);
}

function renderNav(route) {
  clear(nodes.nav);
  if (route === '/') return; // the landing page owns the three big buttons
  const links = [
    ['/cash', 'Cash counter', 'nav-cash'],
    ['/kitchen', 'Food counter', 'nav-kitchen'],
    ['/reports', 'Reports', 'nav-reports']
  ];
  for (const [path, label, testid] of links) {
    nodes.nav.appendChild(el('a', {
      class: 'navlink',
      href: href(path),
      testid,
      text: label,
      // The Reports link stays current on the other two report screens too.
      'aria-current': (path === route || (path === '/reports' && route.startsWith('/reports'))) ? 'page' : null
    }));
  }
}

function mountRoute(route) {
  if (typeof unmount === 'function') {
    try { unmount(); } catch (err) { console.error(err); }
  }
  unmount = null;
  queryChangeHandler = null;
  mountedRoute = null;

  // Route guard, both ways (CLAUDE.md "Login and sign out" 6).
  if (route !== '/login' && !hasSession()) {
    location.replace('#/login');
    return;
  }
  if (route === '/login' && hasSession()) {
    location.replace('#/');
    return;
  }

  setText(nodes.title, TITLES[route] || TITLES['/']);
  document.title = (TITLES[route] || TITLES['/']) + ' · Food stall';
  clear(nodes.slotLeft);
  clear(nodes.slotRight);
  renderTillSelect(route);
  renderNav(route);
  refreshHeaderSub();
  clear(nodes.outlet);

  // The sign-in screen is a plain centred card, no dark header (design/Login.dc.html).
  nodes.header.hidden = route === '/login';
  nodes.signOut.hidden = route === '/login';

  const screenCtx = {
    ...ctx,
    headerLeft: nodes.slotLeft,
    headerRight: nodes.slotRight,
    onSignedIn: () => { location.hash = '#/'; },
    onQueryChange: (fn) => { queryChangeHandler = typeof fn === 'function' ? fn : null; }
  };

  if (route === '/login') unmount = mountLogin(nodes.outlet, screenCtx);
  else if (route === '/cash') unmount = mountCash(nodes.outlet, screenCtx);
  else if (route === '/kitchen') unmount = mountKitchen(nodes.outlet, screenCtx);
  else if (route === '/reports') unmount = mountReports(nodes.outlet, screenCtx);
  else if (route === '/reports/days') unmount = mountReportsDays(nodes.outlet, screenCtx);
  else if (route === '/reports/orders') unmount = mountReportsOrders(nodes.outlet, screenCtx);
  else unmount = mountLanding(nodes.outlet, screenCtx);

  mountedRoute = route;
  document.body.setAttribute('data-route', route);
}

/**
 * Hash changed. Staying on the same screen with a different query (the orders
 * report selecting an order) is handed to the screen; everything else is a
 * fresh mount.
 */
function handleRoute(route) {
  if (route === mountedRoute && queryChangeHandler) {
    if (!hasSession()) { location.replace('#/login'); return; }
    try { queryChangeHandler(currentQuery()); } catch (err) { console.error(err); }
    return;
  }
  mountRoute(route);
}

async function boot() {
  buildShell();
  renderPill({ online: navigator.onLine !== false, queued: 0 });

  const ok = await start();
  renderBanner();
  if (ok) {
    onConnection(renderPill);
    seedMenuIfEmpty().catch((err) => console.error('menu seed failed', err));
  }

  startRouter(handleRoute);
  document.body.setAttribute('data-app-ready', 'true');
}

boot().catch((err) => {
  console.error('App failed to start', err);
});
