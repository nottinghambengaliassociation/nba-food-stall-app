// Pure logic for the Charity Food Stall POS.
// No Firebase, no DOM: everything here is unit-testable in plain node.
// Money is integer pence everywhere. Formatting to pounds happens only for display.

/** Seed menu. Prices live in Firestore once seeded; this is the one place they are written. */
export const MENU = [
  { id: 'fuchka', name: 'Fuchka / Gol Gappa', short: 'Fuchka', price: 500, colour: '#FDE68A', station: 'chaat', active: true, sort: 1 },
  { id: 'momo', name: 'Momo', short: 'Momo', price: 500, colour: '#BFDBFE', station: 'momo', active: true, sort: 2 },
  { id: 'chat', name: 'Papri Chat', short: 'Papri Chat', price: 500, colour: '#FECACA', station: 'chaat', active: true, sort: 3 },
  { id: 'samosa', name: 'Sweets Box Samosa / Shingara', short: 'Sweets Box', price: 500, colour: '#FED7AA', station: 'sweets', active: true, sort: 4 },
  { id: 'straw', name: 'Chocolate Strawberry & Marshmallow (V)', short: 'Choc Strawberry', price: 500, colour: '#E9D5FF', station: 'sweets', active: true, sort: 5 },
  { id: 'fountain', name: 'Chocolate Fountain', short: 'Choc Fountain', price: 500, colour: '#E7D3BF', station: 'sweets', active: true, sort: 6 }
];

/** Station filter definitions used by the food counter. */
export const STATIONS = [
  { key: 'all', label: 'All', stations: null },
  { key: 'chaat', label: 'Chaat', stations: ['chaat'] },
  { key: 'momo', label: 'Momo', stations: ['momo'] },
  { key: 'sweets', label: 'Sweets', stations: ['sweets'] }
];

export const STATUS_FLOW = { new: 'preparing', preparing: 'ready', ready: 'collected' };
export const PREV_STATUS = { preparing: 'new', ready: 'preparing', collected: 'ready' };
export const QUICK_TENDERS = [500, 1000, 2000, 5000];
export const LATE_AFTER_MIN = 6;

/* ------------------------------------------------------------------ money */

/**
 * Format integer pence as pounds for display.
 * formatPence(500) === "£5.00", formatPence(-150) === "-£1.50".
 */
export function formatPence(pence) {
  const n = Number(pence);
  const safe = Number.isFinite(n) ? Math.round(n) : 0;
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  return sign + '£' + (abs / 100).toFixed(2);
}

/** Total of an order's lines, in pence. */
export function orderTotal(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, line) => {
    const qty = Math.round(Number(line && line.qty) || 0);
    const price = Math.round(Number(line && line.price) || 0);
    return sum + qty * price;
  }, 0);
}

/** Change to hand back. Never negative; 0 when nothing was tendered. */
export function changeDue(total, tendered) {
  const t = Math.round(Number(total) || 0);
  if (tendered === null || tendered === undefined || tendered === '') return 0;
  const got = Math.round(Number(tendered) || 0);
  return Math.max(0, got - t);
}

/* -------------------------------------------------------------- date/time */

const LONDON = 'Europe/London';

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit'
});
const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON, hour: '2-digit', minute: '2-digit', hour12: false
});

function parts(formatter, date) {
  const out = {};
  for (const p of formatter.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** Europe/London calendar date as "YYYY-MM-DD". */
export function dayString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const p = parts(dayFormatter, d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Minutes since midnight, Europe/London, for an epoch-ms timestamp. */
export function londonMinutes(ms) {
  const d = ms instanceof Date ? ms : new Date(Number(ms) || 0);
  const p = parts(timeFormatter, d);
  const hour = Number(p.hour === '24' ? '00' : p.hour);
  return hour * 60 + Number(p.minute);
}

/** "09:30" from minutes since midnight. */
export function hhmm(minutes) {
  const m = ((Math.round(Number(minutes) || 0) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/** "12:00–12:30" for 30-minute slot index 0..47. */
export function slotLabel(index) {
  const start = (Number(index) || 0) * 30;
  return hhmm(start) + '–' + hhmm(start + 30);
}

/** Whole minutes between two epoch-ms timestamps (floored, never negative). */
export function ageMinutes(createdAtMs, nowMs = Date.now()) {
  const diff = (Number(nowMs) || 0) - (Number(createdAtMs) || 0);
  return Math.max(0, Math.floor(diff / 60000));
}

/** "just now" / "3 min" for a card age. */
export function formatAge(minutes) {
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  return m === 0 ? 'just now' : m + ' min';
}

/** "4m 10s" for an average wait in seconds. */
export function formatWait(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return '—';
  const s = Math.max(0, Math.round(Number(seconds)));
  return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
}

/* ----------------------------------------------------------- order numbers */

function readStore(storage, key) {
  if (!storage) return null;
  if (typeof storage.getItem === 'function') return storage.getItem(key);
  return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
}

function writeStore(storage, key, value) {
  if (!storage) return;
  if (typeof storage.setItem === 'function') storage.setItem(key, value);
  else storage[key] = value;
}

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** The sequence number the next order on this till/day will use, without consuming it. */
export function peekOrderNo(till, day, storage = defaultStorage()) {
  const letter = String(till || 'A').toUpperCase().slice(0, 1);
  const used = Number(readStore(storage, `seq:${letter}:${day}`)) || 0;
  return formatOrderNo(letter, used + 1);
}

/**
 * Consume and return the next order number for this till and day, e.g. "A-043".
 * Counter lives in localStorage under "seq:<till>:<day>" so it rolls over per day and per till.
 */
export function nextOrderNo(till, day, storage = defaultStorage()) {
  const letter = String(till || 'A').toUpperCase().slice(0, 1);
  const key = `seq:${letter}:${day}`;
  const used = Number(readStore(storage, key)) || 0;
  const seq = used + 1;
  writeStore(storage, key, String(seq));
  return formatOrderNo(letter, seq);
}

/** "A" + 43 -> "A-043". */
export function formatOrderNo(till, seq) {
  const letter = String(till || 'A').toUpperCase().slice(0, 1);
  return letter + '-' + String(Math.max(0, Math.round(Number(seq) || 0))).padStart(3, '0');
}

/* -------------------------------------------------------------- menu/station */

const STATION_BY_ID = MENU.reduce((acc, m) => { acc[m.id] = m.station; return acc; }, {});

/** "chaat" | "momo" | "sweets" for a menu item id; null when unknown. */
export function stationOf(itemId) {
  const id = typeof itemId === 'string' ? itemId : (itemId && itemId.id);
  return Object.prototype.hasOwnProperty.call(STATION_BY_ID, id) ? STATION_BY_ID[id] : null;
}

/** Does a line belong to the selected station filter key? */
export function inStation(itemId, stationKey) {
  if (!stationKey || stationKey === 'all') return true;
  return stationOf(itemId) === stationKey;
}

/* ------------------------------------------------------------------ orders */

export function isCancelled(order) {
  return !!order && order.status === 'cancelled';
}

/** Orders that count towards sales. */
export function activeOrders(orders) {
  return (Array.isArray(orders) ? orders : []).filter((o) => o && !isCancelled(o));
}

/** Items sold across a list of order lines. */
export function itemCount(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((n, l) => n + (Math.round(Number(l && l.qty) || 0)), 0);
}

/* ----------------------------------------------------------------- reports */

/**
 * Aggregate a day's orders into everything the reports screen shows.
 * Cancelled orders are excluded from every figure.
 */
export function buildReport(orders) {
  const all = Array.isArray(orders) ? orders.filter(Boolean) : [];
  const live = all.filter((o) => !isCancelled(o));
  const cancelledCount = all.length - live.length;

  let totalSales = 0;
  let itemsSold = 0;
  let cashAmount = 0;
  let cardAmount = 0;
  let cashCount = 0;
  let cardCount = 0;
  const waits = [];
  const itemMap = new Map();
  const slotCounts = new Array(48).fill(0);

  for (const o of live) {
    const items = Array.isArray(o.items) ? o.items : [];
    const total = Number.isFinite(Number(o.total)) ? Math.round(Number(o.total)) : orderTotal(items);
    totalSales += total;
    itemsSold += itemCount(items);

    if (o.payment === 'card') { cardAmount += total; cardCount += 1; }
    else { cashAmount += total; cashCount += 1; }

    for (const line of items) {
      const id = line && line.id;
      if (!id) continue;
      const qty = Math.round(Number(line.qty) || 0);
      const price = Math.round(Number(line.price) || 0);
      const seed = MENU.find((m) => m.id === id);
      const row = itemMap.get(id) || { id, name: line.name || (seed && seed.name) || id, units: 0, revenue: 0 };
      row.units += qty;
      row.revenue += qty * price;
      itemMap.set(id, row);
    }

    if (Number(o.readyAtMs) && Number(o.createdAtMs) && Number(o.readyAtMs) >= Number(o.createdAtMs)) {
      waits.push((Number(o.readyAtMs) - Number(o.createdAtMs)) / 1000);
    }

    if (Number(o.createdAtMs)) {
      const idx = Math.min(47, Math.max(0, Math.floor(londonMinutes(Number(o.createdAtMs)) / 30)));
      slotCounts[idx] += 1;
    }
  }

  const orderCount = live.length;
  const averageOrder = orderCount ? Math.round(totalSales / orderCount) : 0;
  const averageWaitSeconds = waits.length
    ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)
    : null;

  const byItem = Array.from(itemMap.values()).sort((a, b) => b.units - a.units || a.id.localeCompare(b.id));

  const slots = slotCounts.map((count, index) => ({
    index, count, start: index * 30, label: slotLabel(index)
  }));

  // Peak 30 minutes
  let peak = null;
  for (const s of slots) {
    if (s.count > 0 && (!peak || s.count > peak.count)) peak = s;
  }
  if (peak) peak = { index: peak.index, count: peak.count, start: peak.start, label: peak.label };

  // Busiest 2 hours = best run of four consecutive 30-minute slots
  let busiestWindow = null;
  if (orderCount > 0) {
    let bestIndex = 0;
    let bestSum = -1;
    for (let i = 0; i + 4 <= slots.length; i++) {
      let sum = 0;
      for (let j = i; j < i + 4; j++) sum += slots[j].count;
      if (sum > bestSum) { bestSum = sum; bestIndex = i; }
    }
    if (bestSum > 0) {
      busiestWindow = {
        index: bestIndex,
        start: bestIndex * 30,
        count: bestSum,
        label: hhmm(bestIndex * 30) + '–' + hhmm(bestIndex * 30 + 120),
        share: Math.round((bestSum / orderCount) * 100)
      };
    }
  }

  const pct = (part) => (totalSales > 0 ? Math.round((part / totalSales) * 100) : 0);

  return {
    orderCount,
    orders: orderCount,
    cancelledCount,
    totalSales,
    itemsSold,
    averageOrder,
    avgOrder: averageOrder,
    averageWaitSeconds,
    avgWaitSeconds: averageWaitSeconds,
    byItem,
    slots,
    peak,
    peakSlot: peak,
    busiestWindow,
    payment: {
      cash: { count: cashCount, amount: cashAmount, percent: pct(cashAmount) },
      card: { count: cardCount, amount: cardAmount, percent: pct(cardAmount) }
    },
    cash: { count: cashCount, amount: cashAmount, percent: pct(cashAmount) },
    card: { count: cardCount, amount: cardAmount, percent: pct(cardAmount) }
  };
}

/* --------------------------------------------------------------------- CSV */

export const CSV_HEADER = [
  'day', 'orderNo', 'till', 'name', 'item', 'qty', 'price',
  'lineTotal', 'payment', 'status', 'createdAt', 'readyAt', 'waitSeconds'
];

/** Quote a CSV field when it contains a comma, quote, or newline. */
export function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function isoOrBlank(ms) {
  const n = Number(ms);
  if (!n || !Number.isFinite(n)) return '';
  return new Date(n).toISOString();
}

/**
 * One CSV row per order line. Cancelled orders are excluded, as everywhere else in reports.
 * Money columns stay in integer pence.
 */
export function ordersToCsv(orders) {
  const rows = [CSV_HEADER.join(',')];
  const live = activeOrders(orders).slice().sort((a, b) => {
    const d = (Number(a.createdAtMs) || 0) - (Number(b.createdAtMs) || 0);
    return d || String(a.orderNo || '').localeCompare(String(b.orderNo || ''));
  });

  for (const o of live) {
    const items = Array.isArray(o.items) ? o.items : [];
    const createdAt = isoOrBlank(o.createdAtMs);
    const readyAt = isoOrBlank(o.readyAtMs);
    const waitSeconds = (Number(o.readyAtMs) && Number(o.createdAtMs) && Number(o.readyAtMs) >= Number(o.createdAtMs))
      ? String(Math.round((Number(o.readyAtMs) - Number(o.createdAtMs)) / 1000))
      : '';
    for (const line of items) {
      const qty = Math.round(Number(line && line.qty) || 0);
      const price = Math.round(Number(line && line.price) || 0);
      rows.push([
        o.day || '',
        o.orderNo || '',
        o.till || '',
        o.name || '',
        (line && line.name) || (line && line.id) || '',
        qty,
        price,
        qty * price,
        o.payment || '',
        o.status || '',
        createdAt,
        readyAt,
        waitSeconds
      ].map(csvEscape).join(','));
    }
  }
  return rows.join('\n');
}
