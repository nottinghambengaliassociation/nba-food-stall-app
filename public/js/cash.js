// Cash counter: build an order, take payment, send it to the food counter.
// Phase V (v1.4.0) adds Open orders: today's unfinished orders from every
// till, with Edit and Cancel… on each. The Recent orders strip it replaces is
// gone from both layouts (CLAUDE.md Phase V 1).

import { el, clear, setText, svgNode } from './ui.js';
import { itemIcon } from './icons.js';
import {
  ACTIVE_MENU, QUICK_CASH, formatPence, orderTotal,
  parseAmountToPence, cashReceivedState,
  dayString, nextOrderNo,
  openOrders, canEditOrder, orderSummary, orderAmount, orderTimeMs, formatClock,
  statusLabel, paymentLabel, orderWasText, editHasChanges, editDelta, editPrompt,
  diffOrderItems, refundText, cancelReasonsFor, editToastText, cancelToastText,
  editBlockedMessage, cancelBlockedMessage,
  EDIT_READY_TITLE, EDIT_OFFLINE_NOTE, EDIT_EMPTY_MESSAGE
} from './logic.js';
import {
  watchMenu, watchOrders, createOrder, saveOrderEdit, cancelOrderWithReason,
  isReady, onConnection
} from './store.js';
import { clearSession, openSignOutConfirm } from './login.js';
import { href } from './router.js';
import { loadVersion } from './app-version.js';

const TOAST_MS = 4000;

const MENU_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>`;
const CHEVRON_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"></path></svg>`;

// Leaving edit mode any other way than Discard asks first, like the
// unsent-order confirm (CLAUDE.md Phase V 2).
const LEAVE_EDIT_CONFIRM = {
  title: 'Discard the changes to this order?',
  note: 'Nothing has been saved yet. The order stays exactly as the food counter has it.',
  confirmLabel: 'Discard changes'
};

export function mountCash(outlet, ctx) {
  const state = {
    menu: ACTIVE_MENU.slice(),
    cart: {},
    // Names and prices for cart ids the live menu no longer carries, so an
    // older order can still be edited line by line.
    lineInfo: {},
    // Hotfix H4: every new order starts on Card. Not remembered between orders.
    payment: 'card',
    // Cash received (optional): either a quick button ('exact' | pence) or
    // free text in the "Other amount" box. Never both.
    quick: null,
    other: '',
    orders: [],
    toastTimer: null,
    // Hotfix H3: small-screen chrome. The sheet and the ☰ menu only exist
    // below 700px; above it these stay false and the tablet panel is simply
    // always on screen.
    sheet: false,
    appMenu: false,
    // The phone sheet hides the Other amount box behind a link.
    otherOpen: false,
    // Phase V: Open orders drawer, edit mode and the cancel dialog.
    drawer: false,
    drawerQuery: '',
    edit: null,
    blocked: '',
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false
  };

  const phone = typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 699px)')
    : { matches: false, addEventListener: null };

  /** True while the H3 small-screen cash layout is the one on screen. */
  const isSmall = () => phone.matches === true;

  /** True while an existing order is loaded into the panel (Phase V 2). */
  const editing = () => state.edit !== null;

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
    maxlength: '40',
    oninput: () => update()
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

  /* --------------------------------------------- Phase V: edit mode bits */

  // The payment prompt: "Take £5.00 more", "Refund £5.00 on the card
  // machine", "No payment change" or "No changes yet" (CLAUDE.md Phase V 2).
  const deltaLine = el('p', {
    class: 'edit-delta',
    testid: 'edit-delta',
    role: 'status',
    'aria-live': 'polite',
    dataset: { tone: 'none' }
  });

  const saveButton = el('button', {
    type: 'button',
    class: 'save-btn',
    testid: 'save-changes',
    text: 'Save changes',
    disabled: true,
    onclick: saveEdit
  });

  const discardButton = el('button', {
    type: 'button',
    class: 'link-btn edit-discard',
    testid: 'discard-changes',
    text: 'Discard changes',
    onclick: () => { leaveEdit(); update(); }
  });

  // The order moved on while the panel was open: nothing was written.
  const blockedNote = el('p', {
    class: 'edit-blocked',
    testid: 'edit-blocked',
    role: 'alert'
  });
  blockedNote.hidden = true;

  const emptyEditRow = el('div', { class: 'edit-empty', testid: 'edit-empty' }, [
    el('span', { text: EDIT_EMPTY_MESSAGE }),
    el('button', {
      type: 'button',
      class: 'edit-empty__btn',
      testid: 'edit-empty-cancel',
      text: 'Cancel order…',
      onclick: () => { if (state.edit) openCancelDialog(state.edit.order); }
    })
  ]);
  emptyEditRow.hidden = true;

  const editTitle = el('span', { class: 'edit-banner__title', testid: 'edit-banner-title' });
  const editStatus = el('span', { class: 'status-pill', testid: 'edit-status' });
  const editWas = el('span', { class: 'edit-banner__was', testid: 'edit-banner-was' });
  const editBanner = el('div', { class: 'edit-banner', testid: 'edit-banner' }, [
    el('span', { class: 'edit-banner__head' }, [editTitle, editStatus]),
    editWas
  ]);
  editBanner.hidden = true;

  // Send and Clear ride together so the phone sheet can pin them to its
  // bottom edge. In edit mode it carries Save (and Discard on tablet).
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
    editBanner,
    toast,
    blockedNote,
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'customer-name', text: 'Name to call out' }),
      nameInput
    ]),
    linesBox,
    emptyEditRow,
    el('div', { class: 'total-row' }, [
      el('span', { class: 'total-row__label', text: 'Total' }),
      totalValue
    ]),
    el('div', { class: 'pay-group', role: 'group', 'aria-label': 'Payment method' }, [payCash, payCard]),
    tenderBlock,
    deltaLine,
    panelFoot
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
  const barCta = el('span', { class: 'order-bar__cta' }, [
    document.createTextNode('Review & send'),
    svgNode(CHEVRON_ICON)
  ]);
  const orderBarButton = el('button', {
    type: 'button',
    class: 'order-bar__btn',
    testid: 'order-bar-open',
    onclick: () => openSheet()
  }, [barLabel, barCta]);
  const orderBar = el('div', { class: 'order-bar', testid: 'order-bar' }, [orderBarButton]);
  orderBar.hidden = true;

  const scroller = el('div', { class: 'cash__scroll' }, [tilesSection]);
  const main = el('main', { class: 'cash' }, [scroller, backdrop, sheet, orderBar]);
  main.dataset.sheet = 'closed';
  outlet.appendChild(main);

  /* ------------------------------ Phase V: Open orders drawer and dialog */

  const drawerCount = el('span', { class: 'open-orders__badge', testid: 'open-orders-count', text: '0' });
  const openOrdersButton = el('button', {
    type: 'button',
    class: 'open-orders-btn',
    testid: 'open-orders',
    // No aria-label: the visible wording differs either side of 700px
    // ("Open orders" / "Orders"), so any single label would stop being a
    // superstring of what is on screen and fail WCAG 2.5.3 "Label in Name".
    // The spans and the count badge name the button between them.
    'aria-expanded': 'false',
    'aria-haspopup': 'dialog',
    onclick: () => { state.drawer ? closeDrawer() : openDrawer(); }
  }, [
    el('span', { class: 'open-orders-btn__long', text: 'Open orders' }),
    el('span', { class: 'open-orders-btn__short', text: 'Orders' }),
    drawerCount
  ]);

  const drawerTitle = el('h2', { class: 'drawer__title', text: 'Open orders · 0' });
  const drawerSearch = el('input', {
    type: 'search',
    id: 'open-orders-search',
    class: 'drawer__search',
    testid: 'open-orders-search',
    autocomplete: 'off',
    placeholder: 'Search order number or name',
    'aria-label': 'Search open orders',
    oninput: () => { state.drawerQuery = drawerSearch.value; renderDrawer(); }
  });
  const drawerOffline = el('p', {
    class: 'drawer__offline',
    testid: 'open-orders-offline',
    text: `${EDIT_OFFLINE_NOTE}. Edit and Cancel need the network; new orders still queue.`
  });
  drawerOffline.hidden = true;
  const drawerList = el('div', { class: 'drawer__list', testid: 'open-orders-list' });
  const drawerEmpty = el('p', {
    class: 'drawer__empty',
    testid: 'open-orders-empty',
    text: 'No open orders match.'
  });

  const drawerClose = el('button', {
    type: 'button',
    class: 'sheet__more',
    testid: 'open-orders-close',
    text: 'Close',
    onclick: () => closeDrawer()
  });

  const drawer = el('section', {
    class: 'drawer',
    testid: 'open-orders-drawer',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Open orders',
    tabindex: '-1'
  }, [
    el('div', { class: 'drawer__head' }, [
      el('div', { class: 'drawer__headrow' }, [drawerTitle, drawerClose]),
      drawerSearch,
      el('p', {
        class: 'drawer__note',
        text: 'Today, all tills, not yet collected. Edit while New or Preparing; Ready orders can only be cancelled.'
      }),
      drawerOffline
    ]),
    el('div', { class: 'drawer__body' }, [drawerList, drawerEmpty])
  ]);
  drawer.hidden = true;

  const drawerBackdrop = el('div', { class: 'drawer__backdrop', onclick: () => closeDrawer() });
  drawerBackdrop.hidden = true;

  main.append(drawerBackdrop, drawer);

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

  // The ☰ menu ends with "Next A-045" and the version line (H3 1, Phase V 1).
  // It borrows the header's own version pill and next-number node rather than
  // printing second copies, so there is one of each on the screen.
  const menuBuild = el('span', { class: 'app-menu__build', text: '· build dev' });
  loadVersion().then((v) => { menuBuild.textContent = `· build ${v.build}`; });
  const menuVersion = el('div', { class: 'app-menu__version', testid: 'menu-version' }, [menuBuild]);
  const menuNext = el('div', { class: 'app-menu__next', testid: 'menu-next' });

  const versionPill = ctx.headerVersion || null;
  const versionHome = versionPill
    ? { parent: versionPill.parentNode, next: versionPill.nextSibling }
    : null;
  const subNode = ctx.headerSub || null;
  const subHome = subNode
    ? { parent: subNode.parentNode, next: subNode.nextSibling }
    : null;

  /** Put a borrowed header node back where it was found. */
  function restore(node, home) {
    if (!node || !home || !home.parent) return;
    if (node.parentNode === home.parent) return;
    // The node it used to sit before may itself be on loan right now.
    const ref = home.next && home.next.parentNode === home.parent ? home.next : null;
    home.parent.insertBefore(node, ref);
  }

  function placeBorrowed(small) {
    if (small) {
      if (versionPill && versionPill.parentNode !== menuVersion) menuVersion.insertBefore(versionPill, menuBuild);
      if (subNode && subNode.parentNode !== menuNext) menuNext.appendChild(subNode);
      return;
    }
    // The next-order line goes back first: the version pill sits before it.
    restore(subNode, subHome);
    restore(versionPill, versionHome);
  }

  const appMenu = el('nav', { class: 'app-menu', testid: 'app-menu', 'aria-label': 'App menu' }, [
    el('a', { class: 'app-menu__item', testid: 'menu-food', href: href('/kitchen'), text: 'Food counter', onclick: () => closeAppMenu() }),
    el('a', { class: 'app-menu__item', testid: 'menu-reports', href: href('/reports'), text: 'Reports', onclick: () => closeAppMenu() }),
    el('button', {
      type: 'button', class: 'app-menu__item app-menu__item--danger', testid: 'menu-signout', text: 'Sign out',
      onclick: () => { closeAppMenu(); signOut(); }
    }),
    menuNext,
    menuVersion
  ]);
  appMenu.hidden = true;

  if (ctx.headerRight) ctx.headerRight.append(openOrdersButton, menuButton);
  document.body.appendChild(appMenu);

  /* -------------------------------------------------------------- state */

  function qtyOf(id) { return state.cart[id] || 0; }

  function setQty(id, qty) {
    if (qty <= 0) delete state.cart[id];
    else state.cart[id] = qty;
    update();
  }

  function currentItems() {
    const out = state.menu
      .filter((m) => qtyOf(m.id) > 0)
      .map((m) => ({ id: m.id, name: m.name, qty: qtyOf(m.id), price: m.price }));
    // An id the live menu no longer carries keeps the name and price the
    // order was written with, so an older order can still be edited.
    for (const id of Object.keys(state.cart)) {
      if (state.menu.some((m) => m.id === id)) continue;
      const info = state.lineInfo[id] || {};
      out.push({ id, name: info.name || id, qty: state.cart[id], price: Math.round(Number(info.price) || 0) });
    }
    return out;
  }

  /** The menu's short name for an id, falling back to the full name. */
  function shortOf(id, fallback) {
    const item = state.menu.find((m) => m.id === id);
    return (item && item.short) || (state.lineInfo[id] && state.lineInfo[id].short) || fallback || id;
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
    state.lineInfo = {};
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

  /* ------------------------------- hotfix H3: sheet, ☰ menu, Open orders */

  // The sheet pushes one history entry so the browser Back button closes it
  // (H3 4). `pushed` keeps that entry from being left behind when the sheet
  // closes any other way.
  let pushed = false;

  function openSheet() {
    if (state.sheet || !isSmall()) return;
    if (!currentItems().length && !editing()) return;
    state.sheet = true;
    closeAppMenu();
    closeDrawer();
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

  function openDrawer() {
    if (state.drawer) return;
    closeAppMenu();
    // The phone review sheet and the Open orders sheet are the same surface:
    // only one of them is ever up.
    if (state.sheet) closeSheet({ focusBar: false });
    state.drawer = true;
    drawer.hidden = false;
    drawerBackdrop.hidden = false;
    openOrdersButton.setAttribute('aria-expanded', 'true');
    renderDrawer();
    drawer.focus({ preventScroll: true });
  }

  function closeDrawer({ focusButton = true } = {}) {
    if (!state.drawer) return;
    state.drawer = false;
    drawer.hidden = true;
    drawerBackdrop.hidden = true;
    openOrdersButton.setAttribute('aria-expanded', 'false');
    if (focusButton) openOrdersButton.focus({ preventScroll: true });
  }

  /** ☰ → Sign out. Same in-page confirm as the header button (Cash counter 8). */
  function signOut() {
    const done = () => {
      clearSession();
      location.hash = '#/login';
    };
    const guard = unsentGuardAnswer();
    if (guard) openSignOutConfirm(done, guard === true ? {} : guard);
    else done();
  }

  /**
   * Nodes that sit in a different place on each layout. The toast belongs in
   * the order panel on tablet and above the order bar on the phone; the edit
   * banner is the top of the panel on tablet and a strip under the header on
   * the phone. Moving the one node keeps a single set of test ids.
   */
  function placeChrome() {
    if (isSmall()) {
      if (toast.parentNode !== scroller) scroller.appendChild(toast);
      if (editBanner.parentNode !== main) main.insertBefore(editBanner, scroller);
      if (blockedNote.parentNode !== scroller) scroller.insertBefore(blockedNote, scroller.firstChild);
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
      sheet.setAttribute('aria-label', 'Review order');
      sheet.setAttribute('tabindex', '-1');
      sheet.setAttribute('data-testid', 'review-sheet');
      placeBorrowed(true);
    } else {
      if (editBanner.parentNode !== panel) panel.insertBefore(editBanner, sheetHead.nextSibling);
      if (toast.parentNode !== panel) panel.insertBefore(toast, editBanner.nextSibling);
      if (blockedNote.parentNode !== panel) panel.insertBefore(blockedNote, toast.nextSibling);
      sheet.removeAttribute('role');
      sheet.removeAttribute('aria-modal');
      sheet.removeAttribute('aria-label');
      sheet.removeAttribute('tabindex');
      sheet.removeAttribute('data-testid');
      placeBorrowed(false);
      // Tablet never shows the phone-only chrome; make sure nothing is stuck
      // open after a resize across 700px.
      if (state.sheet) { state.sheet = false; pushed = false; }
      closeAppMenu();
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
    if (editing()) return;
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

  /* ------------------------------------------------- Phase V: edit mode */

  /** Load an open order into the panel (CLAUDE.md Phase V 2). */
  function startEdit(order) {
    const apply = () => {
      state.edit = {
        id: order.id,
        orderNo: order.orderNo,
        order,
        before: {
          items: Array.isArray(order.items) ? order.items : [],
          total: orderAmount(order),
          name: order.name || 'Guest',
          payment: order.payment === 'card' ? 'card' : 'cash'
        }
      };
      state.cart = {};
      state.lineInfo = {};
      for (const line of (Array.isArray(order.items) ? order.items : [])) {
        const qty = Math.round(Number(line && line.qty) || 0);
        if (!line || !line.id || qty <= 0) continue;
        state.cart[line.id] = (state.cart[line.id] || 0) + qty;
        state.lineInfo[line.id] = { name: line.name || line.id, price: Math.round(Number(line.price) || 0) };
      }
      state.payment = order.payment === 'card' ? 'card' : 'cash';
      nameInput.value = order.name === 'Guest' ? '' : (order.name || '');
      resetTender();
      state.blocked = '';
      setText(toast, '');
      closeDrawer({ focusButton: false });
      update();
      // Phone: the sheet is where the changes are made (design/CashOpenOrdersSmall).
      if (isSmall()) openSheet();
      else nameInput.focus({ preventScroll: true });
    };

    // Starting Edit on another order loses the changes in the panel, so ask.
    if (editing() && state.edit.id !== order.id) {
      openSignOutConfirm(apply, LEAVE_EDIT_CONFIRM);
      return;
    }
    apply();
  }

  /** Leave edit mode with nothing written and the panel back to a new order. */
  function leaveEdit() {
    state.edit = null;
    state.blocked = '';
    resetOrder();
    if (state.sheet) closeSheet({ focusBar: false });
  }

  /** The original order as it stood when Edit was tapped. */
  function editBefore() {
    return state.edit ? state.edit.before : null;
  }

  function editState() {
    const items = currentItems();
    const total = orderTotal(items);
    const before = editBefore();
    if (!before) return { changed: false, delta: 0, prompt: editPrompt({}), total, items };
    const after = { items, total, name: nameInput.value.trim() || 'Guest', payment: state.payment };
    const beforeForCompare = { ...before, name: before.name || 'Guest' };
    const changed = editHasChanges(beforeForCompare, after);
    const delta = editDelta(before.total, total);
    return {
      changed,
      delta,
      prompt: editPrompt({ changed, delta, payment: state.payment }),
      total,
      items
    };
  }

  let saving = false;

  async function saveEdit() {
    if (!editing() || saving) return;
    const { changed, delta, items, total } = editState();
    if (!changed || !items.length) return;
    const target = state.edit;
    // The payment as it is being saved: leaveEdit() resets the panel to Card
    // before the toast is built (hotfix H4), so capture it first.
    const payment = state.payment === 'card' ? 'card' : 'cash';
    saving = true;
    saveButton.disabled = true;
    try {
      const res = await saveOrderEdit({
        id: target.id,
        items,
        total,
        name: nameInput.value.trim() || 'Guest',
        payment,
        till: ctx.settings.till
      });
      if (res && res.ok === false) {
        // Nothing written: the food counter moved it on first (Phase V 2).
        state.blocked = res.reason === 'missing'
          ? `${target.orderNo} is no longer on today's board.`
          : editBlockedMessage(target.orderNo, res.status);
        update();
        return;
      }
      leaveEdit();
      showToast(editToastText(target.orderNo, delta, payment));
      update();
    } catch (err) {
      console.error('save failed', err);
      state.blocked = `${target.orderNo} could not be saved. ${EDIT_OFFLINE_NOTE}.`;
      update();
    } finally {
      saving = false;
    }
  }

  /* ----------------------------------------------- Phase V: cancel order */

  let closeDialog = null;

  function openCancelDialog(order) {
    if (closeDialog) closeDialog();
    const previous = document.activeElement;
    const status = order.status || 'new';
    const total = orderAmount(order);
    const payment = order.payment === 'card' ? 'card' : 'cash';
    let reason = null;

    const confirmButton = el('button', {
      type: 'button',
      class: 'modal__btn modal__btn--danger',
      testid: 'cancel-confirm',
      text: 'Cancel order',
      disabled: true,
      onclick: () => { if (reason) doCancel(order, reason, close); }
    });

    const reasonButtons = cancelReasonsFor(status).map((r) => el('button', {
      type: 'button',
      class: 'reason-btn',
      role: 'radio',
      testid: `cancel-reason-${r.key}`,
      text: r.label,
      'aria-checked': 'false',
      onclick: () => {
        reason = r.key;
        for (const b of reasonButtons) {
          b.setAttribute('aria-checked', b.getAttribute('data-testid') === `cancel-reason-${reason}` ? 'true' : 'false');
        }
        confirmButton.disabled = false;
      }
    }));

    const started = status === 'preparing' || status === 'ready';

    const card = el('div', {
      class: 'modal__card cancel-card',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-labelledby': 'cancel-dialog-title'
    }, [
      el('h2', {
        id: 'cancel-dialog-title',
        class: 'modal__title',
        testid: 'cancel-dialog-title',
        text: `Cancel ${order.orderNo} for ${order.name || 'Guest'}?`
      }),
      el('p', {
        class: 'modal__note',
        testid: 'cancel-dialog-items',
        text: `${orderSummary(order)} · ${formatPence(total)} · ${statusLabel(status)}`
      }),
      started
        ? el('p', {
          class: 'cancel-card__warn',
          testid: 'cancel-dialog-started',
          text: "The food counter has already started this. They'll see a red Stop making card."
        })
        : null,
      el('div', { class: 'cancel-card__reasons' }, [
        el('span', { class: 'field-label', text: 'Reason' }),
        el('div', {
          class: 'reason-row',
          role: 'radiogroup',
          'aria-label': 'Reason',
          testid: 'cancel-reasons'
        }, reasonButtons)
      ]),
      el('p', {
        class: 'cancel-card__refund',
        testid: 'cancel-refund',
        text: refundText(total, payment)
      }),
      el('div', { class: 'modal__row' }, [
        el('button', {
          type: 'button',
          class: 'modal__btn modal__btn--ghost',
          testid: 'cancel-keep',
          text: 'Keep order',
          onclick: () => close()
        }),
        confirmButton
      ])
    ]);

    const backdropNode = el('div', { class: 'modal', testid: 'cancel-dialog' }, [card]);

    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    }

    function close() {
      document.removeEventListener('keydown', onKey, true);
      backdropNode.remove();
      closeDialog = null;
      if (previous && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
    }

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdropNode);
    reasonButtons[0].focus({ preventScroll: true });
    closeDialog = close;
  }

  async function doCancel(order, reason, close) {
    const payment = order.payment === 'card' ? 'card' : 'cash';
    const total = orderAmount(order);
    try {
      const res = await cancelOrderWithReason({ id: order.id, reason, till: ctx.settings.till });
      close();
      if (res && res.ok === false) {
        state.blocked = res.reason === 'missing'
          ? `${order.orderNo} is no longer on today's board.`
          : cancelBlockedMessage(order.orderNo, res.status);
        update();
        return;
      }
      if (state.edit && state.edit.id === order.id) leaveEdit();
      closeDrawer({ focusButton: false });
      showToast(cancelToastText(order.orderNo, total, payment));
      update();
    } catch (err) {
      console.error('cancel failed', err);
      close();
      state.blocked = `${order.orderNo} could not be cancelled. ${EDIT_OFFLINE_NOTE}.`;
      update();
    }
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
      .map((m) => [m.id, m.name, m.short, m.price, m.colour].join(''))
      .join('');
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
  const removedBox = el('div', { class: 'lines__removed', testid: 'order-removed-lines' });

  function renderLines() {
    const items = currentItems();
    const wanted = new Set(items.map((i) => i.id));
    const before = editBefore();
    const diff = before ? diffOrderItems(before.items, items) : null;

    for (const [id, node] of lineNodes) {
      if (!wanted.has(id)) {
        node.row.remove();
        lineNodes.delete(id);
      }
    }

    if (!items.length) {
      // In edit mode the empty panel offers Cancel instead (Phase V 2).
      if (!editing() && emptyLines.parentNode !== linesBox) linesBox.appendChild(emptyLines);
      if (editing() && emptyLines.parentNode === linesBox) linesBox.removeChild(emptyLines);
    } else if (emptyLines.parentNode === linesBox) {
      linesBox.removeChild(emptyLines);
    }

    items.forEach((line, index) => {
      let node = lineNodes.get(line.id);
      if (!node) {
        const qtyEl = el('span', { class: 'line__qty', testid: `line-qty-${line.id}`, text: String(line.qty) });
        const amountEl = el('span', { class: 'line__amount' });
        const changeEl = el('span', { class: 'line__change', testid: `line-change-${line.id}` });
        const nameEl = el('span', { class: 'line__name' }, [
          el('span', { class: 'line__label', text: line.name }),
          changeEl
        ]);
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
        node = { row, nameEl, labelEl: nameEl.firstChild, changeEl, qtyEl, amountEl };
        lineNodes.set(line.id, node);
      }
      // The narrow sheet uses the menu's short name, the tablet panel the
      // full one (design/CashCounterSmall.dc.html). The stepper aria-labels
      // keep the full name either way.
      setText(node.labelEl, isSmall() ? shortOf(line.id, line.name) : line.name);
      setText(node.qtyEl, String(line.qty));
      setText(node.amountEl, formatPence(line.qty * line.price));
      const changeRow = diff ? diff.rows.find((r) => r.id === line.id) : null;
      const changeText = changeRow ? changeRow.text : '';
      setText(node.changeEl, changeText);
      node.changeEl.hidden = !changeText;
      if (linesBox.children[index] !== node.row) linesBox.appendChild(node.row);
    });

    // Lines taken off the order show struck through with "removed" (Phase V 2).
    clear(removedBox);
    const removed = diff ? diff.removed : [];
    removedBox.hidden = removed.length === 0;
    linesBox.appendChild(removedBox);
    for (const row of removed) {
      removedBox.appendChild(el('div', {
        class: 'line-removed',
        testid: `line-removed-${row.id}`
      }, [
        el('s', { text: `${row.qty}× ${isSmall() ? shortOf(row.id, row.name) : row.name}` }),
        el('b', { text: 'removed' })
      ]));
    }
  }

  /* --------------------------------------- Phase V: Open orders drawer */

  function openList() {
    return openOrders(state.orders, state.drawerQuery);
  }

  function renderDrawerCount() {
    const count = state.orders.filter((o) => ['new', 'preparing', 'ready'].includes(o.status)).length;
    setText(drawerCount, String(count));
    setText(drawerTitle, `Open orders · ${count}`);
  }

  function renderDrawer() {
    renderDrawerCount();
    if (!state.drawer) return;
    const rows = openList();
    const offline = !state.online;
    drawerOffline.hidden = !offline;
    clear(drawerList);
    drawerEmpty.hidden = rows.length > 0;
    for (const order of rows) {
      const no = order.orderNo || '';
      const status = order.status || 'new';
      const allowEdit = canEditOrder(order) && !offline;
      const meta = `${formatClock(orderTimeMs(order))} · till ${order.till || 'A'} · `
        + `${paymentLabel(order.payment)} · ${formatPence(orderAmount(order))}`;
      drawerList.appendChild(el('article', {
        class: 'open-order',
        testid: `open-order-${no}`,
        dataset: { status }
      }, [
        el('div', { class: 'open-order__top' }, [
          el('span', { class: 'open-order__no', text: no }),
          el('span', { class: 'open-order__name', text: order.name || 'Guest' }),
          el('span', { class: `status-pill status-pill--${status}`, text: statusLabel(status) })
        ]),
        el('span', { class: 'open-order__items', text: orderSummary(order) }),
        el('span', { class: 'open-order__meta', text: meta }),
        el('div', { class: 'open-order__actions' }, [
          el('button', {
            type: 'button',
            class: 'open-order__edit',
            testid: `edit-${no}`,
            text: 'Edit',
            disabled: !allowEdit,
            title: canEditOrder(order) ? (offline ? EDIT_OFFLINE_NOTE : `Edit ${no}`) : EDIT_READY_TITLE,
            'aria-label': `Edit order ${no}`,
            onclick: () => startEdit(order)
          }),
          el('button', {
            type: 'button',
            class: 'open-order__cancel',
            testid: `cancel-${no}`,
            text: 'Cancel…',
            disabled: offline,
            title: offline ? EDIT_OFFLINE_NOTE : `Cancel ${no}`,
            'aria-label': `Cancel order ${no}`,
            onclick: () => openCancelDialog(order)
          })
        ])
      ]));
    }
  }

  /* -------------------------------------------------------------- update */

  function update() {
    const items = currentItems();
    const total = orderTotal(items);
    const empty = items.length === 0;
    const inEdit = editing();

    syncTiles();
    renderLines();

    setText(totalValue, formatPence(total));

    // An empty panel is a cleared order, however it emptied: Send, Clear order
    // or the last − stepper tap. The next one starts on Card with no cash
    // received (hotfix H4 1). In edit mode the order keeps its own payment.
    if (empty && !inEdit) {
      state.payment = 'card';
      if (state.quick !== null || state.other !== '' || state.otherOpen) resetTender();
    }

    payCash.setAttribute('aria-pressed', state.payment === 'cash' ? 'true' : 'false');
    payCard.setAttribute('aria-pressed', state.payment === 'card' ? 'true' : 'false');

    // Cash received is hidden in edit mode (CLAUDE.md Phase V 2).
    tenderBlock.hidden = inEdit || state.payment !== 'cash' || empty;
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

    syncEdit(items, total, empty, inEdit);
    syncFoot(empty, inEdit);
    syncPhone(items, total, empty, inEdit);
    renderDrawer();

    blockedNote.hidden = !state.blocked;
    setText(blockedNote, state.blocked);
  }

  /** The amber banner, the payment prompt and the Save button (Phase V 2). */
  function syncEdit(items, total, empty, inEdit) {
    panel.dataset.mode = inEdit ? 'edit' : 'new';
    main.dataset.mode = inEdit ? 'edit' : 'new';
    editBanner.hidden = !inEdit;
    emptyEditRow.hidden = !(inEdit && empty);
    deltaLine.hidden = !inEdit;
    panel.setAttribute('aria-label', inEdit ? `Editing order ${state.edit.orderNo}` : 'Current order');

    if (!inEdit) {
      saveButton.disabled = true;
      setText(saveButton, 'Save changes');
      return;
    }

    const order = state.edit.order;
    const status = order.status || 'new';
    setText(editTitle, `Editing ${state.edit.orderNo} · ${state.edit.before.name}`);
    editStatus.className = `status-pill status-pill--${status}`;
    setText(editStatus, statusLabel(status));
    setText(editWas, `Was ${orderWasText({ ...order, items: state.edit.before.items, total: state.edit.before.total, payment: state.edit.before.payment })}`);

    const { changed, prompt } = editState();
    setText(deltaLine, prompt.text);
    deltaLine.dataset.tone = prompt.tone;

    const blockedSave = !changed || empty || !state.online;
    saveButton.disabled = blockedSave;
    setText(saveButton, `Save changes · ${formatPence(total)}`);
    saveButton.title = state.online ? '' : EDIT_OFFLINE_NOTE;
  }

  /** Send + Clear for a new order, Save (+ Discard on tablet) while editing. */
  function syncFoot(empty, inEdit) {
    const small = isSmall();
    const wanted = inEdit
      ? (small ? [saveButton] : [saveButton, discardButton])
      // With an empty cart there is no way to send on a small screen: the
      // order bar is gone and the sheet with it, so the Send button leaves
      // the page altogether rather than sitting there hidden (H3 3).
      : ((small && empty) ? [clearButton] : [sendButton, clearButton]);

    for (const node of [sendButton, clearButton, saveButton, discardButton]) {
      if (!wanted.includes(node) && node.parentNode === panelFoot) node.remove();
    }
    wanted.forEach((node, i) => {
      if (panelFoot.children[i] !== node) panelFoot.appendChild(node);
    });

    // Phone: Discard lives in the amber strip under the header.
    if (inEdit && small) {
      if (discardButton.parentNode !== editBanner) editBanner.appendChild(discardButton);
      setText(discardButton, 'Discard');
    } else if (!inEdit || !small) {
      if (discardButton.parentNode === editBanner) editBanner.removeChild(discardButton);
      setText(discardButton, 'Discard changes');
    }

    if (!inEdit) {
      const total = orderTotal(currentItems());
      sendButton.disabled = empty;
      setText(sendButton, empty ? 'Send to food counter' : `Send to food counter · ${formatPence(total)}`);
    }
  }

  /** Order bar, sheet header and the small-screen open/closed state (H3 3, 4). */
  function syncPhone(items, total, empty, inEdit) {
    const count = items.reduce((n, line) => n + line.qty, 0);
    const countText = `${count} ${count === 1 ? 'item' : 'items'}`;

    // Removing the last item closes the sheet (H3 4). In edit mode it stays
    // open so the "Cancel the order instead?" offer is on screen. Done in
    // place rather than through closeSheet(), which would re-enter update().
    if (empty && state.sheet && !inEdit) {
      state.sheet = false;
      if (pushed) {
        pushed = false;
        try { history.back(); } catch { /* nothing to go back to */ }
      }
    }

    setText(barLabel, `${countText} · ${formatPence(total)}`);
    setText(sheetCount, inEdit ? `Edit ${state.edit.orderNo}` : `Order · ${countText}`);
    setText(barCta.firstChild, inEdit ? 'Review changes' : 'Review & send');
    orderBar.dataset.mode = inEdit ? 'edit' : 'new';

    main.dataset.sheet = state.sheet ? 'open' : 'closed';
    main.dataset.cart = empty ? 'empty' : 'full';
    orderBar.hidden = (empty && !inEdit) || state.sheet;
    backdrop.hidden = !state.sheet;
  }

  /* ---------------------------------------------------------- listeners */

  const stopMenu = watchMenu((items) => {
    state.menu = items;
    buildTiles();
    update();
  });

  const stopOrders = watchOrders(dayString(), (orders) => {
    state.orders = orders;
    // Keep the edit banner's status pill honest while the panel is open.
    if (state.edit) {
      const live = orders.find((o) => o.id === state.edit.id);
      if (live) state.edit.order = live;
    }
    update();
  });

  const stopConnection = onConnection((conn) => {
    state.online = conn.online !== false;
    update();
  });

  const stopTill = ctx.onTillChange(() => renderDrawer());

  /** What Sign out should ask before it drops this screen's work. */
  function unsentGuardAnswer() {
    if (editing()) return LEAVE_EDIT_CONFIRM;
    return currentItems().length > 0;
  }

  // Sign out asks first while the panel holds an unsent order or an edit.
  const stopGuard = typeof ctx.setUnsentGuard === 'function'
    ? ctx.setUnsentGuard(unsentGuardAnswer)
    : null;

  // The change line has a long form on tablet and a short one on phone, and
  // the toast and the edit banner live in different places at each size.
  const onBreakpoint = () => { placeChrome(); update(); };
  if (typeof phone.addEventListener === 'function') phone.addEventListener('change', onBreakpoint);

  // Escape closes the top-most layer: the Open orders drawer, then the ☰
  // menu, then the review sheet. The cancel dialog has its own handler.
  function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    if (state.drawer) { event.preventDefault(); closeDrawer(); return; }
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

  /**
   * Navigating away in edit mode asks first, like the unsent-order confirm
   * (CLAUDE.md Phase V 2). Hash links are the only way off this screen that
   * the page itself controls.
   */
  function onNavClick(event) {
    if (!editing()) return;
    const link = event.target && event.target.closest ? event.target.closest('a[href^="#/"]') : null;
    if (!link) return;
    const target = link.getAttribute('href');
    if (!target || target === location.hash) return;
    event.preventDefault();
    event.stopPropagation();
    openSignOutConfirm(() => {
      leaveEdit();
      location.hash = target;
    }, LEAVE_EDIT_CONFIRM);
  }

  // The browser Back button closes the sheet instead of leaving the screen.
  function onPopState() {
    if (state.sheet) closeSheet({ fromPop: true });
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', onDocClick);
  document.addEventListener('click', onNavClick, true);
  window.addEventListener('popstate', onPopState);

  buildTiles();
  placeChrome();
  update();

  return () => {
    if (state.toastTimer) clearTimeout(state.toastTimer);
    if (closeDialog) closeDialog();
    if (typeof phone.removeEventListener === 'function') phone.removeEventListener('change', onBreakpoint);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('click', onNavClick, true);
    window.removeEventListener('popstate', onPopState);
    // Leaving the screen with the sheet open: drop the state, but leave the
    // history entry alone (the navigation that unmounted us owns it now).
    state.sheet = false;
    pushed = false;
    // Hand the version pill and the next-order line back to the header.
    placeBorrowed(false);
    menuButton.remove();
    openOrdersButton.remove();
    appMenu.remove();
    if (stopGuard) stopGuard();
    stopMenu();
    stopOrders();
    stopConnection();
    stopTill();
  };
}
