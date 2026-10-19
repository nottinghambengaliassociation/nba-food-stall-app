// The "One day / Sales by day" toggle that sits at the top of both report
// screens (CLAUDE.md Phase III 1, design/ReportsByDay.dc.html).

import { el } from './ui.js';
import { href } from './router.js';

const VIEWS = [
  { key: 'day', route: '/reports', label: 'One day', testid: 'report-view-day', alias: 'report-toggle-day' },
  { key: 'days', route: '/reports/days', label: 'Sales by day', testid: 'report-view-days', alias: 'report-toggle-days' }
];

/**
 * @param {'day'|'days'} current which screen is showing
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
      text: view.label,
      'aria-current': on ? 'page' : null
    });
    return el('span', {
      class: 'report-nav__item',
      testid: view.alias,
      'aria-current': on ? 'page' : null
    }, [link]);
  }));
}
