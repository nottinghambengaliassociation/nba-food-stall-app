// Cash counter: build an order, take payment, send it to the food counter.

import { el, clear, setText, svgNode } from './ui.js';
import { itemIcon } from './icons.js';
import {
  ACTIVE_MENU, QUICK_CASH, formatPence, orderTotal,
  parseAmountToPence, cashReceivedState,
  dayString, nextOrderNo
} from './logic.js';
import { watchMenu, watchOrders, createOrder, cancelOrder, isReady } from './store.js';
import { clearSession, openSignOutConfirm } from './login.js';
import { href } from './router.js';
import { loadVersion } from './app-version.js';

const TOAST_MS = 4000;

const MENU_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>`;
const CHEVRON_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"></path></svg>`;

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
    // Hotfix H4: every new order starts on Card. Not remembered between orders.
    payment: 'card',
    // Cash received (optional): either a quick button ('exact' | pence) or
    // free text in the "Other amount" box. Never both.
    quick: null,
    other: '',
    orders: [],
    toastTimer: null,
    // Hotfix H3: small-screen chrome. The sheet, the ☰ menu and the recent
    // orders sheet only exist below 700px; above it these stay false and the
    // tablet panel is simply always on screen.
    sheet: false,
    appMenu: false,
    recent: false,
    // The phone sheet hides the Other amount box behind a link.
    otherOpen: false
  };

  const phone = typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 699px)')
    : { matches: false, addEventListener: null };

  /** True while the H3 small-screen cash layout is the one on screen. */
  const isSmall = () => phone.matches === true;

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

  // Hotfix H4: Card is the default, so it is the pressed one on first paint,
  // before update() has run.
  const payCash = el('button', {
    type: 'button', class: 'pay-btn', testid: 'pay-cash', text: 'Cash',
    'aria-pressed': 'false',
    onclick: () => { state.payment = 'cash'; update(); }
  });
  const payCard = el('button', {
    type: 'button', class: 'pay-btn', testid: 'pay-card', text: 'Card',
    'aria-pressed': 'true',
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

  // Phone only (hotfix H3 4): the Other amount box starts folded away behind
  // this link, so the five quick buttons and Send both fit in the sheet.
  const otherToggle = el('button', {
    type: 'button',
    class: 'link-btn tender__toggle',
    testid: 'tender-other-toggle',
    text: 'Other amount',
    'aria-expanded': 'false',
    'aria-controls': 'tender-other',
    onclick: () => {
      state.otherOpen = !state.otherOpen;
      update();
      if (state.otherOpen) otherInput.focus();
    }
  });

  const otherRow = el('div', { class: 'tender__other' }, [
    el('label', { class: 'field-label', for: 'tender-other', text: 'Other amount' }),
    el('span', { class: 'tender__input' }, [
      el('span', { class: 'tender__prefix', 'aria-hidden': 'true', text: '£' }),
      otherInput
    ])
  ]);

  const tenderBlock = el('div', { class: 'tender' }, [
    el('div', { class: 'tender__head' }, [
      el('span', { class: 'field-label' }, [
        document.createTextNode('Cash received '),
        el('span', { class: 'tender__optional', text: '(optional)' })
      ]),
      clearTender
    ]),
    el('div', { class: 'tender__grid', role: 'group', 'aria-label': 'Quick cash amounts' }, tenderButtons),
    // One wrapper so the phone link and the box share a grid row; on tablet
    // the link is display:none and this looks exactly as it did before.
    el('div', { class: 'tender__otherwrap' }, [otherToggle, otherRow]),
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

  // Send and Clear ride together so the phone sheet can pin them to its
  // bottom edge.
  const panelFoot = el('div', { class: 'panel__foot' }, [sendButton, clearButton]);

  // Sheet header (phone only): "Order · 3 items" and the Add more button that
  // closes the sheet and puts the tiles back (hotfix H3 4).
  const sheetCount = el('span', { class: 'sheet__title', text: 'Order' });
  const addMore = el('button', {
    type: 'button',
    class: 'sheet__more',
    testid: 'sheet-add-more',
    text: 'Add more',
    'aria-label': 'Add more items',
    onclick: () => closeSheet()
  });
  const sheetHead = el('div', { class: 'sheet__head' }, [sheetCount, addMore]);

  const panel = el('aside', { class: 'panel', 'aria-label': 'Current order' }, [
    sheetHead,
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
    panelFoot
  ]);

  const recentList = el('div', { class: 'recent__items', testid: 'recent-list' });
  const recentSection = el('section', { class: 'recent', 'aria-label': 'Recent orders' }, [
    el('h2', { class: 'recent__label', text: 'Recent' }),
    recentList
  ]);

  /* ------------------------------------------- hotfix H3: phone chrome */

  // The order panel becomes a bottom sheet below 700px. The wrapper is
  // display:contents on tablet (the panel stays a plain flex child there), so
  // it only carries the review-sheet test id below 700px, where it is a box.
  const sheet = el('div', { class: 'sheet' }, [panel]);
  const backdrop = el('div', {
    class: 'sheet__backdrop',
    onclick: () => closeSheet()
  });

  const barLabel = el('span', { class: 'order-bar__count', text: '0 items · £0.00' });
  const orderBarButton = el('button', {
    type: 'button',
    class: 'order-bar__btn',
    testid: 'order-bar-open',
    onclick: () => openSheet()
  }, [
    barLabel,
    el('span', { class: 'order-bar__cta' }, [
      document.createTextNode('Review & send'),
      svgNode(CHEVRON_ICON)
    ])
  ]);
  const orderBar = el('div', { class: 'order-bar', testid: 'order-bar' }, [orderBarButton]);
  orderBar.hidden = true;

  // Recent orders move off the phone screen into ☰ → Recent orders (H3 6).
  const recentSheet = el('div', { class: 'mini-sheet', testid: 'recent-sheet', role: 'dialog', 'aria-label': 'Recent orders' }, [
    el('div', { class: 'mini-sheet__head' }, [
      el('h2', { class: 'mini-sheet__title', text: 'Recent orders' }),
      el('button', {
        type: 'button',
        class: 'sheet__more',
        testid: 'recent-close',
        text: 'Close',
        onclick: () => closeRecent()
      })
    ]),
    el('div', { class: 'mini-sheet__body', testid: 'recent-sheet-body' })
  ]);
  recentSheet.hidden = true;
  const recentSheetBody = recentSheet.querySelector('.mini-sheet__body');

  const recentBackdrop = el('div', { class: 'mini-sheet__backdrop', onclick: () => closeRecent() });
  recentBackdrop.hidden = true;

  const scroller = el('div', { class: 'cash__scroll' }, [tilesSection, recentSection]);
  const main = el('main', { class: 'cash' }, [
    scroller, backdrop, sheet, orderBar, recentBackdrop, recentSheet
  ]);
  main.dataset.sheet = 'closed';
  outlet.appendChild(main);

  /* ---------------------------------------- hotfix H3: header and ☰ menu */

  const menuButton = el('button', {
    type: 'button',
    class: 'menu-btn',
    testid: 'menu-button',
    'aria-label': 'Menu',
    'aria-expanded': 'false',
    'aria-haspopup': 'true',
    onclick: () => { state.appMenu ? closeAppMenu() : openAppMenu(); }
  }, [svgNode(MENU_ICON)]);

  // The ☰ menu ends with the version line (H3 1). It borrows the header's own
  // version pill rather than printing a second one, so there is one version
  // label on the screen wherever it is standing.
  const menuBuild = el('span', { class: 'app-menu__build', text: '· build dev' });
  loadVersion().then((v) => { menuBuild.textContent = `· build ${v.build}`; });
  const menuVersion = el('div', { class: 'app-menu__version', testid: 'menu-version' }, [menuBuild]);

  const versionPill = ctx.headerVersion || null;
  const versionHome = versionPill
    ? { parent: versionPill.parentNode, next: versionPill.nextSibling }
    : null;

  function placeVersion(small) {
    if (!versionPill) return;
    if (small) {
      if (versionPill.parentNode !== menuVersion) menuVersion.insertBefore(versionPill, menuBuild);
    } else if (versionHome && versionHome.parent && versionPill.parentNode !== versionHome.parent) {
      versionHome.parent.insertBefore(versionPill, versionHome.next);
    }
  }

  const appMenu = el('nav', { class: 'app-menu', testid: 'app-menu', 'aria-label': 'App menu' }, [
    el('a', { class: 'app-menu__item', testid: 'menu-food', href: href('/kitchen'), text: 'Food counter', onclick: () => closeAppMenu() }),
    el('a', { class: 'app-menu__item', testid: 'menu-reports', href: href('/reports'), text: 'Reports', onclick: () => closeAppMenu() }),
    el('button', {
      type: 'button', class: 'app-menu__item', testid: 'menu-recent', text: 'Recent orders',
      onclick: () => { closeAppMenu(); openRecent(); }
    }),
    el('button', {
      type: 'button', class: 'app-menu__item app-menu__item--danger', testid: 'menu-signout', text: 'Sign out',
      onclick: () => { closeAppMenu(); signOut(); }
    }),
    menuVersion
  ]);
  appMenu.hidden = true;

  if (ctx.headerRight) ctx.headerRight.appendChild(menuButton);
  document.body.appendChild(appMenu);

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

  /** The menu's short name for an id, falling back to the full name. */
  function shortOf(id, fallback) {
    const item = state.menu.find((m) => m.id === id);
    return (item && item.short) || fallback || id;
  }

  /** Cash received resets on Clear, on switching to Card, on send and on clearing the order. */
  function resetTender() {
    state.quick = null;
    state.other = '';
    state.otherOpen = false;
    otherInput.value = '';
  }

  function resetOrder() {
    state.cart = {};
    state.payment = 'card';
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

  /* ------------------------------- hotfix H3: sheet, ☰ menu, recent sheet */

  // The sheet pushes one history entry so the browser Back button closes it
  // (H3 4). `pushed` keeps that entry from being left behind when the sheet
  // closes any other way.
  let pushed = false;

  function openSheet() {
    if (state.sheet || !isSmall()) return;
    if (!currentItems().length) return;
    state.sheet = true;
    closeAppMenu();
    closeRecent();
    try {
      history.pushState({ nbaSheet: true }, '');
      pushed = true;
    } catch { pushed = false; }
    update();
    // Focus moves into the sheet (H3 4).
    sheet.focus({ preventScroll: true });
  }

  /** `fromPop`: the entry has already been popped by the browser. */
  function closeSheet({ fromPop = false, focusBar = true } = {}) {
    if (!state.sheet) return;
    state.sheet = false;
    if (pushed && !fromPop) {
      pushed = false;
      try { history.back(); } catch { /* nothing to go back to */ }
    } else {
      pushed = false;
    }
    update();
    if (focusBar && isSmall() && !orderBar.hidden) orderBarButton.focus({ preventScroll: true });
  }

  function openAppMenu() {
    if (state.appMenu) return;
    state.appMenu = true;
    appMenu.hidden = false;
    menuButton.setAttribute('aria-expanded', 'true');
  }

  function closeAppMenu() {
    if (!state.appMenu) return;
    state.appMenu = false;
    appMenu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
  }

  function openRecent() {
    state.recent = true;
    recentSheet.hidden = false;
    recentBackdrop.hidden = false;
    renderRecent();
    recentSheet.focus({ preventScroll: true });
  }

  function closeRecent() {
    if (!state.recent) return;
    state.recent = false;
    recentSheet.hidden = true;
    recentBackdrop.hidden = true;
    menuButton.focus({ preventScroll: true });
  }

  /** ☰ → Sign out. Same in-page confirm as the header button (Cash counter 8). */
  function signOut() {
    const done = () => {
      clearSession();
      location.hash = '#/login';
    };
    if (currentItems().length) openSignOutConfirm(done);
    else done();
  }

  /**
   * Nodes that sit in a different place on each layout. The toast belongs in
   * the order panel on tablet and above the order bar on the phone; the
   * recent strip belongs under the tiles on tablet and in its own sheet on
   * the phone. Moving the one node keeps a single set of test ids.
   */
  function placeChrome() {
    if (isSmall()) {
      if (toast.parentNode !== scroller) scroller.appendChild(toast);
      if (recentSection.parentNode !== recentSheetBody) recentSheetBody.appendChild(recentSection);
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
      sheet.setAttribute('aria-label', 'Review order');
      sheet.setAttribute('tabindex', '-1');
      sheet.setAttribute('data-testid', 'review-sheet');
      recentSheet.setAttribute('tabindex', '-1');
      placeVersion(true);
    } else {
      if (toast.parentNode !== panel) panel.insertBefore(toast, panel.firstChild);
      if (recentSection.parentNode !== scroller) scroller.appendChild(recentSection);
      sheet.removeAttribute('role');
      sheet.removeAttribute('aria-modal');
      sheet.removeAttribute('aria-label');
      sheet.removeAttribute('tabindex');
      sheet.removeAttribute('data-testid');
      placeVersion(false);
      // Tablet never shows the phone-only chrome; make sure nothing is stuck
      // open after a resize across 700px.
      if (state.sheet) { state.sheet = false; pushed = false; }
      closeAppMenu();
      if (state.recent) {
        state.recent = false;
        recentSheet.hidden = true;
        recentBackdrop.hidden = true;
      }
    }
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

    // Phone: the sheet closes with the order it sent (H3 5). Focus goes back
    // to the tiles, not the order bar, because the bar has just gone away.
    closeSheet({ focusBar: false });
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
      .map((m) => [m.id, m.name, m.short, m.price, m.colour].join('\u0001'))
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
        // The small screen shows the short name instead (hotfix H3 2); which
        // one is on screen is pure CSS, so a resize can never strand a tile.
        el('span', { class: 'tile__short', 'aria-hidden': 'true', text: item.short || item.name }),
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
        const nameEl = el('span', { class: 'line__name', text: line.name });
        const row = el('div', { class: 'line', testid: `line-${line.id}` }, [
          nameEl,
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
        node = { row, nameEl, qtyEl, amountEl };
        lineNodes.set(line.id, node);
      }
      // The narrow sheet uses the menu's short name, the tablet panel the
      // full one (design/CashCounterSmall.dc.html). The stepper aria-labels
      // keep the full name either way.
      setText(node.nameEl, isSmall() ? shortOf(line.id, line.name) : line.name);
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

    // An empty panel is a cleared order, however it emptied: Send, Clear order
    // or the last - stepper tap. The next one starts on Card with no cash
    // received (hotfix H4 1), on the tablet panel and in the phone sheet alike.
    if (empty) {
      state.payment = 'card';
      if (state.quick !== null || state.other !== '' || state.otherOpen) resetTender();
    }

    payCash.setAttribute('aria-pressed', state.payment === 'cash' ? 'true' : 'false');
    payCard.setAttribute('aria-pressed', state.payment === 'card' ? 'true' : 'false');

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

    // The Other amount box stays revealed while it holds something.
    const otherShown = state.otherOpen || state.other.trim() !== '';
    tenderBlock.dataset.other = otherShown ? 'open' : 'closed';
    otherToggle.setAttribute('aria-expanded', otherShown ? 'true' : 'false');

    syncPhone(items, total, empty);
    renderRecent();
  }

  /** Order bar, sheet header and the small-screen open/closed state (H3 3, 4). */
  function syncPhone(items, total, empty) {
    const count = items.reduce((n, line) => n + line.qty, 0);
    const countText = `${count} ${count === 1 ? 'item' : 'items'}`;

    // Removing the last item closes the sheet (H3 4). Done in place rather
    // than through closeSheet(), which would re-enter update().
    if (empty && state.sheet) {
      state.sheet = false;
      if (pushed) {
        pushed = false;
        try { history.back(); } catch { /* nothing to go back to */ }
      }
    }

    setText(barLabel, `${countText} · ${formatPence(total)}`);
    setText(sheetCount, `Order · ${countText}`);

    main.dataset.sheet = state.sheet ? 'open' : 'closed';
    main.dataset.cart = empty ? 'empty' : 'full';
    orderBar.hidden = empty || state.sheet;
    backdrop.hidden = !state.sheet;

    // With an empty cart there is no way to send on a small screen: the order
    // bar is gone and the sheet with it, so the Send button leaves the page
    // altogether rather than sitting there hidden (H3 3).
    if (isSmall() && empty) {
      if (sendButton.parentNode) sendButton.remove();
    } else if (!sendButton.parentNode) {
      panelFoot.insertBefore(sendButton, panelFoot.firstChild);
    }
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

  // The change line has a long form on tablet and a short one on phone, and
  // the toast and the recent strip live in different places at each size.
  const onBreakpoint = () => { placeChrome(); update(); };
  if (typeof phone.addEventListener === 'function') phone.addEventListener('change', onBreakpoint);

  // Escape closes the top-most layer: recent sheet, then ☰ menu, then sheet.
  function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    if (state.recent) { event.preventDefault(); closeRecent(); return; }
    if (state.appMenu) { event.preventDefault(); closeAppMenu(); menuButton.focus({ preventScroll: true }); return; }
    if (state.sheet) { event.preventDefault(); closeSheet(); }
  }

  // Outside tap closes the ☰ menu (H3 1).
  function onDocClick(event) {
    if (!state.appMenu) return;
    const target = event.target;
    if (appMenu.contains(target) || menuButton.contains(target)) return;
    closeAppMenu();
  }

  // The browser Back button closes the sheet instead of leaving the screen.
  function onPopState() {
    if (state.sheet) closeSheet({ fromPop: true });
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', onDocClick);
  window.addEventListener('popstate', onPopState);

  buildTiles();
  placeChrome();
  update();

  return () => {
    if (state.toastTimer) clearTimeout(state.toastTimer);
    if (typeof phone.removeEventListener === 'function') phone.removeEventListener('change', onBreakpoint);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('click', onDocClick);
    window.removeEventListener('popstate', onPopState);
    // Leaving the screen with the sheet open: drop the state, but leave the
    // history entry alone (the navigation that unmounted us owns it now).
    state.sheet = false;
    pushed = false;
    // Hand the version pill back to the header before the menu goes.
    placeVersion(false);
    menuButton.remove();
    appMenu.remove();
    if (stopGuard) stopGuard();
    stopMenu();
    stopOrders();
    stopTill();
  };
}
