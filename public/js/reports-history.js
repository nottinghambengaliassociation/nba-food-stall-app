// Order history (CLAUDE.md Phase VI, design/ReportsHistory.dc.html and
// design/ReportsHistoryMobile.dc.html).
//
// Read-only and deliberately not live: one getDocs per range through the
// Phase III range query in store.js, then every filter, the grouping and the
// search run on the loaded orders. Nothing on this screen writes.
//
// The range, the filters and the selected order all live in the hash, so a
// link opens the same view and the browser Back button walks out of the
// phone's full-screen detail.

import { el, clear, setText, svgNode } from './ui.js';
import { itemIcon } from './icons.js';
import { reportToggle } from './report-nav.js';
import { href, currentQuery } from './router.js';
import { fetchOrdersInRange, fetchEvent } from './store.js';
import {
  HISTORY_STATUS_FILTERS, HISTORY_PAY_FILTERS, HISTORY_PAGE_SIZE,
  HISTORY_TOO_LONG_MESSAGE, HISTORY_EMPTY_MESSAGE, HISTORY_LOADING_MESSAGE,
  HISTORY_ERROR_MESSAGE, HISTORY_LARGE_MESSAGE,
  clampHistoryRange, defaultRange, todayRange, last30Range, yearRange,
  filterHistory, groupByDay, historySummary, historyTills, historyItems,
  historyFilterCount, historyCancelLine, historyEdits, historyHash, isLargeHistory,
  flattenHistory,
  parseHistoryHash, historyCsvFilename, historyToCsv,
  dayString, isDayString, formatPence, formatPenceGrouped, formatClock,
  formatDayFull, formatDayLabel, orderTimeMs, orderAmount, orderSummary,
  orderTimeline, orderWaitText, statusLabel, paymentLabel, lineFullName,
  isEdited
} from './logic.js';

const DETAIL_NOTE = 'Read-only history. Nothing here changes an order. '
  + 'Cancelled orders are listed but excluded from every total.';

const DETAIL_EMPTY = 'Select an order to see its items and history.';

const SEARCH_PLACEHOLDER = { wide: 'e.g. A-041 or Priya', phone: 'Search no. or name' };

const COPY_LABEL = 'Copy link to this order';
const COPIED_LABEL = 'Link copied';
const COPIED_MS = 3000;

const CHEVRON_LEFT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
  + '<path d="M15 18l-6-6 6-6"></path></svg>';

/** Copy text to the clipboard, with a textarea fallback for older browsers. */
async function copyText(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the textarea */ }
  try {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(box);
    return ok;
  } catch {
    return false;
  }
}

function statusPill(order, testid) {
  const status = (order && order.status) || 'new';
  return el('span', {
    class: `status-pill status-pill--${status}`,
    testid: testid || null,
    dataset: { status },
    text: statusLabel(status)
  });
}

function editedTag(order) {
  return isEdited(order) ? el('span', { class: 'edited-tag', text: 'Edited' }) : null;
}

export function mountReportsHistory(outlet, ctx) {
  const today = dayString();
  const fallback = defaultRange(today);
  const initial = parseHistoryHash(currentQuery());

  const state = {
    from: initial.from || fallback.from,
    to: initial.to || fallback.to,
    quick: null,
    status: initial.status,
    pay: initial.pay,
    till: initial.till,
    item: initial.item,
    edited: initial.edited,
    q: initial.q,
    order: initial.order,
    orders: [],
    rows: [],
    limit: HISTORY_PAGE_SIZE,
    loading: false,
    loadError: false,
    rangeError: null,
    event: null,
    filtersOpen: false
  };

  let queryToken = 0;
  let stopped = false;
  // The hash this screen wrote itself, so its own hashchange is not replayed.
  let ownHash = null;
  // True once a selection has been pushed, so "‹ Order history" can step back
  // through history instead of inventing a new entry.
  let pushedSelection = false;
  let copyTimer = null;
  let hashTimer = null;

  /* ------------------------------------------------------------- header */

  const exportButton = el('button', {
    type: 'button',
    class: 'btn-marigold',
    testid: 'history-export-csv',
    text: 'Export these orders (CSV)',
    onclick: exportCsv
  });
  ctx.headerRight.appendChild(el('span', { class: 'btn-wrap' }, [exportButton]));

  /* -------------------------------------------------------- range picker */

  const fromInput = el('input', {
    type: 'date',
    id: 'history-from',
    class: 'range-input',
    testid: 'history-from',
    value: state.from,
    onchange: () => applyRange(fromInput.value, toInput.value, null)
  });

  const toInput = el('input', {
    type: 'date',
    id: 'history-to',
    class: 'range-input',
    testid: 'history-to',
    value: state.to,
    onchange: () => applyRange(fromInput.value, toInput.value, null)
  });

  function quickButton(key, label, onclick) {
    const button = el('button', {
      type: 'button',
      class: 'quick-btn',
      testid: `history-range-${key}`,
      text: label,
      'aria-pressed': 'false',
      onclick
    });
    return { key, button };
  }

  const quicks = [
    quickButton('today', 'Today', () => { const r = todayRange(dayString()); applyRange(r.from, r.to, 'today'); }),
    quickButton('7d', 'Last 7 days', () => { const r = defaultRange(dayString()); applyRange(r.from, r.to, '7d'); }),
    quickButton('30d', 'Last 30 days', () => { const r = last30Range(dayString()); applyRange(r.from, r.to, '30d'); }),
    quickButton('event', 'This event', () => {
      if (!state.event) return;
      applyRange(state.event.from, state.event.to, 'event');
    }),
    quickButton('year', 'This year', () => { const r = yearRange(dayString()); applyRange(r.from, r.to, 'year'); })
  ];

  // Hidden until settings/event turns up (CLAUDE.md Phase III 2, Phase VI 2).
  const eventQuick = quicks.find((q) => q.key === 'event');
  eventQuick.button.hidden = true;

  const refreshButton = el('button', {
    type: 'button',
    class: 'quick-btn history-refresh',
    testid: 'history-refresh',
    text: 'Refresh',
    onclick: () => runQuery()
  });

  const searchInput = el('input', {
    type: 'text',
    id: 'history-search',
    class: 'orders-search',
    testid: 'history-search',
    autocomplete: 'off',
    placeholder: SEARCH_PLACEHOLDER.wide,
    value: state.q,
    oninput: () => {
      state.q = searchInput.value;
      state.limit = HISTORY_PAGE_SIZE;
      // The list redraws on every keystroke; the hash catches up once the
      // typing stops, so a long search does not fire a replace per letter.
      queueHashWrite();
      render();
    }
  });

  const rangeRow = el('div', { class: 'history-row history-row--range' }, [
    el('div', { class: 'orders-field' }, [
      el('label', { class: 'range-label', for: 'history-from', text: 'From' }),
      fromInput
    ]),
    el('div', { class: 'orders-field' }, [
      el('label', { class: 'range-label', for: 'history-to', text: 'To' }),
      toInput
    ]),
    el('div', { class: 'range-quick', role: 'group', 'aria-label': 'Quick ranges' },
      quicks.map((q) => q.button).concat([refreshButton])),
    el('div', { class: 'orders-field orders-field--search' }, [
      el('label', { class: 'range-label', for: 'history-search', text: 'Search order number or name' }),
      searchInput
    ])
  ]);

  /* ------------------------------------------------------------ filters */

  function chipRow(defs, prefix, label, pick) {
    const buttons = defs.map((def) => el('button', {
      type: 'button',
      class: 'chip',
      testid: `${prefix}-${def.key}`,
      text: def.label,
      'aria-pressed': 'false',
      dataset: { key: def.key },
      onclick: () => pick(def.key)
    }));
    const group = el('div', { class: 'orders-chips', role: 'group', 'aria-label': label }, buttons);
    return { group, buttons };
  }

  const statusChips = chipRow(HISTORY_STATUS_FILTERS, 'history-status', 'Status', (key) => {
    state.status = key;
    afterFilterChange();
  });

  const payChips = chipRow(HISTORY_PAY_FILTERS, 'history-pay', 'Payment', (key) => {
    state.pay = key;
    afterFilterChange();
  });

  const tillSelect = el('select', {
    id: 'history-till',
    class: 'history-select',
    testid: 'history-till',
    onchange: () => { state.till = tillSelect.value; afterFilterChange(); }
  });

  const itemSelect = el('select', {
    id: 'history-item',
    class: 'history-select',
    testid: 'history-item',
    onchange: () => { state.item = itemSelect.value; afterFilterChange(); }
  });

  const editedButton = el('button', {
    type: 'button',
    class: 'chip chip--edited',
    testid: 'history-edited',
    text: 'Edited only',
    'aria-pressed': 'false',
    onclick: () => { state.edited = !state.edited; afterFilterChange(); }
  });

  const clearButton = el('button', {
    type: 'button',
    class: 'link-btn history-clear',
    testid: 'history-clear',
    text: 'Clear filters',
    onclick: clearFilters
  });

  const statusField = el('div', { class: 'orders-field' }, [
    el('span', { class: 'range-label', text: 'Status' }), statusChips.group
  ]);
  const payField = el('div', { class: 'orders-field' }, [
    el('span', { class: 'range-label', text: 'Payment' }), payChips.group
  ]);
  const tillField = el('div', { class: 'orders-field' }, [
    el('label', { class: 'range-label', for: 'history-till', text: 'Till' }), tillSelect
  ]);
  const itemField = el('div', { class: 'orders-field' }, [
    el('label', { class: 'range-label', for: 'history-item', text: 'Item' }), itemSelect
  ]);

  const filterNodes = [statusField, payField, tillField, itemField, editedButton, clearButton];
  const filterRow = el('div', { class: 'history-row history-row--filters' }, filterNodes);

  // Phone: the second row moves into a bottom sheet behind a Filters button
  // (CLAUDE.md Phase VI 4, design/ReportsHistoryMobile.dc.html).
  const filtersOpenButton = el('button', {
    type: 'button',
    class: 'history-filters-btn',
    testid: 'history-filters-open',
    text: 'Filters',
    'aria-expanded': 'false',
    onclick: () => { state.filtersOpen ? closeFilters() : openFilters(); }
  });

  const filtersShowButton = el('button', {
    type: 'button',
    class: 'history-sheet__show',
    testid: 'history-filters-show',
    text: 'Show 0 orders',
    onclick: () => closeFilters()
  });

  const filtersSheetBody = el('div', { class: 'history-sheet__body' });
  const filtersSheet = el('section', {
    class: 'history-sheet',
    testid: 'history-filters-sheet',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Filters',
    tabindex: '-1'
  }, [
    el('div', { class: 'history-sheet__head' }, [
      el('h2', { class: 'history-sheet__title', text: 'Filters' }),
      el('button', {
        type: 'button',
        class: 'history-sheet__close',
        testid: 'history-filters-close',
        text: 'Close',
        onclick: () => closeFilters()
      })
    ]),
    filtersSheetBody,
    filtersShowButton
  ]);
  filtersSheet.hidden = true;

  const filtersBackdrop = el('div', { class: 'history-sheet__backdrop', onclick: () => closeFilters() });
  filtersBackdrop.hidden = true;

  const filtersCard = el('section', { class: 'history-filters', 'aria-label': 'Range and filters' }, [
    rangeRow,
    filterRow,
    el('div', { class: 'history-row history-row--phone' }, [filtersOpenButton])
  ]);

  const rangeError = el('p', { class: 'range-error', role: 'alert', testid: 'history-range-error' });
  rangeError.hidden = true;

  const loadingNote = el('p', { class: 'history-note', testid: 'history-loading', text: HISTORY_LOADING_MESSAGE });
  loadingNote.hidden = true;

  const loadError = el('p', { class: 'range-error', role: 'alert', testid: 'history-error', text: HISTORY_ERROR_MESSAGE });
  loadError.hidden = true;

  /* ------------------------------------------------------ summary tiles */

  const kpiDefs = [
    ['history-kpi-orders', 'Orders', 'across 0 trading days'],
    ['history-kpi-sales', 'Sales', 'excludes cancelled'],
    ['history-kpi-cancelled', 'Cancelled', '£0.00 not taken'],
    ['history-kpi-edited', 'Edited after sending', 'open one to see what changed']
  ];
  const kpiNodes = {};
  const kpis = el('section', { class: 'kpis history-kpis', 'aria-label': 'History totals' },
    kpiDefs.map(([testid, label, note]) => {
      const value = el('span', { class: 'kpi__value', text: '—' });
      const noteEl = el('span', { class: 'kpi__note', text: note });
      kpiNodes[testid] = { value, note: noteEl };
      return el('div', { class: 'kpi', testid }, [
        el('div', { class: 'kpi__inner' }, [el('span', { class: 'kpi__label', text: label }), value, noteEl])
      ]);
    }));

  const largeNote = el('p', { class: 'kpi__note history-large', testid: 'history-large', text: HISTORY_LARGE_MESSAGE });
  largeNote.hidden = true;

  const summaryLine = el('p', { class: 'orders-summary history-summary' }, [
    el('b', { testid: 'history-summary', text: '0 orders · £0.00' })
  ]);
  const summaryText = summaryLine.firstChild;

  /* --------------------------------------------------------------- list */

  const tableBody = el('tbody');
  const table = el('table', { class: 'data history-table' }, [
    el('caption', { class: 'visually-hidden', text: 'Orders in this range, newest first' }),
    el('thead', {}, [el('tr', {}, [
      el('th', { scope: 'col', text: 'Time' }),
      el('th', { scope: 'col', text: 'Order' }),
      el('th', { scope: 'col', text: 'Name' }),
      el('th', { scope: 'col', text: 'Items' }),
      el('th', { scope: 'col', class: 'num', text: 'Total' }),
      el('th', { scope: 'col', text: 'Pay' }),
      el('th', { scope: 'col', text: 'Till' }),
      el('th', { scope: 'col', text: 'Status' })
    ])]),
    tableBody
  ]);

  const tableWrap = el('div', {
    class: 'table-wrap history-table-wrap',
    tabindex: '0',
    role: 'region',
    'aria-label': 'Order history table'
  }, [table]);

  const cardList = el('div', { class: 'history-cards' });

  const emptyNote = el('p', { class: 'orders-empty', testid: 'history-empty', text: HISTORY_EMPTY_MESSAGE });
  emptyNote.hidden = true;

  const moreButton = el('button', {
    type: 'button',
    class: 'history-more',
    testid: 'history-more',
    text: 'Show 100 more',
    onclick: () => { state.limit += HISTORY_PAGE_SIZE; render(); }
  });
  moreButton.hidden = true;

  const listNote = el('p', {
    class: 'kpi__note history-list-note',
    text: 'Shows 100 orders at a time, then "Show 100 more". Range up to 366 days, loaded once; Refresh reloads.'
  });

  const listCard = el('section', { class: 'history-list-card', 'aria-label': 'Orders' },
    [tableWrap, cardList, emptyNote, moreButton, listNote]);

  /* ------------------------------------------------------------- detail */

  const backButton = el('button', {
    type: 'button',
    class: 'orders-back',
    testid: 'history-back',
    onclick: goBackToList
  }, [svgNode(CHEVRON_LEFT), el('span', { text: 'Order history' })]);
  const backWrap = el('span', { class: 'btn-wrap orders-back-wrap' }, [backButton]);

  const detailEmpty = el('p', { class: 'order-detail__empty', testid: 'history-detail-empty', text: DETAIL_EMPTY });
  const detailBody = el('div', { class: 'order-detail__body' });
  const detail = el('aside', {
    class: 'order-detail history-detail',
    testid: 'history-detail',
    'aria-label': 'Order detail'
  }, [backWrap, detailEmpty, detailBody]);

  const main = el('main', { class: 'reports reports-history', dataset: { view: 'list' } }, [
    reportToggle('history'),
    filtersCard,
    rangeError,
    loadingNote,
    loadError,
    kpis,
    largeNote,
    summaryLine,
    el('div', { class: 'orders-cols history-cols' }, [listCard, detail]),
    filtersBackdrop,
    filtersSheet
  ]);
  outlet.appendChild(main);

  /* ---------------------------------------------- responsive placeholder */

  const phone = typeof matchMedia === 'function' ? matchMedia('(max-width: 699px)') : null;
  const isPhone = () => !!(phone && phone.matches);

  function syncWidth() {
    const onPhone = isPhone();
    searchInput.placeholder = onPhone ? SEARCH_PLACEHOLDER.phone : SEARCH_PLACEHOLDER.wide;
    // One copy of every filter control, moved rather than duplicated: nothing
    // unreachable is ever left in the page for a finger or a screen reader.
    const home = onPhone ? filtersSheetBody : filterRow;
    for (const node of filterNodes) {
      if (node.parentNode !== home) home.appendChild(node);
    }
    if (!onPhone && state.filtersOpen) closeFilters({ focusButton: false });
  }

  function applyWidth() {
    syncWidth();
    render();
  }
  syncWidth();
  if (phone && typeof phone.addEventListener === 'function') phone.addEventListener('change', applyWidth);

  /* --------------------------------------------------------- filters sheet */

  function openFilters() {
    if (!isPhone()) return;
    state.filtersOpen = true;
    filtersSheet.hidden = false;
    filtersBackdrop.hidden = false;
    filtersOpenButton.setAttribute('aria-expanded', 'true');
    filtersSheet.focus({ preventScroll: true });
  }

  function closeFilters({ focusButton = true } = {}) {
    if (!state.filtersOpen) {
      filtersSheet.hidden = true;
      filtersBackdrop.hidden = true;
      filtersOpenButton.setAttribute('aria-expanded', 'false');
      return;
    }
    state.filtersOpen = false;
    filtersSheet.hidden = true;
    filtersBackdrop.hidden = true;
    filtersOpenButton.setAttribute('aria-expanded', 'false');
    if (focusButton) filtersOpenButton.focus({ preventScroll: true });
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    if (state.filtersOpen) { event.preventDefault(); closeFilters(); }
  }
  document.addEventListener('keydown', onKeyDown);

  /* ------------------------------------------------------------ routing */

  /** Write the hash once the volunteer stops typing. */
  function queueHashWrite() {
    if (hashTimer) clearTimeout(hashTimer);
    hashTimer = setTimeout(() => { hashTimer = null; writeHash(false); }, 300);
  }

  function writeHash(push) {
    if (hashTimer) { clearTimeout(hashTimer); hashTimer = null; }
    const url = historyHash(state);
    if (url === location.hash) return;
    ownHash = url;
    if (push) location.hash = url;
    else location.replace(url);
  }

  function select(id) {
    if (!id || id === state.order) return;
    state.order = id;
    pushedSelection = true;
    resetCopyLabel();
    writeHash(true);
    render();
  }

  function goBackToList() {
    if (pushedSelection && typeof history !== 'undefined') { history.back(); return; }
    state.order = null;
    writeHash(false);
    render();
  }

  ctx.onQueryChange((params) => {
    if (ownHash && location.hash === ownHash) { ownHash = null; return; }
    ownHash = null;
    applyHash(parseHistoryHash(params));
  });

  function applyHash(next) {
    const from = next.from || state.from;
    const to = next.to || state.to;
    const rangeChanged = from !== state.from || to !== state.to;
    state.status = next.status;
    state.pay = next.pay;
    state.till = next.till;
    state.item = next.item;
    state.edited = next.edited;
    state.order = next.order;
    if (next.q !== state.q) {
      state.q = next.q;
      searchInput.value = state.q;
    }
    resetCopyLabel();
    if (rangeChanged) {
      applyRange(from, to, null, { silent: true });
      return;
    }
    state.limit = HISTORY_PAGE_SIZE;
    render();
  }

  /* ---------------------------------------------------------- range/query */

  function matchQuick(from, to) {
    const now = dayString();
    if (from === now && to === now) return 'today';
    const seven = defaultRange(now);
    if (from === seven.from && to === seven.to) return '7d';
    const thirty = last30Range(now);
    if (from === thirty.from && to === thirty.to) return '30d';
    const year = yearRange(now);
    if (from === year.from && to === year.to) return 'year';
    if (state.event && from === state.event.from && to === state.event.to) return 'event';
    return null;
  }

  function applyRange(from, to, quick, { silent = false } = {}) {
    const range = clampHistoryRange(from, to);
    if (!range.from || !range.to) {
      const back = defaultRange(dayString());
      state.from = back.from;
      state.to = back.to;
    } else {
      state.from = range.from;
      state.to = range.to;
    }
    fromInput.value = state.from;
    toInput.value = state.to;
    state.quick = quick !== null && quick !== undefined ? quick : matchQuick(state.from, state.to);
    state.limit = HISTORY_PAGE_SIZE;
    if (!silent) writeHash(false);

    if (range.tooLong) {
      // Too long: say so and make no query at all (CLAUDE.md Phase VI 2).
      state.rangeError = HISTORY_TOO_LONG_MESSAGE;
      state.orders = [];
      state.loading = false;
      state.loadError = false;
      queryToken += 1;
      render();
      return;
    }

    state.rangeError = null;
    runQuery();
  }

  function runQuery() {
    if (state.rangeError) return;
    const token = ++queryToken;
    state.loading = true;
    state.loadError = false;
    render();
    fetchOrdersInRange(state.from, state.to)
      .then((orders) => {
        if (stopped || token !== queryToken) return;
        state.orders = orders;
        state.loading = false;
        state.loadError = false;
        rebuildSelects();
        render();
      })
      .catch((err) => {
        console.error('history query failed', err);
        if (stopped || token !== queryToken) return;
        state.orders = [];
        state.loading = false;
        state.loadError = true;
        render();
      });
  }

  function afterFilterChange() {
    state.limit = HISTORY_PAGE_SIZE;
    writeHash(false);
    render();
  }

  function clearFilters() {
    state.status = 'all';
    state.pay = 'all';
    state.till = 'all';
    state.item = 'all';
    state.edited = false;
    state.q = '';
    searchInput.value = '';
    afterFilterChange();
  }

  /* -------------------------------------------------------------- selects */

  function fillSelect(select, options, value) {
    const list = options.slice();
    if (value && value !== 'all' && !list.some((o) => o.key === value)) {
      list.push({ key: value, label: value });
    }
    clear(select);
    for (const option of list) {
      select.appendChild(el('option', { value: option.key, text: option.label }));
    }
    select.value = value && list.some((o) => o.key === value) ? value : 'all';
  }

  function rebuildSelects() {
    fillSelect(tillSelect, historyTills(state.orders), state.till);
    fillSelect(itemSelect, historyItems(state.orders), state.item);
  }
  rebuildSelects();

  /* -------------------------------------------------------------- render */

  function renderControls() {
    for (const q of quicks) {
      const on = q.key === state.quick;
      q.button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    for (const button of statusChips.buttons) {
      button.setAttribute('aria-pressed', button.dataset.key === state.status ? 'true' : 'false');
    }
    for (const button of payChips.buttons) {
      button.setAttribute('aria-pressed', button.dataset.key === state.pay ? 'true' : 'false');
    }
    editedButton.setAttribute('aria-pressed', state.edited ? 'true' : 'false');
    if (tillSelect.value !== state.till) tillSelect.value = state.till;
    if (itemSelect.value !== state.item) itemSelect.value = state.item;
    const n = historyFilterCount(state);
    setText(filtersOpenButton, n ? `Filters (${n})` : 'Filters');
    filtersOpenButton.dataset.on = n ? 'true' : 'false';
  }

  function renderTable(groups) {
    clear(tableBody);
    for (const group of groups) {
      tableBody.appendChild(el('tr', { class: 'history-day', testid: `history-day-${group.day}` }, [
        el('td', { colspan: '8' }, [
          el('span', { class: 'history-day__inner' }, [
            el('b', { class: 'history-day__label', text: group.label }),
            el('span', { class: 'history-day__meta', text: group.meta })
          ])
        ])
      ]));
      for (const o of group.orders) {
        const id = o.id || o.orderNo || '';
        const no = o.orderNo || '';
        const selected = id === state.order;
        const cancelled = o.status === 'cancelled';
        tableBody.appendChild(el('tr', {
          class: 'orders-row',
          testid: `history-row-${id}`,
          dataset: { selected: selected ? 'true' : 'false', status: o.status || 'new', day: o.day || '' }
        }, [
          el('td', { class: 'orders-time', text: formatClock(orderTimeMs(o)) }),
          el('td', {}, [el('button', {
            type: 'button',
            class: 'orders-no',
            testid: `history-open-${id}`,
            text: no,
            'aria-label': `View order ${no} on ${group.label}`,
            'aria-pressed': selected ? 'true' : 'false',
            onclick: () => select(id)
          })]),
          el('td', { class: 'orders-name', text: o.name || 'Guest' }),
          el('td', { class: 'orders-items' }, [
            el('span', { text: orderSummary(o) }),
            editedTag(o)
          ]),
          el('td', {
            class: 'num orders-total' + (cancelled ? ' orders-total--cancelled history-total--cancelled' : ''),
            text: formatPence(orderAmount(o))
          }),
          el('td', { text: paymentLabel(o.payment) }),
          el('td', { text: o.till || '' }),
          el('td', {}, [statusPill(o)])
        ]));
      }
    }
  }

  function renderCards(groups) {
    clear(cardList);
    for (const group of groups) {
      cardList.appendChild(el('div', {
        class: 'history-day-head',
        testid: `history-day-${group.day}`
      }, [
        el('b', { class: 'history-day__label', text: group.label }),
        el('span', { class: 'history-day__meta', text: group.meta })
      ]));
      for (const o of group.orders) {
        const id = o.id || o.orderNo || '';
        const no = o.orderNo || '';
        const name = o.name || 'Guest';
        const cancelled = o.status === 'cancelled';
        cardList.appendChild(el('div', { class: 'history-card-wrap', testid: `history-row-${id}` }, [
          el('button', {
            type: 'button',
            class: 'orders-card-btn',
            testid: `history-open-${id}`,
            dataset: { selected: id === state.order ? 'true' : 'false' },
            onclick: () => select(id)
          }, [
            el('span', { class: 'visually-hidden', text: 'View order' }),
            el('span', { class: 'orders-card__top' }, [
              el('span', { class: 'orders-card__no' }, [
                document.createTextNode(no + ' '),
                el('span', { class: 'orders-card__name', text: name })
              ]),
              el('span', { class: 'orders-card__pills' }, [statusPill(o)])
            ]),
            el('span', { class: 'orders-card__items' }, [
              el('span', { text: orderSummary(o) }),
              editedTag(o)
            ]),
            el('span', { class: 'orders-card__foot' }, [
              el('span', { text: `${formatClock(orderTimeMs(o))} · ${paymentLabel(o.payment)} · till ${o.till || 'A'}` }),
              el('b', { class: cancelled ? 'orders-total--cancelled history-total--cancelled' : '', text: formatPence(orderAmount(o)) })
            ])
          ])
        ]));
      }
    }
  }

  function metaField(label, testid, value) {
    return el('div', { class: 'order-detail__meta-item' }, [
      el('span', { class: 'order-detail__meta-label', text: label }),
      el('b', { testid, text: value })
    ]);
  }

  const copyButton = el('button', {
    type: 'button',
    class: 'history-copy',
    testid: 'history-copy-link',
    text: COPY_LABEL,
    onclick: onCopyLink
  });

  function resetCopyLabel() {
    if (copyTimer) { clearTimeout(copyTimer); copyTimer = null; }
    setText(copyButton, COPY_LABEL);
  }

  function onCopyLink() {
    const base = location.href.split('#')[0];
    const link = base + historyHash({ ...state, order: state.order });
    copyText(link).finally(() => {
      setText(copyButton, COPIED_LABEL);
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { copyTimer = null; setText(copyButton, COPY_LABEL); }, COPIED_MS);
    });
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

    detailBody.appendChild(el('div', { class: 'order-detail__head' }, [
      el('div', { class: 'order-detail__ids' }, [
        el('span', { class: 'history-detail__day', testid: 'history-detail-day', text: formatDayFull(order.day) || order.day || '' }),
        el('span', { class: 'order-detail__no', testid: 'history-detail-no', text: order.orderNo || '' }),
        el('span', { class: 'order-detail__name', testid: 'history-detail-name', text: order.name || 'Guest' })
      ]),
      el('span', { class: 'order-detail__pills' }, [statusPill(order, 'history-detail-status'), editedTag(order)])
    ]));

    detailBody.appendChild(el('div', { class: 'order-detail__meta' }, [
      metaField('Till', 'history-detail-till', order.till || 'A'),
      metaField('Payment', 'history-detail-pay', paymentLabel(order.payment)),
      metaField('Wait', 'history-detail-wait', orderWaitText(order))
    ]));

    if (cancelled) {
      detailBody.appendChild(el('p', {
        class: 'history-cancel-box',
        testid: 'history-detail-cancelled',
        text: historyCancelLine(order)
      }));
    }

    const steps = orderTimeline(order).map((step) => el('li', {
      class: 'timeline__step',
      testid: `history-step-${step.key}`,
      dataset: { reached: step.reached ? 'true' : 'false', step: step.key }
    }, [
      el('span', { class: 'timeline__dot', 'aria-hidden': 'true' }),
      el('span', { class: 'timeline__label', text: step.label }),
      el('span', { class: 'timeline__time', text: step.time }),
      step.note ? el('span', { class: 'timeline__note', text: `· ${step.note}` }) : null
    ]));

    detailBody.appendChild(el('div', { class: 'order-detail__block' }, [
      el('h3', { text: 'Timeline' }),
      el('ol', { class: 'timeline', testid: 'history-detail-timeline' }, steps)
    ]));

    const lines = items.map((line) => {
      const qty = Math.round(Number(line && line.qty) || 0);
      const price = Math.round(Number(line && line.price) || 0);
      return el('div', { class: 'history-line', testid: `history-line-${(line && line.id) || ''}` }, [
        svgNode(itemIcon(line && line.id, 26)),
        el('b', { class: 'history-line__name', text: lineFullName(line) }),
        el('span', { class: 'history-line__qty', text: `${qty}×` }),
        el('b', { class: 'history-line__amount', text: formatPence(qty * price) })
      ]);
    });

    detailBody.appendChild(el('div', { class: 'order-detail__block' }, [
      el('h3', { text: 'Items' }),
      el('div', { class: 'history-lines' }, lines),
      el('div', { class: 'history-total-row' }, [
        el('span', { text: 'Total' }),
        el('span', {
          class: 'order-detail__total' + (cancelled ? ' orders-total--cancelled' : ''),
          testid: 'history-detail-total',
          text: formatPence(orderAmount(order))
        })
      ])
    ]));

    // Changes: one box per edit. Orders from before Phase V carry no history
    // at all, so this section simply does not appear (CLAUDE.md Phase VI 7).
    const changes = historyEdits(order);
    if (changes.length) {
      detailBody.appendChild(el('div', { class: 'order-detail__block' }, [
        el('h3', { text: 'Changes' }),
        el('ol', { class: 'history-changes', testid: 'history-changes' }, changes.map((c, i) => el('li', {
          class: 'history-change',
          testid: `history-change-${i + 1}`
        }, [
          el('b', { class: 'history-change__head', text: c.head }),
          el('span', { class: 'history-change__row' }, [
            el('span', { class: 'history-change__label', text: 'Before:' }),
            el('span', { text: c.beforeText })
          ]),
          el('span', { class: 'history-change__row' }, [
            el('span', { class: 'history-change__label', text: 'After:' }),
            el('span', { text: c.afterText })
          ]),
          el('b', { class: 'history-change__money', text: c.money })
        ])))
      ]));
    }

    detailBody.appendChild(el('div', { class: 'history-detail__actions' }, [
      copyButton,
      el('a', {
        class: 'open-day history-open-day',
        testid: 'history-open-day',
        href: href('/reports/orders', { day: order.day || dayString() }),
        text: 'Open this day in Orders'
      })
    ]));

    detailBody.appendChild(el('p', { class: 'order-detail__note', text: DETAIL_NOTE }));
  }

  function renderSummary(summary) {
    setText(kpiNodes['history-kpi-orders'].value, String(summary.orders));
    setText(kpiNodes['history-kpi-orders'].note, summary.daysNote);
    setText(kpiNodes['history-kpi-sales'].value, formatPenceGrouped(summary.sales));
    setText(kpiNodes['history-kpi-sales'].note, 'excludes cancelled');
    setText(kpiNodes['history-kpi-cancelled'].value, String(summary.cancelled));
    setText(kpiNodes['history-kpi-cancelled'].note, summary.cancelledNote);
    setText(kpiNodes['history-kpi-edited'].value, String(summary.edited));
    setText(summaryText, summary.text);
    // Driven by what the range loaded, not by what the filters left: the
    // warning is about the read, not about the list (CLAUDE.md Phase VI 9).
    largeNote.hidden = !isLargeHistory(state.orders.length);
  }

  function render() {
    renderControls();

    const blocked = !!state.rangeError;
    rangeError.hidden = !blocked;
    if (blocked) setText(rangeError, state.rangeError);
    loadingNote.hidden = blocked || !state.loading;
    loadError.hidden = blocked || !state.loadError;

    const rows = blocked ? [] : filterHistory(state.orders, state);
    // Newest first comes from groupByDay; the flat list keeps the same order
    // so the CSV and the "Show 100 more" count agree with the screen.
    const flat = flattenHistory(groupByDay(rows));
    state.rows = flat;

    const shown = flat.slice(0, state.limit);
    const groups = groupByDay(shown);
    const left = flat.length - shown.length;

    const onPhone = isPhone();
    if (onPhone) { clear(tableBody); renderCards(groups); } else { clear(cardList); renderTable(groups); }

    const busy = state.loading || state.loadError || blocked;
    emptyNote.hidden = busy || flat.length > 0;
    tableWrap.hidden = onPhone || busy || flat.length === 0;
    cardList.hidden = !onPhone || busy || flat.length === 0;
    moreButton.hidden = left <= 0;
    setText(moreButton, `Show ${HISTORY_PAGE_SIZE} more (${left} left)`);
    listNote.hidden = flat.length === 0;

    const summary = historySummary(rows);
    renderSummary(summary);
    setText(filtersShowButton, `Show ${summary.orders} ${summary.orders === 1 ? 'order' : 'orders'}`);

    // The selection survives a filter that hides it: the detail reads from the
    // whole loaded range, not from the visible rows.
    const selected = state.order
      ? state.orders.find((o) => (o.id || o.orderNo) === state.order) || null
      : null;
    renderDetail(selected);
    main.dataset.view = selected ? 'detail' : 'list';
  }

  /* ----------------------------------------------------------------- CSV */

  function exportCsv() {
    const csv = historyToCsv(state.rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: historyCsvFilename(state.from, state.to) });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------------------------------------------------------- boot */

  state.quick = matchQuick(state.from, state.to);
  render();
  runQuery();

  fetchEvent().then((event) => {
    if (stopped || !event || !isDayString(event.from) || !isDayString(event.to)) return;
    state.event = event;
    eventQuick.button.hidden = false;
    eventQuick.button.setAttribute('title', `${event.name}: ${formatDayLabel(event.from)} to ${formatDayLabel(event.to)}`);
    if (!state.quick) state.quick = matchQuick(state.from, state.to);
    renderControls();
  }).catch((err) => console.error('event lookup failed', err));

  return () => {
    stopped = true;
    queryToken += 1;
    if (copyTimer) clearTimeout(copyTimer);
    if (hashTimer) clearTimeout(hashTimer);
    document.removeEventListener('keydown', onKeyDown);
    if (phone && typeof phone.removeEventListener === 'function') phone.removeEventListener('change', applyWidth);
  };
}
