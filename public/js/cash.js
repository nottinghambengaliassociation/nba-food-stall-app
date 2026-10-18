// Cash counter: build an order, take payment, send it to the food counter.

import { el, clear, setText, svgNode } from './ui.js';
import { itemIcon } from './icons.js';
import {
  ACTIVE_MENU, QUICK_CASH, formatPence, orderTotal,
  parseAmountToPence, cashReceivedState,
  dayString, nextOrderNo
} from './logic.js';
import { watchMenu, watchOrders, createOrder, cancelOrder, isReady } from './store.js';

const TOAST_MS = 4000;

const STATUS_LABEL = {
  new: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
  collected: 'Collected',
  cancelled: 'Cancelled'
};

export function mountCash(outlet, ctx) {
  const state = {
    menu: ACTIVE_MENU.slice(),
    cart: {},
    payment: 'cash',
    // Cash received (optional): either a quick button ('exact' | pence) or
    // free text in the "Other amount" box. Never both.
    quick: null,
    other: '',
    orders: [],
    toastTimer: null
  };

  const phone = typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 699px)')
    : { matches: false, addEventListener: null };

  /* ---------------------------------------------------------- structure */

  const tilesSection = el('section', { class: 'tiles', 'aria-label': 'Menu' });

  const toast = el('div', {
    class: 'toast',
    testid: 'order-toast',
    role: 'status',
    'aria-live': 'polite'
  });

  const nameInput = el('input', {
    type: 'text',
    id: 'customer-name',
    testid: 'customer-name',
    placeholder: 'e.g. Priya',
    autocomplete: 'off',
    maxlength: '40'
  });

  const linesBox = el('div', { class: 'lines', testid: 'order-lines' });
  const totalValue = el('span', { class: 'total-row__value', testid: 'order-total', text: '£0.00' });

  const payCash = el('button', {
    type: 'button', class: 'pay-btn', testid: 'pay-cash', text: 'Cash',
    'aria-pressed': 'true',
    onclick: () => { state.payment = 'cash'; update(); }
  });
  const payCard = el('button', {
    type: 'button', class: 'pay-btn', testid: 'pay-card', text: 'Card',
    'aria-pressed': 'false',
    onclick: () => { state.payment = 'card'; resetTender(); update(); }
  });

  const tenderButtons = QUICK_CASH.map((value) => el('button', {
    type: 'button',
    class: 'tender__btn',
    testid: value === 'exact' ? 'tender-exact' : `tender-${value}`,
    text: value === 'exact' ? 'Exact' : '£' + value / 100,
    'aria-label': value === 'exact' ? 'Cash received: the exact total' : `Cash received £${value / 100}`,
    'aria-pressed': 'false',
    onclick: () => {
      // Tapping the selected button deselects it; a quick button clears the box.
      state.quick = state.quick === value ? null : value;
      state.other = '';
      otherInput.value = '';
      update();
    }
  }));

  const otherInput = el('input', {
    type: 'text',
    id: 'tender-other',
    testid: 'tender-other',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: 'e.g. 17.50',
    'aria-describedby': 'change-due',
    oninput: () => {
      state.other = otherInput.value;
      if (state.other.trim() !== '') state.quick = null;
      update();
    }
  });

  const clearTender = el('button', {
    type: 'button',
    class: 'link-btn tender__clear',
    testid: 'tender-clear',
    text: 'Clear',
    'aria-label': 'Clear the cash received amount',
    onclick: () => { resetTender(); update(); }
  });

  const changeValue = el('p', {
    class: 'change',
    id: 'change-due',
    testid: 'change-due',
    role: 'status',
    'aria-live': 'polite',
    dataset: { state: 'empty' }
  });

  const tenderBlock = el('div', { class: 'tender' }, [
    el('div', { class: 'tender__head' }, [
      el('span', { class: 'field-label' }, [
        document.createTextNode('Cash received '),
        el('span', { class: 'tender__optional', text: '(optional)' })
      ]),
      clearTender
    ]),
    el('div', { class: 'tender__grid', role: 'group', 'aria-label': 'Quick cash amounts' }, tenderButtons),
    el('div', { class: 'tender__other' }, [
      el('label', { class: 'field-label', for: 'tender-other', text: 'Other amount' }),
      el('span', { class: 'tender__input' }, [
        el('span', { class: 'tender__prefix', 'aria-hidden': 'true', text: '£' }),
        otherInput
      ])
    ]),
    changeValue
  ]);

  const sendButton = el('button', {
    type: 'button',
    class: 'send-btn',
    testid: 'send-order',
    text: 'Send to food counter',
    disabled: true,
    onclick: send
  });

  const clearButton = el('button', {
    type: 'button',
    class: 'link-btn',
    testid: 'clear-order',
    text: 'Clear order',
    onclick: () => { resetOrder(); update(); }
  });

  const panel = el('aside', { class: 'panel', 'aria-label': 'Current order' }, [
    toast,
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'customer-name', text: 'Name to call out' }),
      nameInput
    ]),
    linesBox,
    el('div', { class: 'total-row' }, [
      el('span', { class: 'total-row__label', text: 'Total' }),
      totalValue
    ]),
    el('div', { class: 'pay-group', role: 'group', 'aria-label': 'Payment method' }, [payCash, payCard]),
    tenderBlock,
    // Send + Clear ride together in a footer so the phone sheet can pin them
    // to its bottom edge (hotfix H1: 8 tiles leave the sheet shorter).
    el('div', { class: 'panel__foot' }, [sendButton, clearButton])
  ]);

  const recentList = el('div', { class: 'recent__items', testid: 'recent-list' });
  const recentSection = el('section', { class: 'recent', 'aria-label': 'Recent orders' }, [
    el('h2', { class: 'recent__label', text: 'Recent' }),
    recentList
  ]);

  const scroller = el('div', { class: 'cash__scroll' }, [tilesSection, recentSection]);
  const main = el('main', { class: 'cash' }, [scroller, panel]);
  outlet.appendChild(main);

  /* -------------------------------------------------------------- state */

  function qtyOf(id) { return state.cart[id] || 0; }

  function setQty(id, qty) {
    if (qty <= 0) delete state.cart[id];
    else state.cart[id] = qty;
    update();
  }

  function currentItems() {
    return state.menu
      .filter((m) => qtyOf(m.id) > 0)
      .map((m) => ({ id: m.id, name: m.name, qty: qtyOf(m.id), price: m.price }));
  }

  /** Cash received resets on Clear, on switching to Card, on send and on clearing the order. */
  function resetTender() {
    state.quick = null;
    state.other = '';
    otherInput.value = '';
  }

  function resetOrder() {
    state.cart = {};
    state.payment = 'cash';
    resetTender();
    nameInput.value = '';
  }

  /** Cash received in pence: a number, null (nothing entered) or NaN (unparseable). */
  function receivedPence(total) {
    if (state.other.trim() !== '') return parseAmountToPence(state.other);
    if (state.quick === 'exact') return total;
    if (typeof state.quick === 'number') return state.quick;
    return null;
  }

  function showToast(message) {
    setText(toast, message);
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      setText(toast, '');
      state.toastTimer = null;
    }, TOAST_MS);
  }

  function send() {
    const items = currentItems();
    if (!items.length) return;
    const total = orderTotal(items);
    const till = ctx.settings.till;
    const day = dayString();
    const name = nameInput.value.trim() || 'Guest';
    const orderNo = nextOrderNo(till, day);

    // Cash received is an on-screen calculator for the cashier only: nothing
    // about it is written to the order, and it never blocks the send.
    const order = {
      orderNo,
      name,
      items,
      total,
      payment: state.payment,
      status: 'new',
      day,
      till,
      createdAtMs: Date.now(),
      startedAtMs: null,
      readyAtMs: null,
      collectedAtMs: null,
      cancelledAtMs: null
    };

    // Not awaited on purpose: offline the promise only settles after the
    // server acknowledges, and the till must never wait for the network.
    if (isReady()) {
      createOrder(order).catch((err) => console.error('order write failed', err));
    } else {
      console.error('order not saved: storage not configured');
    }

    showToast(`${orderNo} sent to the food counter for ${name}`);
    resetOrder();
    update();
    ctx.refreshHeaderSub();
  }

  /* ------------------------------------------------------------- render */

  // Tiles are built once per menu change and then patched, so tapping a tile
  // never rips the focused button out of the DOM.
  const tileNodes = new Map();
  let tileSignature = null;

  function buildTiles() {
    // Every menu snapshot calls in here, most of them with identical items.
    // Rebuilding then would swap the buttons out from under a volunteer's
    // finger (and detach the node a test is about to tap), so skip no-ops.
    const signature = state.menu
      .map((m) => [m.id, m.name, m.price, m.colour].join('\u0001'))
      .join('\u0002');
    if (signature === tileSignature && tileNodes.size === state.menu.length) return;
    tileSignature = signature;
    clear(tilesSection);
    tileNodes.clear();
    for (const item of state.menu) {
      const badge = el('span', { class: 'tile__qty', testid: `qty-${item.id}`, text: '0' });
      const tile = el('button', {
        type: 'button',
        class: 'tile',
        testid: `tile-${item.id}`,
        style: `background:${item.colour || '#FFFFFF'}`,
        dataset: { selected: 'false' },
        onclick: () => setQty(item.id, qtyOf(item.id) + 1)
      }, [
        el('span', { class: 'visually-hidden', text: 'Add ' }),
        svgNode(itemIcon(item.id, 72)),
        el('span', { class: 'tile__name', text: item.name }),
        el('span', { class: 'tile__price', text: formatPence(item.price) })
      ]);
      tileNodes.set(item.id, { tile, badge });
      tilesSection.appendChild(tile);
    }
  }

  function syncTiles() {
    for (const [id, { tile, badge }] of tileNodes) {
      const qty = qtyOf(id);
      tile.dataset.selected = qty > 0 ? 'true' : 'false';
      if (qty > 0) {
        setText(badge, String(qty));
        if (badge.parentNode !== tile) tile.appendChild(badge);
      } else if (badge.parentNode === tile) {
        tile.removeChild(badge);
      }
    }
  }

  const lineNodes = new Map();
  const emptyLines = el('p', { class: 'lines__empty', text: 'Tap an item to start the order' });

  function renderLines() {
    const items = currentItems();
    const wanted = new Set(items.map((i) => i.id));

    for (const [id, node] of lineNodes) {
      if (!wanted.has(id)) {
        node.row.remove();
        lineNodes.delete(id);
      }
    }

    if (!items.length) {
      if (emptyLines.parentNode !== linesBox) linesBox.appendChild(emptyLines);
      return;
    }
    if (emptyLines.parentNode === linesBox) linesBox.removeChild(emptyLines);

    items.forEach((line, index) => {
      let node = lineNodes.get(line.id);
      if (!node) {
        const qtyEl = el('span', { class: 'line__qty', testid: `line-qty-${line.id}`, text: String(line.qty) });
        const amountEl = el('span', { class: 'line__amount' });
        const row = el('div', { class: 'line', testid: `line-${line.id}` }, [
          el('span', { class: 'line__name', text: line.name }),
          el('button', {
            type: 'button', class: 'stepper', testid: `line-dec-${line.id}`,
            'aria-label': `Remove one ${line.name}`, text: '−',
            onclick: () => setQty(line.id, qtyOf(line.id) - 1)
          }),
          qtyEl,
          el('button', {
            type: 'button', class: 'stepper', testid: `line-inc-${line.id}`,
            'aria-label': `Add one ${line.name}`, text: '+',
            onclick: () => setQty(line.id, qtyOf(line.id) + 1)
          }),
          amountEl
        ]);
        node = { row, qtyEl, amountEl };
        lineNodes.set(line.id, node);
      }
      setText(node.qtyEl, String(line.qty));
      setText(node.amountEl, formatPence(line.qty * line.price));
      if (linesBox.children[index] !== node.row) linesBox.appendChild(node.row);
    });
  }

  function renderRecent() {
    clear(recentList);
    const till = ctx.settings.till;
    const mine = state.orders
      .filter((o) => o.till === till)
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
      .slice(0, 5);

    if (!mine.length) {
      recentList.appendChild(el('span', { class: 'recent__empty', text: 'No orders from this till yet' }));
      return;
    }

    for (const order of mine) {
      const pill = el('span', {
        class: 'recent__item',
        testid: `recent-${order.orderNo}`,
        dataset: { status: order.status }
      }, [
        el('b', { text: order.orderNo }),
        document.createTextNode(`${order.name} · ${STATUS_LABEL[order.status] || order.status}`)
      ]);
      if (order.status === 'new') {
        pill.appendChild(el('button', {
          type: 'button',
          class: 'recent__cancel',
          testid: `cancel-${order.orderNo}`,
          text: 'Cancel',
          'aria-label': `Cancel order ${order.orderNo}`,
          onclick: () => {
            cancelOrder(order.id).catch((err) => console.error('cancel failed', err));
          }
        }));
      }
      recentList.appendChild(pill);
    }
  }

  function update() {
    const items = currentItems();
    const total = orderTotal(items);
    const empty = items.length === 0;

    syncTiles();
    renderLines();

    setText(totalValue, formatPence(total));
    sendButton.disabled = empty;
    setText(sendButton, empty ? 'Send to food counter' : `Send to food counter · ${formatPence(total)}`);

    payCash.setAttribute('aria-pressed', state.payment === 'cash' ? 'true' : 'false');
    payCard.setAttribute('aria-pressed', state.payment === 'card' ? 'true' : 'false');

    // An empty panel is a cleared order: the next one starts with no cash received.
    if (empty && (state.quick !== null || state.other !== '')) resetTender();

    tenderBlock.hidden = state.payment !== 'cash' || empty;
    tenderButtons.forEach((btn, i) => {
      const chosen = state.other.trim() === '' && state.quick === QUICK_CASH[i];
      btn.setAttribute('aria-pressed', chosen ? 'true' : 'false');
    });

    const received = receivedPence(total);
    const cash = cashReceivedState(total, received);
    otherInput.dataset.state = state.other.trim() === '' ? 'empty' : cash.state;
    clearTender.hidden = cash.state === 'empty';
    changeValue.dataset.state = cash.state;
    changeValue.hidden = cash.state === 'empty';
    setText(changeValue, phone.matches ? cash.shortMessage : cash.message);

    renderRecent();
  }

  /* ---------------------------------------------------------- listeners */

  const stopMenu = watchMenu((items) => {
    state.menu = items;
    buildTiles();
    update();
  });

  const stopOrders = watchOrders(dayString(), (orders) => {
    state.orders = orders;
    renderRecent();
  });

  const stopTill = ctx.onTillChange(() => renderRecent());

  // Sign out asks first while the panel still holds an unsent order.
  const stopGuard = typeof ctx.setUnsentGuard === 'function'
    ? ctx.setUnsentGuard(() => currentItems().length > 0)
    : null;

  // The change line has a long form on tablet and a short one on phone.
  const onBreakpoint = () => update();
  if (typeof phone.addEventListener === 'function') phone.addEventListener('change', onBreakpoint);

  buildTiles();
  update();

  return () => {
    if (state.toastTimer) clearTimeout(state.toastTimer);
    if (typeof phone.removeEventListener === 'function') phone.removeEventListener('change', onBreakpoint);
    if (stopGuard) stopGuard();
    stopMenu();
    stopOrders();
    stopTill();
  };
}
