// Hash router: #/login , #/ , #/cash , #/kitchen , #/reports , #/reports/days
// A route may carry a query string (#/reports?day=2026-10-18); it is stripped
// from the path and read back with routeParam().

export const ROUTES = ['/', '/login', '/cash', '/kitchen', '/reports', '/reports/days'];

function rawHash() {
  return (typeof location !== 'undefined' ? location.hash : '') || '#/';
}

/** Current route path, always one of ROUTES. */
export function currentRoute() {
  const path = rawHash().replace(/^#/, '').split('?')[0] || '/';
  const clean = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return ROUTES.includes(clean) ? clean : '/';
}

/** The query string of the current hash, as URLSearchParams. */
export function currentQuery() {
  const raw = rawHash().replace(/^#/, '');
  const i = raw.indexOf('?');
  return new URLSearchParams(i === -1 ? '' : raw.slice(i + 1));
}

/** One query parameter from the hash, or null. */
export function routeParam(name) {
  return currentQuery().get(name);
}

/** Call handler now and on every hash change. Returns an unsubscribe function. */
export function startRouter(handler) {
  const run = () => handler(currentRoute());
  window.addEventListener('hashchange', run);
  run();
  return () => window.removeEventListener('hashchange', run);
}

export function href(route, params) {
  const query = params ? new URLSearchParams(params).toString() : '';
  return '#' + route + (query ? '?' + query : '');
}
