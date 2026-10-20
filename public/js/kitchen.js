// Food counter: live board of today's orders, New -> Preparing -> Ready -> Collected.

import { el, clear, setText, svgNode } from './ui.js';
import { itemIcon } from './icons.js';
import {
  STATIONS, STATUS_FLOW, PREV_STATUS, LATE_AFTER_MIN,
  dayString, ageMinutes, formatAge, stationOf, inStation,
  kitchenCardState, kitchenColumnOf, kitchenChangeNote, kitchenCancelNote,
  lastChangeBefore, lineDeltaTag, lineFullName
} from './logic.js';
import {
  watchOrders, setOrderStatus, revertOrderStatus, markChangeSeen, clearKitchenCard
} from './store.js';

const COLUMNS = [
  { key: 'new', label: 'New', heading: 'New', action: 'Start', actionKey: 'start' },
  { key: 'preparing', label: 'Preparing', heading: 'Preparing', action: 'Ready', actionKey: 'ready' },
  { key: 'ready', label: 'Ready', heading: 'Ready, call out', action: 'Collected', actionKey: 'collected' }
];

export function mountKitchen(outlet, ctx) {
  const state = {
    orders: [],
    station: 'all',
    tab: 'new',
    undoStack: [],
    beep: ctx.settings.beep,
    seenNew: new Set(),
    // Phase V: "<id>:<editedAtMs>" / "<id>:cancelled" already announced.
    seenChanges: new Set(),
    firstSnapshot: true
  };

  let audioCtx = null;
  let wakeLock = null;
  const ageNodes = [];

  /* ------------------------------------------------------- header extras */

  const stationButtons = STATIONS.map((st) => el('button', {
    type: 'button',
    class: 'ghost-btn',
    testid: `station-${st.key}`,
    text: st.label,
    'aria-pressed': st.key === state.station ? 'true' : 'false',
    onclick: () => {
      state.station = st.key;
      stationButtons.forEach((b, i) => b.setAttribute('aria-pressed', STATIONS[i].key === st.key ? 'true' : 'false'));
      render();
    }
  }));

  ctx.headerLeft.appendChild(
    el('div', { class: 'header__right header__slot--stations', role: 'group', 'aria-label': 'Station' }, stationButtons)
  );

  const undoButton = el('button', {
    type: 'button',
    class: 'ghost-btn',
    testid: 'undo',
    'aria-label': 'Undo last tap',
    disabled: true,
    onclick: undoLast
  }, [
    el('span', { class: 'undo-long', text: 'Undo last tap' }),
    el('span', { class: 'undo-short', text: 'Undo' })
  ]);

  const beepButton = el('button', {
    type: 'button',
    class: 'ghost-btn',
    testid: 'beep-toggle',
    text: 'Beep',
    'aria-pressed': state.beep ? 'true' : 'false',
    onclick: () => {
      state.beep = !state.beep;
      ctx.settings.beep = state.beep;
      beepButton.setAttribute('aria-pressed', state.beep ? 'true' : 'false');
      if (state.beep) playBeep();
    }
  });

  const collectedCount = el('span', { class: 'header__sub collected-count', testid: 'collected-count', text: '0 collected today' });

  ctx.headerRight.append(collectedCount, undoButton, beepButton);

  /* -------------------------------------------------------------- layout */

  const tabButtons = COLUMNS.map((col) => {
    const count = el('span', { class: 'tab__count', text: '0' });
    // Phase V: a dot marks a tab holding a change or cancel nobody has seen.
    const dot = el('span', { class: 'tab__dot', testid: `tab-dot-${col.key}`, 'aria-hidden': 'true' });
    dot.hidden = true;
    const button = el('button', {
      type: 'button',
      class: 'tab',
      role: 'tab',
      id: `tab-${col.key}`,
      testid: `tab-${col.key}`,
      'aria-selected': col.key === state.tab ? 'true' : 'false',
      'aria-controls': `col-${col.key}`,
      dataset: { col: col.key },
      onclick: () => {
        state.tab = col.key;
        render();
      }
    }, [count, el('span', { class: 'tab__label', text: col.label }), dot]);
    return { col, button, count, dot };
  });

  const tabs = el('div', {
    class: 'tabs',
    role: 'tablist',
    'aria-label': 'Order status'
  }, tabButtons.map((t) => t.button));

  const columns = COLUMNS.map((col) => {
    const count = el('span', { class: 'column__count', text: '0' });
    const body = el('div', { class: 'column__body' });
    const section = el('section', {
      class: `column column--${col.key}`,
      id: `col-${col.key}`,
      testid: `col-${col.key}`,
      'aria-label': col.heading,
      dataset: { active: col.key === state.tab ? 'true' : 'false' }
    }, [
      el('h2', { class: 'column__head' }, [document.createTextNode(col.heading), count]),
      body
    ]);
    return { col, section, body, count };
  });

  const main = el('main', { class: 'kitchen' }, [
    tabs,
    el('div', { class: 'columns' }, columns.map((c) => c.section))
  ]);
  outlet.appendChild(main);

  /* ------------------------------------------------------------- actions */

  function advance(order) {
    const next = STATUS_FLOW[order.status];
    if (!next) return;
    state.undoStack.push({ id: order.id, from: order.status, to: next });
    undoButton.disabled = false;
    setOrderStatus(order.id, next).catch((err) => console.error('status update failed', err));
  }

  function undoLast() {
    const last = state.undoStack.pop();
    undoButton.disabled = state.undoStack.length === 0;
    if (!last) return;
    const previous = last.from || PREV_STATUS[last.to] || 'new';
    revertOrderStatus(last.id, previous).catch((err) => console.error('undo failed', err));
  }

  /* ---------------------------------------------------------------- beep */

  function playBeep() {
    if (!state.beep) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.2);
    } catch (err) {
      console.warn('beep unavailable', err);
    }
  }

  /* ----------------------------------------------------------- wake lock */

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // not supported, or denied because the page is hidden: not fatal
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
  }

  requestWakeLock();
  document.addEventListener('visibilitychange', onVisibility);

  /* -------------------------------------------------------------- render */

  function orderMatchesStation(order) {
    if (state.station === 'all') return true;
    return (order.items || []).some((line) => inStation(line.id, state.station));
  }

  function card(order, col) {
    // Phase V: the cash counter may have changed or cancelled this order.
    // The food counter never edits or cancels; it only sees and acknowledges.
    const change = kitchenCardState(order);
    const cancelled = change === 'cancelled';
    const changed = change === 'changed';

    const minutes = ageMinutes(order.createdAtMs);
    const late = minutes >= LATE_AFTER_MIN && col.key !== 'ready';
    const age = el('span', {
      class: 'order-card__age',
      dataset: { late: late ? 'true' : 'false' },
      text: formatAge(minutes)
    });
    ageNodes.push({ node: age, order, col });

    const before = changed ? lastChangeBefore(order) : null;
    const items = Array.isArray(order.items) ? order.items : [];
    const rows = [];
    for (const line of items) {
      const was = before ? (before.filter((b) => b && b.id === line.id)
        .reduce((n, b) => n + (Math.round(Number(b.qty) || 0)), 0)) : null;
      rows.push({ id: line.id, name: line.name, qty: line.qty, tag: before ? lineDeltaTag(was, line.qty) : '' });
    }
    if (before) {
      for (const b of before) {
        if (!b || !b.id) continue;
        if (items.some((l) => l && l.id === b.id)) continue;
        rows.push({ id: b.id, name: lineFullName(b), qty: b.qty, tag: 'REMOVED', gone: true });
      }
    }

    const lineNodes = rows.map((row) => el('div', {
      class: 'order-line',
      testid: `order-line-${order.orderNo}-${row.id}`,
      dataset: {
        off: inStation(row.id, state.station) ? 'false' : 'true',
        station: stationOf(row.id) || 'other',
        gone: row.gone || cancelled ? 'true' : 'false'
      }
    }, [
      svgNode(itemIcon(row.id, 28)),
      el('b', { text: `${row.qty}×` }),
      el('span', { text: row.name }),
      row.tag
        ? el('span', {
          class: 'line-tag',
          testid: `line-tag-${order.orderNo}-${row.id}`,
          dataset: { tag: row.tag === 'NEW' ? 'new' : (row.tag === 'REMOVED' ? 'removed' : (row.tag.startsWith('+') ? 'up' : 'down')) },
          text: row.tag
        })
        : null
    ]));

    const children = [];

    if (cancelled) {
      children.push(el('div', {
        class: 'order-card__banner order-card__banner--cancel',
        testid: `cancelled-banner-${order.orderNo}`,
        role: 'alert',
        text: 'CANCELLED · STOP MAKING'
      }));
    } else if (changed) {
      children.push(el('div', {
        class: 'order-card__banner order-card__banner--change',
        testid: `changed-banner-${order.orderNo}`,
        role: 'alert',
        text: 'ORDER CHANGED · CHECK ITEMS'
      }));
    }

    children.push(el('div', { class: 'order-card__top' }, [
      el('span', { class: 'order-card__no', text: order.orderNo }),
      el('span', { class: 'order-card__tags' }, [
        // A New order that was edited keeps a quiet tag until Start (Phase V 4).
        change === 'tagged'
          ? el('span', { class: 'changed-tag', testid: `changed-tag-${order.orderNo}`, text: 'Changed' })
          : null,
        age
      ])
    ]));

    children.push(col.key === 'ready' && !cancelled
      ? el('p', { class: 'order-card__call', testid: `call-${order.orderNo}`, text: String(order.name || '').toUpperCase() })
      : el('p', { class: 'order-card__name', text: order.name }));

    children.push(el('div', { class: 'order-card__lines' }, lineNodes));

    if (cancelled) {
      children.push(el('p', {
        class: 'order-card__note order-card__note--cancel',
        testid: `cancel-note-${order.orderNo}`,
        text: kitchenCancelNote(order)
      }));
      children.push(el('button', {
        type: 'button',
        class: 'action-btn action-btn--remove',
        testid: `remove-${order.orderNo}`,
        text: 'Remove',
        'aria-label': `Remove cancelled order ${order.orderNo}`,
        onclick: () => {
          clearKitchenCard(order.id).catch((err) => console.error('remove failed', err));
        }
      }));
    } else if (changed) {
      children.push(el('p', {
        class: 'order-card__note order-card__note--change',
        testid: `change-note-${order.orderNo}`,
        text: `${kitchenChangeNote(order)} Ready unlocks after Got it.`
      }));
      children.push(el('button', {
        type: 'button',
        class: 'action-btn action-btn--gotit',
        testid: `got-it-${order.orderNo}`,
        text: 'Got it',
        'aria-label': `Got it, order ${order.orderNo} changed`,
        onclick: () => {
          markChangeSeen(order.id).catch((err) => console.error('got it failed', err));
        }
      }));
    } else {
      children.push(el('button', {
        type: 'button',
        class: 'action-btn',
        testid: `action-${order.orderNo}`,
        dataset: { action: col.actionKey },
        text: col.action,
        'aria-label': `${col.action} order ${order.orderNo}`,
        onclick: () => advance(order)
      }));
    }

    return el('article', {
      class: 'order-card' + (col.key === 'ready' && !cancelled && !changed ? ' order-card--ready' : ''),
      testid: `order-card-${order.orderNo}`,
      dataset: { change },
      'aria-label': `Order ${order.orderNo} for ${order.name}`
    }, children);
  }

  function render() {
    ageNodes.length = 0;
    const visible = state.orders.filter(orderMatchesStation);

    for (const entry of columns) {
      // Phase V: a cancelled order stays in the column it was in until the
      // food counter taps Remove, and never counts towards the column total.
      const list = visible
        .filter((o) => kitchenCardState(o) !== 'gone' && kitchenColumnOf(o) === entry.col.key)
        .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
      const live = list.filter((o) => o.status !== 'cancelled');
      const unseen = list.some((o) => ['changed', 'cancelled'].includes(kitchenCardState(o)));

      clear(entry.body);
      if (!list.length) {
        entry.body.appendChild(el('p', { class: 'column__empty', text: 'Nothing here right now' }));
      } else {
        for (const order of list) entry.body.appendChild(card(order, entry.col));
      }
      setText(entry.count, String(live.length));
      entry.section.dataset.active = entry.col.key === state.tab ? 'true' : 'false';

      const tab = tabButtons.find((t) => t.col.key === entry.col.key);
      setText(tab.count, String(live.length));
      tab.button.setAttribute('aria-selected', entry.col.key === state.tab ? 'true' : 'false');
      // A tab with an unseen change or cancel shows a dot (Phase V 4).
      tab.dot.hidden = !unseen;
      tab.button.dataset.alert = unseen ? 'true' : 'false';
    }

    const collected = state.orders.filter((o) => o.status === 'collected').length;
    setText(collectedCount, `${collected} collected today`);
  }

  function tickAges() {
    for (const { node, order, col } of ageNodes) {
      const minutes = ageMinutes(order.createdAtMs);
      setText(node, formatAge(minutes));
      node.dataset.late = minutes >= LATE_AFTER_MIN && col.key !== 'ready' ? 'true' : 'false';
    }
  }

  const ticker = setInterval(tickAges, 15000);

  const stopOrders = watchOrders(dayString(), (orders) => {
    const fresh = orders.filter((o) => o.status === 'new');
    let ring = false;
    for (const order of fresh) {
      if (!state.seenNew.has(order.id)) {
        state.seenNew.add(order.id);
        if (!state.firstSnapshot) ring = true;
      }
    }
    // Phase V 4: the same short beep for a change or a cancel from the till.
    for (const order of orders) {
      const cardState = kitchenCardState(order);
      if (cardState !== 'changed' && cardState !== 'cancelled') continue;
      const key = `${order.id}:${cardState === 'cancelled' ? 'cancelled' : order.editedAtMs}`;
      if (state.seenChanges.has(key)) continue;
      state.seenChanges.add(key);
      if (!state.firstSnapshot) ring = true;
    }
    state.firstSnapshot = false;
    state.orders = orders;
    render();
    if (ring) playBeep();
  });

  render();

  return () => {
    clearInterval(ticker);
    stopOrders();
    document.removeEventListener('visibilitychange', onVisibility);
    if (wakeLock) { try { wakeLock.release(); } catch { /* ignore */ } wakeLock = null; }
    if (audioCtx) { try { audioCtx.close(); } catch { /* ignore */ } audioCtx = null; }
  };
}
