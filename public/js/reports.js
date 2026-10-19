// Reports: a day's totals, sales by item, peak demand, cash vs card, CSV export.

import { el, clear, setText, svgNode } from './ui.js';
import { itemIcon } from './icons.js';
import {
  buildReport, ordersToCsv, formatPence, formatWait, dayString, hhmm, isDayString, MENU
} from './logic.js';
import { watchOrders } from './store.js';
import { reportToggle } from './report-nav.js';
import { routeParam } from './router.js';

export function mountReports(outlet, ctx) {
  // #/reports?day=YYYY-MM-DD opens on that day ("Open day" on the Sales by
  // day report links here); anything else opens on today.
  const requestedDay = routeParam('day');

  const state = {
    day: isDayString(requestedDay) ? requestedDay : dayString(),
    orders: [],
    showTable: false,
    report: buildReport([])
  };

  let stopOrders = () => {};

  /* ------------------------------------------------------ header controls */

  const dateInput = el('input', {
    type: 'date',
    id: 'report-date',
    testid: 'report-date',
    value: state.day,
    onchange: (e) => {
      state.day = e.target.value || dayString();
      subscribe();
    }
  });

  const exportButton = el('button', {
    type: 'button',
    class: 'btn-marigold',
    testid: 'export-csv',
    text: 'Export CSV',
    onclick: exportCsv
  });

  ctx.headerLeft.appendChild(el('span', { class: 'date-field' }, [
    el('label', { for: 'report-date', text: 'Day' }),
    dateInput
  ]));
  ctx.headerRight.appendChild(exportButton);

  /* ---------------------------------------------------------------- body */

  const kpiDefs = [
    ['kpi-sales', 'Total sales', 'cash + card'],
    ['kpi-orders', 'Orders', 'excludes cancelled'],
    ['kpi-items', 'Items sold', ''],
    ['kpi-avg-order', 'Average order', 'per customer'],
    ['kpi-avg-wait', 'Average wait', 'order placed to ready']
  ];

  const kpiNodes = {};
  const kpis = el('section', { class: 'kpis', 'aria-label': 'Day totals' }, kpiDefs.map(([testid, label, note]) => {
    const value = el('span', { class: 'kpi__value', testid, text: '—' });
    const noteEl = el('span', { class: 'kpi__note', text: note });
    kpiNodes[testid] = { value, note: noteEl };
    return el('div', { class: 'kpi' }, [
      el('span', { class: 'kpi__label', text: label }),
      value,
      noteEl
    ]);
  }));

  const peakValue = el('span', { testid: 'peak-slot', text: '—' });
  const windowValue = el('span', { testid: 'busiest-window', text: '—' });
  const peakCallout = el('p', { class: 'callout callout--peak' }, [
    el('b', { text: 'Peak 30 min: ' }), peakValue
  ]);
  const windowCallout = el('p', { class: 'callout' }, [
    el('b', { text: 'Busiest 2 hours: ' }), windowValue
  ]);

  const chartToggle = el('button', {
    type: 'button',
    class: 'btn-secondary',
    testid: 'chart-toggle',
    text: 'Show as table',
    'aria-pressed': 'false',
    onclick: () => {
      state.showTable = !state.showTable;
      setText(chartToggle, state.showTable ? 'Show chart' : 'Show as table');
      chartToggle.setAttribute('aria-pressed', state.showTable ? 'true' : 'false');
      renderChart();
    }
  });

  const chartBox = el('div', { class: 'chart-box', testid: 'chart-box' });

  const peakSection = el('section', { class: 'card-section peak-col', 'aria-label': 'Peak demand' }, [
    el('div', { class: 'section-head' }, [
      el('h2', { text: 'Orders per 30 minutes' }),
      chartToggle
    ]),
    el('div', { class: 'callouts' }, [peakCallout, windowCallout]),
    chartBox
  ]);

  const itemsBox = el('div', { class: 'items-box' });
  const itemsTotal = el('div', { class: 'split-legend', testid: 'items-total' });
  const itemsSection = el('section', { class: 'card-section', 'aria-label': 'Sales by item' }, [
    el('h2', { text: 'Sales by item' }),
    itemsBox,
    itemsTotal
  ]);

  const splitBarCash = el('div', { class: 'split-bar__cash' });
  const splitLegend = el('div', { class: 'split-legend', testid: 'pay-split' });
  const splitSection = el('section', { class: 'card-section', 'aria-label': 'Payment split' }, [
    el('h2', { text: 'Cash and card' }),
    el('div', { class: 'split-bar' }, [splitBarCash, el('div', { class: 'split-bar__card' })]),
    splitLegend,
    el('p', { class: 'kpi__note', text: 'Cash total is what should be in the tin at close. Card total should match the card reader day report.' })
  ]);

  const main = el('main', { class: 'reports' }, [
    reportToggle('day'),
    kpis,
    el('div', { class: 'report-cols' }, [
      peakSection,
      el('div', { class: 'side-col' }, [itemsSection, splitSection])
    ])
  ]);
  outlet.appendChild(main);

  /* -------------------------------------------------------------- render */

  function visibleSlots() {
    const slots = state.report.slots;
    let first = slots.findIndex((s) => s.count > 0);
    let last = -1;
    for (let i = slots.length - 1; i >= 0; i--) {
      if (slots[i].count > 0) { last = i; break; }
    }
    if (first === -1) { first = 22; last = 34; } // 11:00 to 17:30 when there is nothing yet
    first = Math.max(0, first - 1);
    last = Math.min(slots.length - 1, last + 1);
    return slots.slice(first, last + 1);
  }

  function renderChart() {
    clear(chartBox);
    const slots = visibleSlots();
    const max = Math.max(1, ...slots.map((s) => s.count));
    const peakIndex = state.report.peak ? state.report.peak.index : -1;

    if (state.showTable) {
      const rows = slots.map((s) => el('tr', {}, [
        el('td', { text: s.label }),
        el('td', { class: 'num', text: String(s.count) })
      ]));
      chartBox.appendChild(el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data', testid: 'slot-table' }, [
          el('caption', { class: 'visually-hidden', text: 'Orders per 30 minutes' }),
          el('thead', {}, [el('tr', {}, [
            el('th', { scope: 'col', text: 'Slot' }),
            el('th', { scope: 'col', class: 'num', text: 'Orders' })
          ])]),
          el('tbody', {}, rows)
        ])
      ]));
      return;
    }

    const bars = slots.map((s) => el('div', {
      class: 'chart__bar',
      dataset: { peak: s.index === peakIndex ? 'true' : 'false', slot: s.label },
      title: `${s.label}: ${s.count} ${s.count === 1 ? 'order' : 'orders'}`
    }, [
      el('span', { class: 'chart__fill', style: `height:${Math.round((s.count / max) * 100)}%` })
    ]));

    const ticks = slots.map((s, i) => el('span', {
      class: 'chart__tick',
      text: i % 2 === 0 ? hhmm(s.start) : ''
    }));

    chartBox.append(
      el('div', {
        class: 'chart',
        role: 'img',
        'aria-label': `Bar chart of orders per 30 minutes from ${slots[0].label.split('–')[0]} to ${slots[slots.length - 1].label.split('–')[1]}. ${
          state.report.peak ? `Peak ${state.report.peak.label} with ${state.report.peak.count} orders.` : 'No orders yet.'
        }`
      }, bars),
      el('div', { class: 'chart__ticks' }, ticks)
    );
  }

  function renderItems() {
    clear(itemsBox);
    const rows = state.report.byItem;
    const max = Math.max(1, ...rows.map((r) => r.units));
    if (!rows.length) {
      itemsBox.appendChild(el('p', { class: 'kpi__note', text: 'No sales yet for this day.' }));
    }
    for (const row of rows) {
      const seed = MENU.find((m) => m.id === row.id);
      itemsBox.appendChild(el('div', { class: 'item-row', testid: `item-row-${row.id}` }, [
        el('div', { class: 'item-row__top' }, [
          svgNode(itemIcon(row.id, 26)),
          el('span', { class: 'item-row__name', text: row.name || (seed && seed.name) || row.id }),
          el('span', { class: 'item-row__units', testid: `item-units-${row.id}`, text: String(row.units) }),
          el('span', { class: 'item-row__rev', testid: `item-revenue-${row.id}`, text: formatPence(row.revenue) })
        ]),
        el('div', { class: 'item-row__bar' }, [
          el('div', { class: 'item-row__fill', style: `width:${Math.round((row.units / max) * 100)}%` })
        ])
      ]));
    }
    clear(itemsTotal);
    itemsTotal.append(
      el('span', { text: 'Total' }),
      el('b', { text: `${state.report.itemsSold} items · ${formatPence(state.report.totalSales)}` })
    );
  }

  function renderSplit() {
    const { cash, card } = state.report.payment;
    splitBarCash.setAttribute('style', `width:${cash.percent}%`);
    clear(splitLegend);
    splitLegend.append(
      el('span', {}, [
        el('span', { class: 'swatch swatch--cash' }),
        document.createTextNode(' Cash '),
        el('b', { text: `${formatPence(cash.amount)} (${cash.percent}%)` })
      ]),
      el('span', {}, [
        el('span', { class: 'swatch swatch--card' }),
        document.createTextNode(' Card '),
        el('b', { text: `${formatPence(card.amount)} (${card.percent}%)` })
      ])
    );
  }

  function render() {
    state.report = buildReport(state.orders);
    const r = state.report;

    setText(kpiNodes['kpi-sales'].value, formatPence(r.totalSales));
    setText(kpiNodes['kpi-orders'].value, String(r.orderCount));
    setText(kpiNodes['kpi-items'].value, String(r.itemsSold));
    setText(kpiNodes['kpi-avg-order'].value, formatPence(r.averageOrder));
    setText(kpiNodes['kpi-avg-wait'].value, formatWait(r.averageWaitSeconds));
    setText(kpiNodes['kpi-items'].note, r.orderCount ? `${(r.itemsSold / r.orderCount).toFixed(1)} per order` : '');
    setText(kpiNodes['kpi-orders'].note, r.cancelledCount ? `excludes ${r.cancelledCount} cancelled` : 'excludes cancelled');

    setText(
      peakValue,
      r.peak ? `${r.peak.label}, ${r.peak.count} ${r.peak.count === 1 ? 'order' : 'orders'}` : 'No orders yet'
    );
    setText(
      windowValue,
      r.busiestWindow
        ? `${r.busiestWindow.label}, ${r.busiestWindow.count} ${r.busiestWindow.count === 1 ? 'order' : 'orders'} (${r.busiestWindow.share}% of the day)`
        : 'No orders yet'
    );

    renderChart();
    renderItems();
    renderSplit();
  }

  /* ----------------------------------------------------------------- CSV */

  function exportCsv() {
    const csv = ordersToCsv(state.orders);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `orders-${state.day}.csv` });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ----------------------------------------------------------- listeners */

  function subscribe() {
    stopOrders();
    state.orders = [];
    render();
    stopOrders = watchOrders(state.day, (orders) => {
      state.orders = orders;
      render();
    });
  }

  subscribe();

  return () => {
    stopOrders();
  };
}
