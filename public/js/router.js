// Hash router: #/ , #/cash , #/kitchen , #/reports

export const ROUTES = ['/', '/cash', '/kitchen', '/reports'];

/** Current route path, always one of ROUTES. */
export function currentRoute() {
  const raw = (typeof location !== 'undefined' ? location.hash : '') || '#/';
  const path = raw.replace(/^#/, '').split('?')[0] || '/';
  const clean = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return ROUTES.includes(clean) ? clean : '/';
}

/** Call handler now and on every hash change. Returns an unsubscribe function. */
export function startRouter(handler) {
  const run = () => handler(currentRoute());
  window.addEventListener('hashchange', run);
  run();
  return () => window.removeEventListener('hashchange', run);
}

export function href(route) {
  return '#' + route;
}
