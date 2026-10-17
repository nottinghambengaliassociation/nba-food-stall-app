// Food counter: live board of today's orders, New -> Preparing -> Ready -> Collected.

import { el, clear, setText, svgNode } from './ui.js';
import { itemIcon } from './icons.js';
import {
  STATIONS, STATUS_FLOW, PREV_STATUS, LATE_AFTER_MIN,
  dayString, ageMinutes, formatAge, stationOf, inStation
} from './logic.js';
import { watchOrders, setOrderStatus, revertOrderStatus } from './store.js';

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
    }, [count, el('span', { class: 'tab__label', text: col.label })]);
    return { col, button, count };
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
    const minutes = ageMinutes(order.createdAtMs);
    const late = minutes >= LATE_AFTER_MIN && col.key !== 'ready';
    const age = el('span', {
      class: 'order-card__age',
      dataset: { late: late ? 'true' : 'false' },
      text: formatAge(minutes)
    });
    ageNodes.push({ node: age, order, col });

    const lines = (order.items || []).map((line) => el('div', {
      class: 'order-line',
      testid: `order-line-${order.orderNo}-${line.id}`,
      dataset: { off: inStation(line.id, state.station) ? 'false' : 'true', station: stationOf(line.id) || 'other' }
    }, [
      svgNode(itemIcon(line.id, 28)),
      el('b', { text: `${line.qty}×` }),
      el('span', { text: line.name })
    ]));

    return el('article', {
      class: 'order-card' + (col.key === 'ready' ? ' order-card--ready' : ''),
      testid: `order-card-${order.orderNo}`,
      'aria-label': `Order ${order.orderNo} for ${order.name}`
    }, [
      el('div', { class: 'order-card__top' }, [
        el('span', { class: 'order-card__no', text: order.orderNo }),
        age
      ]),
      col.key === 'ready'
        ? el('p', { class: 'order-card__call', testid: `call-${order.orderNo}`, text: String(order.name || '').toUpperCase() })
        : el('p', { class: 'order-card__name', text: order.name }),
      el('div', { class: 'order-card__lines' }, lines),
      el('button', {
        type: 'button',
        class: 'action-btn',
        testid: `action-${order.orderNo}`,
        dataset: { action: col.actionKey },
        text: col.action,
        'aria-label': `${col.action} order ${order.orderNo}`,
        onclick: () => advance(order)
      })
    ]);
  }

  function render() {
    ageNodes.length = 0;
    const visible = state.orders.filter(orderMatchesStation);

    for (const entry of columns) {
      const list = visible
        .filter((o) => o.status === entry.col.key)
        .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));

      clear(entry.body);
      if (!list.length) {
        entry.body.appendChild(el('p', { class: 'column__empty', text: 'Nothing here right now' }));
      } else {
        for (const order of list) entry.body.appendChild(card(order, entry.col));
      }
      setText(entry.count, String(list.length));
      entry.section.dataset.active = entry.col.key === state.tab ? 'true' : 'false';

      const tab = tabButtons.find((t) => t.col.key === entry.col.key);
      setText(tab.count, String(list.length));
      tab.button.setAttribute('aria-selected', entry.col.key === state.tab ? 'true' : 'false');
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
    let isNew = false;
    for (const order of fresh) {
      if (!state.seenNew.has(order.id)) {
        state.seenNew.add(order.id);
        if (!state.firstSnapshot) isNew = true;
      }
    }
    state.firstSnapshot = false;
    state.orders = orders;
    render();
    if (isNew) playBeep();
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
