// Cash counter: build an order, take payment, send it to the food counter.

import { el, clear, setText, svgNode } from './ui.js';
import { itemIcon } from './icons.js';
import {
  MENU, QUICK_TENDERS, formatPence, orderTotal, changeDue,
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
    menu: MENU.slice(),
    cart: {},
    payment: 'cash',
    tendered: null,
    orders: [],
    toastTimer: null
  };

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
    onclick: () => { state.payment = 'card'; state.tendered = null; update(); }
  });

  const tenderButtons = QUICK_TENDERS.map((value) => el('button', {
    type: 'button',
    class: 'tender__btn',
    testid: `tender-${value}`,
    text: '£' + value / 100,
    'aria-pressed': 'false',
    onclick: () => {
      state.tendered = state.tendered === value ? null : value;
      update();
    }
  }));

  const changeValue = el('span', { testid: 'change-due', text: '£0.00' });
  const tenderBlock = el('div', { class: 'tender' }, [
    el('span', { class: 'field-label', text: 'Cash received' }),
    el('div', { class: 'tender__grid' }, tenderButtons),
    el('p', { class: 'change' }, [document.createTextNode('Change to give: '), changeValue])
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
    sendButton,
    clearButton
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

  function resetOrder() {
    state.cart = {};
    state.payment = 'cash';
    state.tendered = null;
    nameInput.value = '';
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

    const order = {
      orderNo,
      name,
      items,
      total,
      payment: state.payment,
      tendered: state.payment === 'cash' ? state.tendered : null,
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

  function buildTiles() {
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

    tenderBlock.hidden = state.payment !== 'cash';
    tenderButtons.forEach((btn, i) => {
      btn.setAttribute('aria-pressed', state.tendered === QUICK_TENDERS[i] ? 'true' : 'false');
    });
    setText(changeValue, formatPence(changeDue(total, state.tendered)));

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

  buildTiles();
  update();

  return () => {
    if (state.toastTimer) clearTimeout(state.toastTimer);
    stopMenu();
    stopOrders();
    stopTill();
  };
}
