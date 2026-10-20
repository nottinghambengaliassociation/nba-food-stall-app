// The "One day / Sales by day / Orders / Order history" toggle that sits at
// the top of all four report screens (CLAUDE.md Phase III 1, Phase IV 1 and
// Phase VI 1; design/ReportsByDay.dc.html, design/ReportsOrders.dc.html,
// design/ReportsHistory.dc.html).

import { el } from './ui.js';
import { href } from './router.js';

const VIEWS = [
  { key: 'day', route: '/reports', label: 'One day', short: 'One day', testid: 'report-view-day', alias: 'report-toggle-day' },
  { key: 'days', route: '/reports/days', label: 'Sales by day', short: 'By day', testid: 'report-view-days', alias: 'report-toggle-days' },
  { key: 'orders', route: '/reports/orders', label: 'Orders', short: 'Orders', testid: 'report-view-orders', alias: 'report-toggle-orders' },
  { key: 'history', route: '/reports/history', label: 'Order history', short: 'History', testid: 'report-view-history', alias: 'report-toggle-history' }
];

// Below 700px the pills read "One day | By day | Orders | History" and the
// row scrolls sideways rather than wrapping (CLAUDE.md Phase VI 1,
// design/ReportsHistoryMobile.dc.html). The label is swapped in script rather
// than with two spans so the pill's text is only ever the one word pair.
const PHONE = typeof matchMedia === 'function' ? matchMedia('(max-width: 699px)') : null;

function labelFor(view) {
  return PHONE && PHONE.matches ? view.short : view.label;
}

function relabelAll() {
  for (const pill of document.querySelectorAll('.report-pill[data-label-full]')) {
    pill.textContent = PHONE && PHONE.matches ? pill.dataset.labelShort : pill.dataset.labelFull;
  }
}

if (PHONE) {
  // One listener for the life of the page: the pills are rebuilt on every
  // mount, so this walks the live DOM rather than holding node references.
  if (typeof PHONE.addEventListener === 'function') PHONE.addEventListener('change', relabelAll);
  else if (typeof PHONE.addListener === 'function') PHONE.addListener(relabelAll);
}

/**
 * @param {'day'|'days'|'orders'|'history'} current which screen is showing
 * The pill carries both test ids: the outer wrapper and the link itself, so a
 * test can reach it under either name.
 */
export function reportToggle(current) {
  return el('nav', { class: 'report-nav', 'aria-label': 'Report view' }, VIEWS.map((view) => {
    const on = view.key === current;
    const link = el('a', {
      class: 'report-pill' + (on ? ' report-pill--on' : ''),
      testid: view.testid,
      href: href(view.route),
      text: labelFor(view),
      dataset: { labelFull: view.label, labelShort: view.short },
      'aria-current': on ? 'page' : null
    });
    return el('span', {
      class: 'report-nav__item',
      testid: view.alias,
      'aria-current': on ? 'page' : null
    }, [link]);
  }));
}
