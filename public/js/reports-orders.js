// Orders list and order detail (CLAUDE.md Phase IV,
// design/ReportsOrders.dc.html and design/ReportsOrdersMobile.dc.html).
//
// Read-only: the same single-field `day == <day>` query as the One day report,
// live through onSnapshot, and no writes at all. Cancelled orders are listed
// but never counted in the total.
//
// The day and the selected order live in the hash (#/reports/orders?day=…&order=…)
// so a selection is a real history entry: on the phone the browser Back button
// walks from the detail back to the list.

import { el, clear, setText, svgNode } from './ui.js';
import { itemIcon } from './icons.js';
import { reportToggle } from './report-nav.js';
import { href, routeParam } from './router.js';
import { watchOrders } from './store.js';
import {
  ORDER_STATUS_FILTERS, ORDER_PAY_FILTERS, dayString, isDayString, formatPence,
  formatClock, formatDayLabel, filterOrders, sortOrdersNewestFirst, summariseOrders,
  orderSummary, orderAmount, orderTimeMs, orderTimeline, orderWaitText,
  statusLabel, paymentLabel, lineFullName, exportOrdersCsv, ordersCsvFilename,
  isEdited, orderChanges
} from './logic.js';

// Phase V: the cash counter now edits as well as cancels.
const DETAIL_NOTE = 'Read-only. Orders are edited and cancelled from the cash counter; status changes '
  + 'happen on the food counter. Cancelled orders are listed but excluded from every total.';

const SEARCH_PLACEHOLDER = { wide: 'e.g. A-041 or Priya', phone: 'Search no. or name' };

/** The small "Edited" tag after the status pill when editCount > 0 (Phase V 5). */
function editedTag(order, testid) {
  if (!isEdited(order)) return null;
  return el('span', { class: 'edited-tag', testid: testid || null, text: 'Edited' });
}

/** The status pill used in the table, on the phone cards and in the detail. */
function statusPill(order, testid) {
  const status = (order && order.status) || 'new';
  return el('span', {
    class: `status-pill status-pill--${status}`,
    testid: testid || null,
    dataset: { status },
    text: statusLabel(status)
  });
}

export function mountReportsOrders(outlet, ctx) {
  // #/reports/orders?day=YYYY-MM-DD opens that day; anything else opens today.
  const requestedDay = routeParam('day');

  const state = {
    day: isDayString(requestedDay) ? requestedDay : dayString(),
    selected: routeParam('order') || null,
    q: '',
    status: 'all',
    pay: 'all',
    orders: [],
    rows: []
  };

  let stopOrders = () => {};
  let stopped = false;
  // True once this screen has pushed a selection, so "All orders" can step
  // back through history instead of inventing a new entry.
  let pushedSelection = false;

  /* ------------------------------------------------------------- header */

  const exportButton = el('button', {
    type: 'button',
    class: 'btn-marigold',
    testid: 'export-orders-csv',
    text: 'Export these orders (CSV)',
    onclick: exportCsv
  });
  ctx.headerRight.appendChild(el('span', { class: 'btn-wrap', testid: 'orders-export-csv' }, [exportButton]));

  /* ------------------------------------------------------------ filters */

  const dayInput = el('input', {
    type: 'date',
    id: 'orders-day',
    class: 'range-input',
    testid: 'orders-day',
    value: state.day,
    onchange: () => {
      const next = isDayString(dayInput.value) ? dayInput.value : dayString();
      // A new day is not a new place to come back to: replace the entry.
      go({ day: next, order: null }, true);
    }
  });

  const searchInput = el('input', {
    type: 'text',
    id: 'orders-search',
    class: 'orders-search',
    testid: 'orders-search',
    autocomplete: 'off',
    placeholder: SEARCH_PLACEHOLDER.wide,
    oninput: () => {
      state.q = searchInput.value;
      render();
    }
  });

  function chipRow(defs, groupTestid, label, prefix, pick) {
    const buttons = defs.map((def) => el('button', {
      type: 'button',
      class: 'chip',
      testid: `${prefix}-${def.key}`,
      text: def.label,
      'aria-pressed': 'false',
      dataset: { key: def.key },
      onclick: () => pick(def.key)
    }));
    const group = el('div', {
      class: 'orders-chips',
      testid: groupTestid,
      role: 'group',
      'aria-label': label
    }, buttons);
    return { group, buttons };
  }

  const statusChips = chipRow(ORDER_STATUS_FILTERS, 'orders-status', 'Status', 'orders-status', (key) => {
    state.status = key;
    render();
  });

  const payChips = chipRow(ORDER_PAY_FILTERS, 'orders-pay', 'Payment', 'orders-pay', (key) => {
    state.pay = key;
    render();
  });

  // Payment is a tablet filter only (CLAUDE.md Phase IV 2): below 700px it is
  // taken out of the page rather than hidden, so nothing unreachable is left
  // behind for a finger or a screen reader to find.
  const payField = el('div', { class: 'orders-field orders-field--pay' }, [
    el('span', { class: 'range-label', text: 'Payment' }),
    payChips.group
  ]);

  const filters = el('section', { class: 'orders-filters', 'aria-label': 'Filters' }, [
    el('div', { class: 'orders-field orders-field--day' }, [
      el('label', { class: 'range-label', for: 'orders-day', text: 'Day' }),
      dayInput
    ]),
    el('div', { class: 'orders-field orders-field--search' }, [
      el('label', { class: 'range-label', for: 'orders-search', text: 'Search order number or name' }),
      searchInput
    ]),
    el('div', { class: 'orders-field orders-field--status' }, [
      el('span', { class: 'range-label', text: 'Status' }),
      statusChips.group
    ])
  ]);

  /* ------------------------------------------------------------ summary */

  const summaryText = el('b', { testid: 'orders-summary', text: '0 orders · £0.00' });
  const summaryLine = el('p', { class: 'orders-summary' }, [
    summaryText,
    el('span', { class: 'orders-summary__note', text: ' · newest first' })
  ]);

  /* --------------------------------------------------------------- list */

  const tableBody = el('tbody');
  const table = el('table', { class: 'data orders-table', testid: 'orders-table' }, [
    el('caption', { class: 'visually-hidden', text: "Orders for this day, newest first" }),
    el('thead', {}, [el('tr', {}, [
      el('th', { scope: 'col', text: 'Order' }),
      el('th', { scope: 'col', text: 'Time' }),
      el('th', { scope: 'col', text: 'Name' }),
      el('th', { scope: 'col', text: 'Items' }),
      el('th', { scope: 'col', class: 'num', text: 'Total' }),
      el('th', { scope: 'col', text: 'Pay' }),
      el('th', { scope: 'col', text: 'Status' }),
      el('th', { scope: 'col', class: 'num', text: 'Wait' })
    ])]),
    tableBody
  ]);

  const tableWrap = el('div', {
    class: 'table-wrap orders-table-wrap',
    tabindex: '0',
    role: 'region',
    'aria-label': 'Orders table'
  }, [table]);

  // The phone shows the same rows as cards (design/ReportsOrdersMobile.dc.html).
  const cardList = el('div', { class: 'orders-cards', testid: 'orders-list' });

  const emptyNote = el('p', { class: 'orders-empty', testid: 'orders-empty', text: 'No orders match these filters.' });
  emptyNote.hidden = true;

  const listCard = el('section', { class: 'orders-list-card', 'aria-label': 'Orders' }, [tableWrap, cardList, emptyNote]);

  /* ------------------------------------------------------------- detail */

  const backButton = el('button', {
    type: 'button',
    class: 'orders-back',
    testid: 'orders-back',
    onclick: goBackToList
  }, [
    svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>'),
    el('span', { text: 'All orders' })
  ]);
  const backWrap = el('span', { class: 'btn-wrap orders-back-wrap', testid: 'order-back' }, [backButton]);

  const detailEmpty = el('p', {
    class: 'order-detail__empty',
    testid: 'order-detail-empty',
    text: 'Select an order to see its items.'
  });
  const detailBody = el('div', { class: 'order-detail__body' });
  const detail = el('aside', {
    class: 'order-detail',
    testid: 'order-detail',
    'aria-label': 'Order detail'
  }, [backWrap, detailEmpty, detailBody]);

  const main = el('main', { class: 'reports reports-orders', dataset: { view: 'list' } }, [
    reportToggle('orders'),
    filters,
    summaryLine,
    el('div', { class: 'orders-cols' }, [listCard, detail])
  ]);
  outlet.appendChild(main);

  /* ---------------------------------------------- responsive placeholder */

  // The phone shows cards and the tablet a table. Only one of the two is ever
  // built, so a row can never be in the page but hidden under the other layout.
  const phone = typeof matchMedia === 'function' ? matchMedia('(max-width: 699px)') : null;
  const isPhone = () => !!(phone && phone.matches);

  function syncWidth() {
    const onPhone = isPhone();
    searchInput.placeholder = onPhone ? SEARCH_PLACEHOLDER.phone : SEARCH_PLACEHOLDER.wide;
    if (onPhone) {
      // A filter nobody can see must not keep filtering.
      if (payField.isConnected) payField.remove();
      state.pay = 'all';
    } else if (!payField.isConnected) {
      filters.appendChild(payField);
    }
  }

  function applyWidth() {
    syncWidth();
    render();
  }
  syncWidth();
  if (phone && typeof phone.addEventListener === 'function') phone.addEventListener('change', applyWidth);

  /* ------------------------------------------------------------ routing */

  /** Rewrite the hash for this screen. `replace` keeps the history entry. */
  function go(params, replace) {
    const next = {
      day: params.day === undefined ? state.day : params.day,
      order: params.order === undefined ? state.selected : params.order
    };
    const query = { day: next.day };
    if (next.order) query.order = next.order;
    const url = href('/reports/orders', query);
    if (url === location.hash) return;
    if (replace) location.replace(url);
    else location.hash = url;
  }

  function select(orderNo) {
    pushedSelection = true;
    go({ order: orderNo }, false);
  }

  function goBackToList() {
    // Came here by tapping a card, so Back is the honest way home; a deep link
    // straight to ?order=… gets the list without leaving the app.
    if (pushedSelection && typeof history !== 'undefined') history.back();
    else go({ order: null }, true);
  }

  /** The hash changed without leaving the screen (see app.js handleRoute). */
  ctx.onQueryChange((params) => {
    const day = params.get('day');
    const order = params.get('order');
    const nextDay = isDayString(day) ? day : dayString();
    state.selected = order || null;
    if (nextDay !== state.day) {
      state.day = nextDay;
      dayInput.value = nextDay;
      subscribe();
      return;
    }
    render();
  });

  /* -------------------------------------------------------------- render */

  function renderChips() {
    for (const button of statusChips.buttons) {
      button.setAttribute('aria-pressed', button.dataset.key === state.status ? 'true' : 'false');
    }
    for (const button of payChips.buttons) {
      button.setAttribute('aria-pressed', button.dataset.key === state.pay ? 'true' : 'false');
    }
  }

  function renderTable(rows) {
    clear(tableBody);
    for (const o of rows) {
      const no = o.orderNo || '';
      const selected = no === state.selected;
      const cancelled = o.status === 'cancelled';
      const button = el('button', {
        type: 'button',
        class: 'orders-no',
        testid: `orders-open-${no}`,
        text: no,
        'aria-label': `View order ${no}`,
        'aria-pressed': selected ? 'true' : 'false',
        onclick: () => select(no)
      });
      tableBody.appendChild(el('tr', {
        class: 'orders-row',
        testid: `orders-row-${no}`,
        dataset: { selected: selected ? 'true' : 'false', status: o.status || 'new' }
      }, [
        el('td', {}, [el('span', { class: 'btn-wrap', testid: `order-open-${no}` }, [button])]),
        el('td', { class: 'orders-time', text: formatClock(orderTimeMs(o)) }),
        el('td', { class: 'orders-name', text: o.name || 'Guest' }),
        el('td', { class: 'orders-items', text: orderSummary(o) }),
        el('td', { class: 'num orders-total' + (cancelled ? ' orders-total--cancelled' : ''), text: formatPence(orderAmount(o)) }),
        el('td', { text: paymentLabel(o.payment) }),
        el('td', {}, [statusPill(o), editedTag(o, `edited-tag-${no}`)]),
        el('td', { class: 'num orders-wait', text: orderWaitText(o) })
      ]));
    }
  }

  function renderCards(rows) {
    clear(cardList);
    for (const o of rows) {
      const no = o.orderNo || '';
      const name = o.name || 'Guest';
      const cancelled = o.status === 'cancelled';
      // No aria-label: an aria-label on a button whose own text is this long
      // fails WCAG 2.5.3 (axe label-content-name-mismatch, serious). The
      // hidden prefix gives "View order A-041 Priya Collected …" instead.
      cardList.appendChild(el('button', {
        type: 'button',
        class: 'orders-card-btn',
        testid: `orders-card-${no}`,
        dataset: { selected: no === state.selected ? 'true' : 'false', name },
        onclick: () => select(no)
      }, [
        el('span', { class: 'visually-hidden', text: 'View order' }),
        el('span', { class: 'orders-card__top' }, [
          el('span', { class: 'orders-card__no' }, [
            document.createTextNode(no + ' '),
            el('span', { class: 'orders-card__name', text: name })
          ]),
          el('span', { class: 'orders-card__pills' }, [statusPill(o), editedTag(o, `edited-tag-${no}`)])
        ]),
        el('span', { class: 'orders-card__items', text: orderSummary(o) }),
        el('span', { class: 'orders-card__foot' }, [
          el('span', { text: `${formatClock(orderTimeMs(o))} · ${paymentLabel(o.payment)} · till ${o.till || 'A'}` }),
          el('b', { class: cancelled ? 'orders-total--cancelled' : '', text: formatPence(orderAmount(o)) })
        ])
      ]));
    }
  }

  function metaField(label, testid, value) {
    return el('div', { class: 'order-detail__meta-item' }, [
      el('span', { class: 'order-detail__meta-label', text: label }),
      el('b', { testid, text: value })
    ]);
  }

  function renderDetail(order) {
    clear(detailBody);
    const empty = !order;
    detailEmpty.hidden = !empty;
    detailBody.hidden = empty;
    backWrap.hidden = empty;
    if (empty) return;

    const cancelled = order.status === 'cancelled';
    const items = Array.isArray(order.items) ? order.items : [];
    const qty = items.reduce((n, l) => n + (Math.round(Number(l && l.qty) || 0)), 0);

    detailBody.appendChild(el('div', { class: 'order-detail__head' }, [
      el('div', { class: 'order-detail__ids' }, [
        el('span', { class: 'order-detail__no', testid: 'order-detail-no', text: order.orderNo || '' }),
        el('span', { class: 'order-detail__name', testid: 'order-detail-name', text: order.name || 'Guest' })
      ]),
      el('span', { class: 'order-detail__pills' }, [
        statusPill(order, 'order-detail-status'),
        editedTag(order, 'order-detail-edited')
      ])
    ]));

    detailBody.appendChild(el('div', { class: 'order-detail__meta' }, [
      metaField('Till', 'order-detail-till', order.till || 'A'),
      metaField('Payment', 'order-detail-pay', paymentLabel(order.payment)),
      metaField('Placed', 'order-detail-placed', `${formatDayLabel(order.day)} ${formatClock(orderTimeMs(order))}`.trim()),
      metaField('Wait (placed to ready)', 'order-detail-wait', orderWaitText(order))
    ]));

    const steps = orderTimeline(order).map((step) => el('li', {
      class: 'timeline__step',
      testid: `order-step-${step.key}`,
      dataset: { reached: step.reached ? 'true' : 'false', step: step.key }
    }, [
      el('span', { class: 'timeline__dot', 'aria-hidden': 'true' }),
      el('span', { class: 'timeline__label', text: step.label }),
      el('span', { class: 'timeline__time', text: step.time }),
      // Phase V: "Cancelled 15:02 · Customer changed mind".
      step.note ? el('span', { class: 'timeline__note', text: `· ${step.note}` }) : null
    ]));

    detailBody.appendChild(el('div', { class: 'order-detail__block' }, [
      el('h3', { text: 'Timeline' }),
      el('ol', { class: 'timeline', testid: 'order-detail-timeline' }, steps)
    ]));

    // Phase V 5: what each edit changed, before and after.
    const changes = orderChanges(order);
    if (changes.length) {
      detailBody.appendChild(el('div', { class: 'order-detail__block' }, [
        el('h3', { text: 'Changes' }),
        el('ol', { class: 'changes', testid: 'order-detail-changes' }, changes.map((c, i) => el('li', {
          class: 'changes__item',
          testid: `order-change-${i + 1}`,
          dataset: { action: c.action }
        }, [
          el('span', { class: 'changes__head' }, [
            el('b', { text: `${c.label} ${c.time}` }),
            el('span', { class: 'changes__till', text: c.till ? ` · till ${c.till}` : '' }),
            c.reasonLabel ? el('span', { class: 'changes__reason', text: ` · ${c.reasonLabel}` }) : null
          ]),
          el('span', { class: 'changes__row' }, [
            el('span', { class: 'changes__label', text: 'Before' }),
            el('span', { text: `${c.beforeSummary || '—'} · ${formatPence(c.beforeTotal)}` })
          ]),
          c.action === 'edit'
            ? el('span', { class: 'changes__row' }, [
              el('span', { class: 'changes__label', text: 'After' }),
              el('span', { text: `${c.afterSummary || '—'} · ${formatPence(c.afterTotal)}` })
            ])
            : null
        ])))
      ]));
    }

    const lines = items.map((line) => {
      const lineQty = Math.round(Number(line && line.qty) || 0);
      const price = Math.round(Number(line && line.price) || 0);
      return el('tr', { testid: `order-line-${(line && line.id) || ''}` }, [
        el('td', {}, [
          el('span', { class: 'order-line__name' }, [
            svgNode(itemIcon(line && line.id, 26)),
            el('b', { text: lineFullName(line) })
          ])
        ]),
        el('td', { class: 'num', text: String(lineQty) }),
        el('td', { class: 'num order-line__price', text: formatPence(price) }),
        el('td', { class: 'num num--strong', text: formatPence(lineQty * price) })
      ]);
    });

    lines.push(el('tr', { class: 'totals-row' }, [
      el('td', { text: 'Total' }),
      el('td', { class: 'num', text: String(qty) }),
      el('td', { class: 'num order-line__price' }),
      el('td', {
        class: 'num order-detail__total' + (cancelled ? ' orders-total--cancelled' : ''),
        testid: 'order-detail-total',
        text: formatPence(orderAmount(order))
      })
    ]));

    detailBody.appendChild(el('div', { class: 'order-detail__block' }, [
      el('h3', { text: 'Items' }),
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data order-items', testid: 'order-detail-items' }, [
          el('caption', { class: 'visually-hidden', text: 'Items on this order' }),
          el('thead', {}, [el('tr', {}, [
            el('th', { scope: 'col', text: 'Item' }),
            el('th', { scope: 'col', class: 'num', text: 'Qty' }),
            el('th', { scope: 'col', class: 'num order-line__price', text: 'Price' }),
            el('th', { scope: 'col', class: 'num', text: 'Line' })
          ])]),
          el('tbody', {}, lines)
        ])
      ])
    ]));

    detailBody.appendChild(el('p', { class: 'order-detail__note', testid: 'order-detail-note', text: DETAIL_NOTE }));
  }

  function render() {
    const rows = sortOrdersNewestFirst(filterOrders(state.orders, state));
    state.rows = rows;

    renderChips();
    const onPhone = isPhone();
    if (onPhone) { clear(tableBody); renderCards(rows); } else { clear(cardList); renderTable(rows); }
    emptyNote.hidden = rows.length > 0;
    tableWrap.hidden = onPhone || rows.length === 0;
    cardList.hidden = !onPhone || rows.length === 0;

    setText(summaryText, summariseOrders(rows).text);

    // The selection survives a filter that hides it: the detail reads from the
    // whole day, not from the visible rows.
    const selected = state.selected
      ? state.orders.find((o) => o.orderNo === state.selected) || null
      : null;
    renderDetail(selected);
    main.dataset.view = selected ? 'detail' : 'list';
  }

  /* ----------------------------------------------------------------- CSV */

  function exportCsv() {
    const csv = exportOrdersCsv(state.rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: ordersCsvFilename(state.day) });
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
      if (stopped) return;
      state.orders = orders;
      render();
    });
  }

  subscribe();

  return () => {
    stopped = true;
    stopOrders();
    if (phone && typeof phone.removeEventListener === 'function') phone.removeEventListener('change', applyWidth);
  };
}
