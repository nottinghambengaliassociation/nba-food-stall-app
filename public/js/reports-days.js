// Sales by day (CLAUDE.md Phase III, design/ReportsByDay.dc.html).
//
// Read-only: one query per range, `day >= from` and `day <= to` on orders,
// a single field so no composite index is needed. Cancelled orders are
// excluded everywhere and the legacy `tendered` field is ignored.

import { el, clear, setText, svgNode } from './ui.js';
import { itemIcon } from './icons.js';
import { reportToggle } from './report-nav.js';
import { href } from './router.js';
import { fetchOrdersInRange, fetchEvent } from './store.js';
import {
  buildRangeReport, clampRange, defaultRange, todayRange, isDayString,
  formatPenceGrouped, formatPenceCompact, formatPoundsRounded, formatDayLabel,
  ordersToCsv, rangeCsvFilename, dayString, RANGE_TOO_LONG_MESSAGE, RANGE_EMPTY_MESSAGE
} from './logic.js';

const GRID_STEPS = 5;

/** A tidy axis top for the bar chart: five gridlines on round money figures. */
function axisTop(maxPence) {
  const max = Math.max(0, Math.round(Number(maxPence) || 0));
  if (max <= 0) return { step: 100, top: 500 };
  const rough = max / GRID_STEPS;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const multiple = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= rough) || 10;
  const step = multiple * magnitude;
  return { step, top: step * GRID_STEPS };
}

export function mountReportsDays(outlet, ctx) {
  const today = dayString();
  const initial = defaultRange(today);

  const state = {
    from: initial.from,
    to: initial.to,
    orders: [],
    report: buildRangeReport([]),
    event: null,
    hoverDay: null,
    error: null,
    quick: '7d'
  };

  let queryToken = 0;
  let stopped = false;

  /* ------------------------------------------------------------- header */

  const exportButton = el('button', {
    type: 'button',
    class: 'btn-marigold',
    testid: 'range-export-csv',
    text: 'Export CSV for Sheets',
    onclick: exportCsv
  });
  ctx.headerRight.appendChild(el('span', { class: 'btn-wrap', testid: 'export-days-csv' }, [exportButton]));

  /* -------------------------------------------------------- range picker */

  const fromInput = el('input', {
    type: 'date',
    id: 'range-from',
    class: 'range-input',
    testid: 'range-from',
    value: state.from,
    onchange: () => applyRange(fromInput.value, toInput.value, null)
  });

  const toInput = el('input', {
    type: 'date',
    id: 'range-to',
    class: 'range-input',
    testid: 'range-to',
    value: state.to,
    onchange: () => applyRange(fromInput.value, toInput.value, null)
  });

  function quickButton(key, label, testid, alias, onclick) {
    const button = el('button', {
      type: 'button',
      class: 'quick-btn',
      testid,
      text: label,
      'aria-pressed': 'false',
      onclick
    });
    const wrap = el('span', { class: 'btn-wrap', testid: alias }, [button]);
    return { key, button, wrap };
  }

  const quicks = [
    quickButton('today', 'Today', 'range-today', 'quick-today', () => {
      const r = todayRange(dayString());
      applyRange(r.from, r.to, 'today');
    }),
    quickButton('7d', 'Last 7 days', 'range-7d', 'quick-7days', () => {
      const r = defaultRange(dayString());
      applyRange(r.from, r.to, '7d');
    }),
    quickButton('event', 'This event', 'range-event', 'quick-event', () => {
      if (!state.event) return;
      applyRange(state.event.from, state.event.to, 'event');
    })
  ];

  // Hidden until settings/event turns up (CLAUDE.md Phase III 2).
  const eventQuick = quicks[2];
  eventQuick.wrap.hidden = true;
  eventQuick.button.hidden = true;

  const rangeCard = el('section', { class: 'range-card', 'aria-label': 'Date range' }, [
    el('div', { class: 'range-field' }, [
      el('label', { class: 'range-label', for: 'range-from', text: 'From' }),
      fromInput
    ]),
    el('div', { class: 'range-field' }, [
      el('label', { class: 'range-label', for: 'range-to', text: 'To' }),
      toInput
    ]),
    el('div', { class: 'range-quick', role: 'group', 'aria-label': 'Quick ranges' }, quicks.map((q) => q.wrap))
  ]);

  const errorBox = el('p', { class: 'range-error', role: 'alert', testid: 'range-error' });
  errorBox.hidden = true;

  /* ---------------------------------------------------------------- KPIs */

  const kpiDefs = [
    ['range-kpi-sales', 'tile-total-sales', 'Total sales', ''],
    ['range-kpi-orders', 'tile-orders', 'Orders', 'excludes cancelled'],
    ['range-kpi-items', 'tile-items', 'Items sold', ''],
    ['range-kpi-best', 'tile-best-day', 'Best day', ''],
    ['range-kpi-avg', 'tile-avg-day', 'Average per trading day', '']
  ];

  const kpiNodes = {};
  const kpis = el('section', { class: 'kpis', 'aria-label': 'Range totals' },
    kpiDefs.map(([testid, alias, label, note]) => {
      const value = el('span', { class: 'kpi__value', text: '—' });
      const noteEl = el('span', { class: 'kpi__note', text: note });
      kpiNodes[testid] = { value, note: noteEl };
      return el('div', { class: 'kpi', testid }, [
        el('div', { class: 'kpi__inner', testid: alias }, [
          el('span', { class: 'kpi__label', text: label }),
          value,
          noteEl
        ])
      ]);
    }));

  /* --------------------------------------------------------------- empty */

  const emptyCard = el('div', { class: 'card-section empty-card', testid: 'days-empty' }, [
    el('p', { class: 'empty-card__text', testid: 'range-empty', text: RANGE_EMPTY_MESSAGE }),
    el('p', { class: 'kpi__note', text: 'Only days with at least one order are shown. Cancelled orders never count.' })
  ]);
  emptyCard.hidden = true;

  /* --------------------------------------------------------------- chart */

  const readout = el('span', { class: 'days-readout', testid: 'days-readout', 'aria-live': 'polite' });
  const chartBox = el('div', { class: 'days-chart' });
  const chartLabels = el('div', { class: 'days-chart__labels' });
  const chartSection = el('section', { class: 'card-section', testid: 'days-chart', 'aria-label': 'Sales per day chart' }, [
    el('div', { class: 'section-head' }, [el('h2', { text: 'Sales per day' }), readout]),
    chartBox,
    chartLabels
  ]);

  /* ----------------------------------------------------------- day table */

  const dayHead = el('tr', {}, [
    el('th', { scope: 'col', text: 'Day' }),
    el('th', { scope: 'col', class: 'num', text: 'Orders' }),
    el('th', { scope: 'col', class: 'num', text: 'Items' }),
    el('th', { scope: 'col', class: 'num', text: 'Sales' }),
    el('th', { scope: 'col', class: 'num', text: 'Cash' }),
    el('th', { scope: 'col', class: 'num', text: 'Card' }),
    el('th', { scope: 'col', class: 'num', text: 'Avg order' }),
    el('th', { scope: 'col', text: 'Peak 30 min' }),
    el('th', { scope: 'col', text: 'Open' })
  ]);
  const dayBody = el('tbody');
  const daySection = el('section', { class: 'card-section', 'aria-label': 'Day by day' }, [
    el('h2', { text: 'Day by day' }),
    el('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Day by day table' }, [
      el('table', { class: 'data data--wide', testid: 'days-table' }, [
        el('caption', { class: 'visually-hidden', text: 'Sales day by day' }),
        el('thead', {}, [dayHead]),
        dayBody
      ])
    ])
  ]);

  /* --------------------------------------------------------- item matrix */

  const itemsHead = el('tr');
  const itemsBody = el('tbody');
  const itemsSection = el('section', { class: 'card-section', 'aria-label': 'Items by day' }, [
    el('h2', { text: 'Items sold by day' }),
    el('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Items sold by day table' }, [
      el('table', { class: 'data data--wide', testid: 'items-by-day-table' }, [
        el('caption', { class: 'visually-hidden', text: 'Items sold by day' }),
        el('thead', {}, [itemsHead]),
        itemsBody
      ])
    ]),
    el('p', { class: 'kpi__note', text: "Shading marks each item's best day." })
  ]);

  const main = el('main', { class: 'reports reports-days' }, [
    reportToggle('days'),
    rangeCard,
    errorBox,
    kpis,
    emptyCard,
    chartSection,
    daySection,
    itemsSection
  ]);
  outlet.appendChild(main);

  /* -------------------------------------------------------------- render */

  function renderKpis() {
    const r = state.report;
    setText(kpiNodes['range-kpi-sales'].value, formatPenceGrouped(r.totalSales));
    setText(kpiNodes['range-kpi-sales'].note, r.tradingDays === 1 ? '1 trading day' : `${r.tradingDays} trading days`);
    setText(kpiNodes['range-kpi-orders'].value, String(r.orderCount));
    setText(kpiNodes['range-kpi-orders'].note, 'excludes cancelled');
    setText(kpiNodes['range-kpi-items'].value, String(r.itemsSold));
    setText(kpiNodes['range-kpi-items'].note, r.orderCount ? `${r.itemsPerOrder.toFixed(1)} per order` : '0.0 per order');
    setText(kpiNodes['range-kpi-best'].value, r.best ? r.best.label : '—');
    setText(kpiNodes['range-kpi-best'].note, r.best ? formatPenceGrouped(r.best.sales) : 'No sales yet');
    setText(kpiNodes['range-kpi-avg'].value, formatPenceGrouped(r.averagePerDay));
    const perDay = r.averageOrdersPerDay;
    setText(kpiNodes['range-kpi-avg'].note, `${perDay} ${perDay === 1 ? 'order' : 'orders'} a day`);
  }

  function dayReadout(day) {
    const row = state.report.days.find((d) => d.day === day);
    if (!row) return '';
    return `${row.label} · ${formatPenceGrouped(row.sales)} · ${row.orders} ${row.orders === 1 ? 'order' : 'orders'}`;
  }

  function setHover(day) {
    state.hoverDay = day;
    setText(readout, dayReadout(day));
    for (const bar of chartBox.querySelectorAll('.day-bar')) {
      bar.dataset.hover = bar.dataset.day === day ? 'true' : 'false';
    }
  }

  function renderChart() {
    clear(chartBox);
    clear(chartLabels);
    const days = state.report.days;
    if (!days.length) {
      setText(readout, '');
      return;
    }
    const axis = axisTop(state.report.maxSales);
    const best = state.report.best ? state.report.best.day : null;

    for (let i = 0; i <= GRID_STEPS; i++) {
      const value = axis.step * i;
      const bottom = (i / GRID_STEPS) * 100;
      chartBox.append(
        el('span', { class: 'days-chart__line', style: `bottom:${bottom}%`, 'aria-hidden': 'true' }),
        el('span', { class: 'days-chart__tick', style: `bottom:${bottom}%`, 'aria-hidden': 'true', text: formatPoundsRounded(value) })
      );
    }

    const bars = days.map((d) => {
      const height = axis.top > 0 ? Math.max(2, Math.round((d.sales / axis.top) * 100)) : 2;
      const bar = el('button', {
        type: 'button',
        class: 'day-bar',
        testid: `day-bar-${d.day}`,
        dataset: { day: d.day, best: d.day === best ? 'true' : 'false', hover: 'false' },
        'aria-label': `${d.label}, ${formatPenceGrouped(d.sales)}, ${d.orders} ${d.orders === 1 ? 'order' : 'orders'}`,
        onmouseenter: () => setHover(d.day),
        onfocus: () => setHover(d.day),
        onclick: () => setHover(d.day)
      }, [
        // The value label rides on top of its bar: same percentage, nudged up
        // by its own margin, so it never overlaps the fill.
        el('span', { class: 'day-bar__value', style: `bottom:${height}%`, text: formatPenceCompact(d.sales) }),
        el('span', { class: 'day-bar__fill', style: `height:${height}%` })
      ]);
      return bar;
    });
    chartBox.appendChild(el('div', { class: 'days-chart__bars' }, bars));

    for (const d of days) {
      chartLabels.appendChild(el('span', { class: 'days-chart__label' }, [
        el('b', { text: d.weekday }),
        el('br'),
        document.createTextNode(d.date)
      ]));
    }

    const hover = state.hoverDay && days.some((d) => d.day === state.hoverDay) ? state.hoverDay : best;
    setHover(hover);
  }

  function renderDayTable() {
    clear(dayBody);
    const r = state.report;
    for (const d of r.days) {
      dayBody.appendChild(el('tr', { testid: `day-row-${d.day}`, dataset: { day: d.day } }, [
        el('td', { class: 'day-cell', text: d.label }),
        el('td', { class: 'num', text: String(d.orders) }),
        el('td', { class: 'num', text: String(d.items) }),
        el('td', { class: 'num num--strong', text: formatPenceGrouped(d.sales) }),
        el('td', { class: 'num', text: formatPenceGrouped(d.cash) }),
        el('td', { class: 'num', text: formatPenceGrouped(d.card) }),
        el('td', { class: 'num', text: formatPenceGrouped(d.avgOrder) }),
        el('td', { text: d.peak || '—' }),
        el('td', {}, [
          el('a', {
            class: 'open-day',
            testid: `open-day-${d.day}`,
            href: href('/reports', { day: d.day }),
            text: 'Open day',
            'aria-label': `Open day ${d.label}`
          })
        ])
      ]));
    }
    if (r.days.length) {
      dayBody.appendChild(el('tr', { class: 'totals-row', testid: 'days-totals-row' }, [
        el('td', { class: 'day-cell', text: 'Total' }),
        el('td', { class: 'num', text: String(r.totals.orders) }),
        el('td', { class: 'num', text: String(r.totals.items) }),
        el('td', { class: 'num num--strong', text: formatPenceGrouped(r.totals.sales) }),
        el('td', { class: 'num', text: formatPenceGrouped(r.totals.cash) }),
        el('td', { class: 'num', text: formatPenceGrouped(r.totals.card) }),
        el('td', { class: 'num', text: formatPenceGrouped(r.totals.avgOrder) }),
        el('td'),
        el('td')
      ]));
    }
  }

  function renderItemsTable() {
    clear(itemsHead);
    clear(itemsBody);
    const r = state.report;
    itemsHead.appendChild(el('th', { scope: 'col', text: 'Item' }));
    for (const d of r.days) {
      itemsHead.appendChild(el('th', { scope: 'col', class: 'num', title: d.label, text: d.weekday }));
    }
    itemsHead.append(
      el('th', { scope: 'col', class: 'num', text: 'Total' }),
      el('th', { scope: 'col', class: 'num', text: 'Sales' })
    );

    for (const item of r.items) {
      const row = el('tr', { testid: `item-day-row-${item.id}` }, [
        el('td', {}, [
          el('span', { class: 'matrix-item' }, [
            svgNode(itemIcon(item.id, 26)),
            el('b', { text: item.name })
          ])
        ])
      ]);
      for (const cell of item.cells) {
        row.appendChild(el('td', {
          class: 'num' + (cell.best && cell.units > 0 ? ' cell--best' : ''),
          testid: `matrix-${item.id}-${cell.day}`,
          dataset: { best: cell.best && cell.units > 0 ? 'true' : 'false' },
          text: String(cell.units)
        }));
      }
      row.append(
        el('td', { class: 'num num--strong', text: String(item.total) }),
        el('td', { class: 'num num--strong', text: formatPenceGrouped(item.sales) })
      );
      itemsBody.appendChild(row);
    }
  }

  function render() {
    const tooLong = !!state.error;
    const empty = !tooLong && state.report.tradingDays === 0;

    errorBox.hidden = !tooLong;
    if (tooLong) setText(errorBox, state.error);

    emptyCard.hidden = tooLong || !empty;
    chartSection.hidden = tooLong || empty;
    daySection.hidden = tooLong || empty;
    itemsSection.hidden = tooLong || empty;
    kpis.hidden = tooLong;

    renderKpis();
    if (!chartSection.hidden) renderChart();
    if (!daySection.hidden) renderDayTable();
    if (!itemsSection.hidden) renderItemsTable();
    renderQuickState();
  }

  function renderQuickState() {
    for (const q of quicks) {
      const on = q.key === state.quick;
      q.button.setAttribute('aria-pressed', on ? 'true' : 'false');
      q.button.dataset.on = on ? 'true' : 'false';
      q.wrap.dataset.on = on ? 'true' : 'false';
    }
  }

  /* ---------------------------------------------------------- range/query */

  function matchQuick(from, to) {
    const now = dayString();
    const seven = defaultRange(now);
    if (from === now && to === now) return 'today';
    if (from === seven.from && to === seven.to) return '7d';
    if (state.event && from === state.event.from && to === state.event.to) return 'event';
    return null;
  }

  function applyRange(from, to, quick) {
    const range = clampRange(from, to);
    if (!range.from || !range.to) {
      // Both boxes empty: fall back to the default range rather than query nothing.
      const fallback = defaultRange(dayString());
      state.from = fallback.from;
      state.to = fallback.to;
    } else {
      state.from = range.from;
      state.to = range.to;
    }
    fromInput.value = state.from;
    toInput.value = state.to;
    state.quick = quick !== null && quick !== undefined ? quick : matchQuick(state.from, state.to);

    if (range.tooLong) {
      // Too long: say so and make no query at all (CLAUDE.md Phase III 2).
      state.error = RANGE_TOO_LONG_MESSAGE;
      state.orders = [];
      state.report = buildRangeReport([]);
      queryToken += 1;
      render();
      return;
    }

    state.error = null;
    runQuery();
  }

  function runQuery() {
    const token = ++queryToken;
    const from = state.from;
    const to = state.to;
    fetchOrdersInRange(from, to)
      .then((orders) => {
        if (stopped || token !== queryToken) return;
        state.orders = orders;
        state.hoverDay = null;
        state.report = buildRangeReport(orders);
        render();
      })
      .catch((err) => {
        console.error('range query failed', err);
        if (stopped || token !== queryToken) return;
        state.orders = [];
        state.report = buildRangeReport([]);
        render();
      });
  }

  /* ----------------------------------------------------------------- CSV */

  function exportCsv() {
    const csv = ordersToCsv(state.orders);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: rangeCsvFilename(state.from, state.to) });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------------------------------------------------------- boot */

  render();
  runQuery();

  fetchEvent().then((event) => {
    if (stopped || !event || !isDayString(event.from) || !isDayString(event.to)) return;
    state.event = event;
    eventQuick.button.hidden = false;
    eventQuick.wrap.hidden = false;
    eventQuick.button.setAttribute('title', `${event.name}: ${formatDayLabel(event.from)} to ${formatDayLabel(event.to)}`);
    if (!state.quick) state.quick = matchQuick(state.from, state.to);
    renderQuickState();
  }).catch((err) => console.error('event lookup failed', err));

  return () => {
    stopped = true;
    queryToken += 1;
  };
}
