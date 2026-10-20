// Pure logic for the Charity Food Stall POS.
// No Firebase, no DOM: everything here is unit-testable in plain node.
// Money is integer pence everywhere. Formatting to pounds happens only for display.

/** Seed menu. Prices live in Firestore once seeded; this is the one place they are written. */
export const MENU = [
  { id: 'fuchka', name: 'Fuchka / Gol Gappa', short: 'Fuchka', price: 500, colour: '#FDE68A', station: 'chaat', active: true, sort: 1 },
  { id: 'momo', name: 'Momo', short: 'Momo', price: 500, colour: '#BFDBFE', station: 'momo', active: true, sort: 2 },
  { id: 'chat', name: 'Papri Chat', short: 'Papri Chat', price: 500, colour: '#FECACA', station: 'chaat', active: true, sort: 3 },
  { id: 'sweet_box', name: 'Sweet Box', short: 'Sweet Box', price: 500, colour: '#FED7AA', station: 'sweets', active: true, sort: 4 },
  { id: 'samosa_only', name: 'Samosa', short: 'Samosa', price: 500, colour: '#D9F99D', station: 'sweets', active: true, sort: 5 },
  { id: 'choc_strawberry', name: 'Chocolate Strawberry', short: 'Choc Strawberry', price: 500, colour: '#E9D5FF', station: 'sweets', active: true, sort: 6 },
  { id: 'marshmallow', name: 'Chocolate Marshmallow (V)', short: 'Choc Marshmallow', price: 500, colour: '#FBCFE8', station: 'sweets', active: true, sort: 7 },
  // Phase V (v1.4.0): Samosa Chat, last on the till, Chaat station.
  { id: 'samosa_chat', name: 'Samosa Chat', short: 'Samosa Chat', price: 500, colour: '#A5F3FC', station: 'chaat', active: true, sort: 8 }
];

/** The items the till shows as tiles: everything in MENU that is still on sale. */
export const ACTIVE_MENU = MENU.filter((m) => m.active !== false);

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

/* ------------------------------------------------- cash received (optional) */

/** Quick cash buttons on the cash counter: Exact (= the order total) plus the common notes. */
export const QUICK_CASH = ['exact', 500, 1000, 2000, 5000];

/**
 * Parse a typed cash amount into integer pence.
 * Accepts "17.50", "17.5", "£17.50", "17", "1,000", " £1,000.00 " and ".5".
 *   ""        -> null  (nothing entered)
 *   "abc"     -> NaN   (typed but unparseable; "0" and negatives count as unparseable)
 *   "£1,000"  -> 100000
 * null and NaN are both "no amount", and are told apart with Number.isFinite.
 */
export function parseAmountToPence(text) {
  if (text === null || text === undefined) return null;
  const raw = String(text).replace(/[£\s,]/g, '');
  if (raw === '') return null;
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(raw)) return NaN;
  const pounds = Number(raw);
  if (!Number.isFinite(pounds) || pounds <= 0) return NaN;
  return Math.round(pounds * 100);
}

/** Aliases: the same parser under the names it is natural to reach for. */
export const parseMoneyToPence = parseAmountToPence;
export const parsePence = parseAmountToPence;

/** Pence as a plain pounds figure ("2000" -> "20.00"); blank when there is none. */
export function poundsField(pence) {
  const n = Number(pence);
  if (pence === null || pence === undefined || pence === '' || !Number.isFinite(n)) return '';
  return (Math.round(n) / 100).toFixed(2);
}

/**
 * Change owed: tendered − total when tendered ≥ total, else null.
 * Pure helper only. Cash received is a cashier-side calculator and is never
 * written to an order or to the CSV.
 */
export function changeGiven(total, tendered) {
  const t = Math.round(Number(total) || 0);
  if (tendered === null || tendered === undefined || tendered === '') return null;
  const got = Number(tendered);
  if (!Number.isFinite(got)) return null;
  return Math.round(got) >= t ? Math.round(got) - t : null;
}

/**
 * The four display states of "Cash received (optional)".
 * `received` is pence, or null (box empty), or NaN (typed but unparseable); a string is parsed first.
 * Returns { state: 'empty' | 'change' | 'short' | 'invalid', pence, change, short, message, shortMessage }.
 * `message` is the tablet wording, `shortMessage` the phone wording.
 */
export function cashReceivedState(total, received) {
  const t = Math.round(Number(total) || 0);
  const pence = typeof received === 'string' ? parseAmountToPence(received) : received;

  if (pence === null || pence === undefined || pence === '') {
    return { state: 'empty', pence: null, change: null, short: null, message: '', shortMessage: '' };
  }
  if (!Number.isFinite(Number(pence))) {
    return {
      state: 'invalid', pence: NaN, change: null, short: null,
      message: 'Enter an amount like 17.50', shortMessage: 'Check amount'
    };
  }
  const got = Math.round(Number(pence));
  if (got >= t) {
    const change = got - t;
    return {
      state: 'change', pence: got, change, short: null,
      message: `Change to give: ${formatPence(change)}`, shortMessage: `Change ${formatPence(change)}`
    };
  }
  const short = t - got;
  return {
    state: 'short', pence: got, change: null, short,
    message: `Short by ${formatPence(short)}`, shortMessage: `Short ${formatPence(short)}`
  };
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

// Money columns stay in integer pence. Cash received is an on-screen
// calculator for the cashier only, so nothing about it reaches the export.
// Phase V adds `edited` and `cancelReason` as the last two columns, on every
// export (One day, Sales by day and the orders list).
export const CSV_HEADER = [
  'day', 'orderNo', 'till', 'name', 'item', 'qty', 'price',
  'lineTotal', 'payment', 'status', 'createdAt', 'readyAt', 'waitSeconds',
  'edited', 'cancelReason'
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

/** The CSV lines for one order: one row per order line, already escaped. */
function csvRowsForOrder(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  const createdAt = isoOrBlank(o.createdAtMs);
  const readyAt = isoOrBlank(o.readyAtMs);
  const waitSeconds = (Number(o.readyAtMs) && Number(o.createdAtMs) && Number(o.readyAtMs) >= Number(o.createdAtMs))
    ? String(Math.round((Number(o.readyAtMs) - Number(o.createdAtMs)) / 1000))
    : '';
  // Phase V: `edited` is yes/no from editCount, `cancelReason` is blank unless
  // the order was cancelled (old orders carry neither field).
  const edited = Number(o.editCount) > 0 ? 'yes' : 'no';
  const cancelReason = o.status === 'cancelled' && o.cancelReason ? String(o.cancelReason) : '';
  return items.map((line) => {
    const qty = Math.round(Number(line && line.qty) || 0);
    const price = Math.round(Number(line && line.price) || 0);
    return [
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
      waitSeconds,
      edited,
      cancelReason
    ].map(csvEscape).join(',');
  });
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

  for (const o of live) rows.push(...csvRowsForOrder(o));
  return rows.join('\n');
}

/* ------------------------------------------------- Phase III: day ranges */
//
// Calendar maths on "YYYY-MM-DD" strings. The arithmetic runs at UTC midnight
// so adding a day never slips an hour over a British Summer Time change: the
// day strings themselves are already Europe/London dates (see dayString).

const DAY_MS = 86400000;
export const RANGE_MAX_DAYS = 31;
export const RANGE_TOO_LONG_MESSAGE = 'Pick 31 days or fewer';
export const RANGE_EMPTY_MESSAGE = 'No sales in this range';

const utcDow = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' });
const utcDayMonth = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const utcDayMonthYear = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

/** Is this a usable "YYYY-MM-DD" day string? */
export function isDayString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(ms) && dayFromMs(ms) === value;
}

function dayToMs(day) {
  return Date.parse(String(day) + 'T00:00:00Z');
}

function dayFromMs(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** "2026-10-18" + 3 -> "2026-10-21"; negative n goes back. */
export function addDays(day, n) {
  if (!isDayString(day)) return '';
  return dayFromMs(dayToMs(day) + Math.round(Number(n) || 0) * DAY_MS);
}

/** Whole days from `from` to `to` (to − from); negative when `to` is earlier. */
export function dayDiff(from, to) {
  if (!isDayString(from) || !isDayString(to)) return 0;
  return Math.round((dayToMs(to) - dayToMs(from)) / DAY_MS);
}

/** Number of days in an inclusive range; 0 when either end is unusable. */
export function rangeLength(from, to) {
  if (!isDayString(from) || !isDayString(to)) return 0;
  return Math.abs(dayDiff(from, to)) + 1;
}

/** Every day from `from` to `to` inclusive, ascending. */
export function listDays(from, to) {
  if (!isDayString(from) || !isDayString(to)) return [];
  const a = dayToMs(from) <= dayToMs(to) ? from : to;
  const b = dayToMs(from) <= dayToMs(to) ? to : from;
  const out = [];
  for (let ms = dayToMs(a); ms <= dayToMs(b); ms += DAY_MS) out.push(dayFromMs(ms));
  return out;
}

/** "Sun" for a day string. */
export function weekdayShort(day) {
  return isDayString(day) ? utcDow.format(new Date(dayToMs(day))) : '';
}

/** "18 Oct". */
export function formatDayShort(day) {
  return isDayString(day) ? utcDayMonth.format(new Date(dayToMs(day))) : '';
}

/** "Sun 18 Oct", the label used on the chart and in the day table. */
export function formatDayLabel(day) {
  return isDayString(day) ? `${weekdayShort(day)} ${formatDayShort(day)}` : '';
}

/** "19 Oct 2026", used by the version line. */
export function formatDayLong(day) {
  return isDayString(day) ? utcDayMonthYear.format(new Date(dayToMs(day))) : '';
}

/**
 * Tidy a From/To pair: swap when To is before From, then enforce the 31-day
 * maximum (CLAUDE.md Phase III 2). A too-long range is reported, never queried.
 * Returns { from, to, days, dayCount, swapped, tooLong, valid, ok, error }.
 */
export function clampRange(from, to) {
  let a = isDayString(from) ? from : null;
  let b = isDayString(to) ? to : null;
  if (!a && !b) {
    return {
      from: '', to: '', days: [], dayCount: 0, swapped: false,
      tooLong: false, valid: false, ok: false, error: 'Pick a From and To date'
    };
  }
  if (!a) a = b;
  if (!b) b = a;
  let swapped = false;
  if (dayToMs(b) < dayToMs(a)) { const t = a; a = b; b = t; swapped = true; }
  const dayCount = rangeLength(a, b);
  const tooLong = dayCount > RANGE_MAX_DAYS;
  return {
    from: a,
    to: b,
    days: tooLong ? [] : listDays(a, b),
    dayCount,
    swapped,
    tooLong,
    valid: !tooLong,
    ok: !tooLong,
    error: tooLong ? RANGE_TOO_LONG_MESSAGE : null
  };
}

/** Default range: the last 7 days ending today. */
export function defaultRange(today = dayString()) {
  const end = isDayString(today) ? today : dayString();
  return { from: addDays(end, -6), to: end };
}

/** Quick range "Today". */
export function todayRange(today = dayString()) {
  const end = isDayString(today) ? today : dayString();
  return { from: end, to: end };
}

/** Orders whose day falls inside an inclusive range (cancelled ones included; filter later). */
export function ordersInRange(orders, from, to) {
  if (!isDayString(from) || !isDayString(to)) return [];
  return (Array.isArray(orders) ? orders : []).filter((o) => o && isDayString(o.day) && o.day >= from && o.day <= to);
}

/* -------------------------------------------- Phase III: range aggregation */

function menuIndex(id) {
  const i = MENU.findIndex((m) => m.id === id);
  return i === -1 ? 999 : (MENU[i].sort || 999);
}

/**
 * Roll a range of orders up per trading day (CLAUDE.md Phase III 4–8).
 * Only days with at least one order appear. Cancelled orders are excluded
 * everywhere, exactly as in buildReport. The legacy `tendered` field is ignored.
 */
export function buildRangeReport(orders) {
  const live = activeOrders(orders);

  const byDay = new Map();
  for (const o of live) {
    const day = typeof o.day === 'string' ? o.day : '';
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(o);
  }

  const dayKeys = Array.from(byDay.keys()).sort();
  const itemMap = new Map();

  const days = dayKeys.map((day) => {
    const report = buildReport(byDay.get(day));
    for (const row of report.byItem) {
      const entry = itemMap.get(row.id) || { id: row.id, name: row.name, byDay: new Map(), total: 0, sales: 0 };
      entry.name = entry.name || row.name;
      entry.byDay.set(day, (entry.byDay.get(day) || 0) + row.units);
      entry.total += row.units;
      entry.sales += row.revenue;
      itemMap.set(row.id, entry);
    }
    return {
      day,
      weekday: weekdayShort(day),
      date: formatDayShort(day),
      label: formatDayLabel(day),
      orders: report.orderCount,
      orderCount: report.orderCount,
      items: report.itemsSold,
      itemsSold: report.itemsSold,
      sales: report.totalSales,
      cash: report.cash.amount,
      card: report.card.amount,
      avgOrder: report.averageOrder,
      averageOrder: report.averageOrder,
      peak: report.peak ? report.peak.label : '',
      peakCount: report.peak ? report.peak.count : 0,
      report
    };
  });

  const sum = (key) => days.reduce((a, d) => a + d[key], 0);
  const totalSales = sum('sales');
  const orderCount = sum('orders');
  const itemsSold = sum('items');
  const cash = sum('cash');
  const card = sum('card');
  const tradingDays = days.length;

  let best = null;
  for (const d of days) {
    if (!best || d.sales > best.sales) best = d;
  }

  const items = Array.from(itemMap.values()).map((entry) => {
    let bestDay = null;
    let bestUnits = 0;
    for (const day of dayKeys) {
      const units = entry.byDay.get(day) || 0;
      if (units > bestUnits) { bestUnits = units; bestDay = day; }
    }
    const cells = dayKeys.map((day) => ({
      day,
      units: entry.byDay.get(day) || 0,
      best: bestDay !== null && day === bestDay
    }));
    const seed = MENU.find((m) => m.id === entry.id);
    return {
      id: entry.id,
      name: entry.name || (seed && seed.name) || entry.id,
      cells,
      units: entry.total,
      total: entry.total,
      sales: entry.sales,
      revenue: entry.sales,
      bestDay,
      bestUnits
    };
  }).sort((a, b) => menuIndex(a.id) - menuIndex(b.id) || a.name.localeCompare(b.name));

  return {
    days,
    dayKeys,
    tradingDays,
    items,
    matrix: items,
    best,
    bestDay: best,
    empty: tradingDays === 0,
    maxSales: days.reduce((m, d) => Math.max(m, d.sales), 0),
    totalSales,
    orderCount,
    orders: orderCount,
    itemsSold,
    itemsPerOrder: orderCount ? itemsSold / orderCount : 0,
    averageOrder: orderCount ? Math.round(totalSales / orderCount) : 0,
    averagePerDay: tradingDays ? Math.round(totalSales / tradingDays) : 0,
    averageOrdersPerDay: tradingDays ? Math.round(orderCount / tradingDays) : 0,
    totals: {
      orders: orderCount,
      items: itemsSold,
      sales: totalSales,
      cash,
      card,
      avgOrder: orderCount ? Math.round(totalSales / orderCount) : 0
    },
    cash: { amount: cash },
    card: { amount: card }
  };
}

/* ------------------------------------------------- Phase III: range CSV */

/** The range export has exactly the same columns as the one-day export. */
export const rangeToCsv = ordersToCsv;

/** "nba-food-stall_2026-10-13_2026-10-19.csv" */
export function rangeCsvFilename(from, to) {
  return `nba-food-stall_${from}_${to}.csv`;
}

/* ------------------------------------------------------ display helpers */

/** "£2,005.00": thousands grouped, for the by-day report (design/ReportsByDay.dc.html). */
export function formatPenceGrouped(pence) {
  const n = Number(pence);
  const safe = Number.isFinite(n) ? Math.round(n) : 0;
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  return sign + '£' + (abs / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "£2,005": whole pounds, for chart gridlines. */
export function formatPoundsRounded(pence) {
  const n = Number(pence);
  const safe = Number.isFinite(n) ? Math.round(n) : 0;
  const sign = safe < 0 ? '-' : '';
  return sign + '£' + Math.round(Math.abs(safe) / 100).toLocaleString('en-GB');
}

/**
 * Bar value labels: the exact amount while the figures are small, whole pounds
 * once they run into the thousands and the label would not fit over a bar.
 */
export function formatPenceCompact(pence) {
  const n = Math.abs(Math.round(Number(pence) || 0));
  return n >= 100000 ? formatPoundsRounded(pence) : formatPenceGrouped(pence);
}

/** Username matching: trimmed and case-insensitive (CLAUDE.md "Login and sign out" 2). */
export function normaliseUser(text) {
  return String(text === null || text === undefined ? '' : text).trim().toLowerCase();
}

/** Lowercase hex SHA-256 via Web Crypto. */
export async function sha256Hex(text) {
  const subtle = (globalThis.crypto && globalThis.crypto.subtle) || null;
  if (!subtle) throw new Error('Web Crypto unavailable');
  const bytes = new TextEncoder().encode(String(text));
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Alias kept because the brief names the parser `parseAmount`. */
export const parseAmount = parseAmountToPence;

/* ------------------------------------ Phase IV: orders list and detail */
//
// Read-only helpers for #/reports/orders. Cancelled orders are *listed* here
// (unlike everywhere else in reports) but never counted in the total.

export const ORDER_STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'collected', label: 'Collected' },
  { key: 'cancelled', label: 'Cancelled' }
];

export const ORDER_PAY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'cash', label: 'Cash' },
  { key: 'card', label: 'Card' }
];

export const STATUS_LABELS = {
  new: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
  collected: 'Collected',
  cancelled: 'Cancelled'
};

/** "Preparing" for a stored status; unknown statuses fall back to "New". */
export function statusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.new;
}

/** "Cash" / "Card"; anything unset is cash, as the till writes it. */
export function paymentLabel(payment) {
  return payment === 'card' ? 'Card' : 'Cash';
}

const MENU_BY_ID = MENU.reduce((acc, m) => { acc[m.id] = m; return acc; }, {});

/**
 * The short name for one order line: the menu's short name when the id is
 * known, then the name stored on the line, then the raw id. An id the menu
 * no longer carries keeps the name saved on the order.
 */
export function lineShortName(line) {
  const id = line && line.id;
  const seed = id ? MENU_BY_ID[id] : null;
  return (seed && seed.short) || (line && line.name) || id || '';
}

/** The full name for one order line, for the detail panel. */
export function lineFullName(line) {
  const id = line && line.id;
  const seed = id ? MENU_BY_ID[id] : null;
  return (line && line.name) || (seed && seed.name) || id || '';
}

/**
 * When the order was placed, in epoch ms. Orders carry createdAtMs; the
 * Firestore serverTimestamp in createdAt is the fallback for anything odd.
 */
export function orderTimeMs(order) {
  const ms = Number(order && order.createdAtMs);
  if (Number.isFinite(ms) && ms > 0) return ms;
  const stamp = order && order.createdAt;
  if (stamp && typeof stamp.toMillis === 'function') return stamp.toMillis();
  if (stamp && Number.isFinite(Number(stamp.seconds))) return Number(stamp.seconds) * 1000;
  return 0;
}

/** "15:02", Europe/London, for the Time column; "—" when there is no stamp. */
export function formatClock(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? hhmm(londonMinutes(n)) : '—';
}

/** The order list runs newest first (CLAUDE.md Phase IV 5). */
export function sortOrdersNewestFirst(orders) {
  return (Array.isArray(orders) ? orders.filter(Boolean) : []).slice().sort((a, b) => {
    const d = orderTimeMs(b) - orderTimeMs(a);
    return d || String(b.orderNo || '').localeCompare(String(a.orderNo || ''));
  });
}

/** "2× Fuchka, 1× Momo" from an order's lines, using the menu short names. */
export function orderSummary(order) {
  const items = Array.isArray(order && order.items) ? order.items : [];
  return items
    .filter((line) => Math.round(Number(line && line.qty) || 0) > 0)
    .map((line) => `${Math.round(Number(line.qty) || 0)}× ${lineShortName(line)}`)
    .join(', ');
}

/** Whole minutes from placed to ready; null when the order never went ready. */
export function orderWaitMinutes(order) {
  const placed = Number(order && order.createdAtMs);
  const ready = Number(order && order.readyAtMs);
  if (!Number.isFinite(placed) || !placed || !Number.isFinite(ready) || !ready) return null;
  if (ready < placed) return null;
  return Math.round((ready - placed) / 60000);
}

/** "4 min" or "—" for the Wait column. */
export function orderWaitText(order) {
  const mins = orderWaitMinutes(order);
  return mins === null ? '—' : `${mins} min`;
}

/**
 * Placed → Started → Ready → Collected, or Placed → Cancelled.
 * Steps that were never reached keep a "—" time so the panel shows the whole
 * journey either way (CLAUDE.md Phase IV 6).
 */
export function orderTimeline(order) {
  const o = order || {};
  const step = (key, label, ms, note) => {
    const n = Number(ms);
    const reached = Number.isFinite(n) && n > 0;
    return {
      key,
      label,
      ms: reached ? n : null,
      time: reached ? formatClock(n) : '—',
      reached,
      note: note || ''
    };
  };

  const base = o.status === 'cancelled'
    ? [
      step('placed', 'Placed', orderTimeMs(o)),
      // Phase V: the cancel step carries its reason ("Cancelled 15:02 · Customer changed mind").
      step('cancelled', 'Cancelled', o.cancelledAtMs, cancelReasonLabel(o.cancelReason))
    ]
    : [
      step('placed', 'Placed', orderTimeMs(o)),
      step('started', 'Started', o.startedAtMs),
      step('ready', 'Ready', o.readyAtMs),
      step('collected', 'Collected', o.collectedAtMs)
    ];

  // Phase V: every edit becomes its own "Edited HH:MM" step, in the right
  // place in the run of times. Old orders have no history and no editedAtMs,
  // so they get exactly the timeline they had before.
  const edits = editTimes(o).map((ms, i) => step(`edited-${i + 1}`, 'Edited', ms));
  if (!edits.length) return base;

  const reached = base.filter((s) => s.reached);
  const pending = base.filter((s) => !s.reached);
  const merged = reached.concat(edits).sort((a, b) => (a.ms || 0) - (b.ms || 0));
  return merged.concat(pending);
}

/** Epoch-ms of each edit, oldest first: from `history`, or the last edit alone. */
export function editTimes(order) {
  const o = order || {};
  const entries = Array.isArray(o.history) ? o.history : [];
  const fromHistory = entries
    .filter((h) => h && h.action === 'edit' && Number(h.atMs) > 0)
    .map((h) => Number(h.atMs))
    .sort((a, b) => a - b);
  if (fromHistory.length) return fromHistory;
  const last = Number(o.editedAtMs);
  return Number.isFinite(last) && last > 0 ? [last] : [];
}

/**
 * The orders list filters: status, payment and a free-text search over the
 * order number or the name (trimmed, case-insensitive). Cancelled orders pass
 * the filters like any other; they are only left out of the money total.
 */
export function filterOrders(orders, options = {}) {
  const status = options.status || 'all';
  const pay = options.pay || options.payment || 'all';
  const q = String(options.q === null || options.q === undefined ? '' : options.q).trim().toLowerCase();

  return (Array.isArray(orders) ? orders.filter(Boolean) : []).filter((o) => {
    if (status !== 'all' && (o.status || 'new') !== status) return false;
    if (pay !== 'all' && (o.payment === 'card' ? 'card' : 'cash') !== pay) return false;
    if (!q) return true;
    const no = String(o.orderNo || '').toLowerCase();
    const name = String(o.name || '').toLowerCase();
    return no.includes(q) || name.includes(q);
  });
}

/** Total of an order in pence: the stored total, or the lines when it is missing. */
export function orderAmount(order) {
  const total = Number(order && order.total);
  return Number.isFinite(total) ? Math.round(total) : orderTotal(order && order.items);
}

/**
 * The line above the list: "<n> orders · £<total>", plus "(excludes <c>
 * cancelled)" when any of the rows are cancelled (CLAUDE.md Phase IV 4).
 * Everything the screen shows comes from here, phone and tablet alike.
 */
export function summariseOrders(orders) {
  const rows = Array.isArray(orders) ? orders.filter(Boolean) : [];
  const cancelled = rows.filter(isCancelled).length;
  const total = rows.filter((o) => !isCancelled(o)).reduce((sum, o) => sum + orderAmount(o), 0);
  const text = `${rows.length} orders · ${formatPence(total)}`
    + (cancelled ? ` (excludes ${cancelled} cancelled)` : '');
  return { count: rows.length, total, cancelled, text };
}

/** Just the text of the summary line. */
export function ordersSummaryText(orders) {
  return summariseOrders(orders).text;
}

/**
 * CSV of the orders currently on the screen (CLAUDE.md Phase IV 8): the same
 * thirteen columns as the One day export, over the filtered rows and in the
 * order they are listed. Cancelled orders are shown on this screen, so they
 * are exported too, with "cancelled" in the status column; the One day and
 * Sales by day exports keep leaving them out.
 */
export function exportOrdersCsv(orders) {
  const rows = [CSV_HEADER.join(',')];
  for (const o of (Array.isArray(orders) ? orders.filter(Boolean) : [])) rows.push(...csvRowsForOrder(o));
  return rows.join('\n');
}

/** "nba-food-stall_orders_2026-10-17.csv" */
export function ordersCsvFilename(day) {
  return `nba-food-stall_orders_${day}.csv`;
}

/* ---------------------------------- Phase V: edit or cancel an open order */
//
// Pure helpers behind the Open orders drawer, edit mode, the cancel dialog,
// the food counter's changed/cancelled cards and the Changes list in the
// orders report. No Firebase, no DOM: the transaction itself lives in
// store.js, everything it needs to decide and to say lives here.

/** The statuses the cash counter can still act on (CLAUDE.md Phase V 1). */
export const OPEN_STATUSES = ['new', 'preparing', 'ready'];

/** Statuses an edit may start from, and the ones a cancel may start from. */
export const EDITABLE_STATUSES = ['new', 'preparing'];
export const CANCELLABLE_STATUSES = ['new', 'preparing', 'ready'];

export const HISTORY_MAX = 10;

export const EDIT_READY_TITLE = 'Ready: cancel only';
export const EDIT_OFFLINE_NOTE = 'Needs a connection';
export const EDIT_EMPTY_MESSAGE = 'No items left. Cancel the order instead?';
export const EDIT_NO_CHANGES = 'No changes yet';
export const EDIT_NO_PAYMENT_CHANGE = 'No payment change';

/** Today's orders the cash counter may still change. */
export function isOpenOrder(order) {
  return OPEN_STATUSES.includes((order && order.status) || 'new');
}

/** Open orders from every till, newest first (CLAUDE.md Phase V 1). */
export function openOrders(orders, q = '') {
  const rows = (Array.isArray(orders) ? orders.filter(Boolean) : []).filter(isOpenOrder);
  return sortOrdersNewestFirst(filterOrders(rows, { q }));
}

export function canEditOrder(order) {
  return EDITABLE_STATUSES.includes((order && order.status) || 'new');
}

export function canCancelOrder(order) {
  return CANCELLABLE_STATUSES.includes((order && order.status) || 'new');
}

/* ------------------------------------------------------------- reasons */

export const CANCEL_REASONS = [
  { key: 'mistake', label: 'Placed by mistake' },
  { key: 'changed_mind', label: 'Customer changed mind' },
  { key: 'out_of_stock', label: 'Out of stock' },
  { key: 'not_collected', label: 'Not collected', readyOnly: true },
  { key: 'other', label: 'Other' }
];

/** "Not collected" only makes sense once the food is waiting (Phase V 3). */
export function cancelReasonsFor(status) {
  return CANCEL_REASONS.filter((r) => !r.readyOnly || status === 'ready');
}

/** "Customer changed mind" for a stored reason key; '' when there is none. */
export function cancelReasonLabel(key) {
  const found = CANCEL_REASONS.find((r) => r.key === key);
  return found ? found.label : '';
}

/* ------------------------------------------------------- item diffing */

/** An order's lines as { id: qty }, ignoring zero and negative quantities. */
export function itemsToQtyMap(items) {
  const map = {};
  for (const line of (Array.isArray(items) ? items.filter(Boolean) : [])) {
    const qty = Math.round(Number(line.qty) || 0);
    if (qty > 0 && line.id) map[line.id] = (map[line.id] || 0) + qty;
  }
  return map;
}

/** Same ids, same quantities? */
export function qtyMapsEqual(a, b) {
  const left = a || {};
  const right = b || {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if ((left[key] || 0) !== (right[key] || 0)) return false;
  return true;
}

/**
 * "added" / "removed" / "+1 (was 2)" / "−1 (was 2)" for one line, as the cash
 * counter's order panel words it (CLAUDE.md Phase V 2).
 */
export function lineDeltaText(before, now) {
  const was = Math.round(Number(before) || 0);
  const is = Math.round(Number(now) || 0);
  if (was === is) return '';
  if (was === 0) return 'added';
  if (is === 0) return 'removed';
  return `${is > was ? '+' : '−'}${Math.abs(is - was)} (was ${was})`;
}

/** The same thing in the food counter's shoutier wording (Phase V 4). */
export function lineDeltaTag(before, now) {
  const was = Math.round(Number(before) || 0);
  const is = Math.round(Number(now) || 0);
  if (was === is) return '';
  if (was === 0) return 'NEW';
  if (is === 0) return 'REMOVED';
  return lineDeltaText(was, is);
}

/**
 * One row per line in the new order plus one per line that was taken off it.
 * `kind` is 'added' | 'up' | 'down' | 'same' | 'removed'.
 */
export function diffOrderItems(beforeItems, afterItems) {
  const was = itemsToQtyMap(beforeItems);
  const now = itemsToQtyMap(afterItems);
  const nameOf = (id) => {
    const inAfter = (afterItems || []).find((l) => l && l.id === id);
    const inBefore = (beforeItems || []).find((l) => l && l.id === id);
    return lineFullName(inAfter || inBefore || { id });
  };
  const rows = [];
  for (const line of (Array.isArray(afterItems) ? afterItems.filter(Boolean) : [])) {
    const qty = Math.round(Number(line.qty) || 0);
    if (qty <= 0) continue;
    const before = was[line.id] || 0;
    rows.push({
      id: line.id,
      name: lineFullName(line),
      qty,
      before,
      kind: before === 0 ? 'added' : (qty > before ? 'up' : (qty < before ? 'down' : 'same')),
      text: lineDeltaText(before, qty),
      tag: lineDeltaTag(before, qty)
    });
  }
  const removed = Object.keys(was)
    .filter((id) => !now[id])
    .map((id) => ({
      id,
      name: nameOf(id),
      qty: was[id],
      before: was[id],
      kind: 'removed',
      text: 'removed',
      tag: 'REMOVED'
    }));
  return { rows, removed, changed: !qtyMapsEqual(was, now) };
}

/* ------------------------------------------------- money and prompts */

/** New total minus old total, in pence. Positive means take more. */
export function editDelta(beforeTotal, afterTotal) {
  return Math.round(Number(afterTotal) || 0) - Math.round(Number(beforeTotal) || 0);
}

/** Has anything the volunteer can change actually changed? */
export function editHasChanges(before, after) {
  const a = before || {};
  const b = after || {};
  if (!qtyMapsEqual(itemsToQtyMap(a.items), itemsToQtyMap(b.items))) return true;
  if (String(a.name || '').trim() !== String(b.name || '').trim()) return true;
  return (a.payment === 'card' ? 'card' : 'cash') !== (b.payment === 'card' ? 'card' : 'cash');
}

/**
 * "Take £5.00 more" / "Refund £5.00 on the card machine" / "No payment change"
 * (CLAUDE.md Phase V 2 and design/OrderChangesRules.dc.html). The app never
 * moves money: this is a line for the volunteer at the till.
 */
export function paymentChangeText(delta, payment) {
  const d = Math.round(Number(delta) || 0);
  const card = payment === 'card';
  if (d > 0) return card ? `Take ${formatPence(d)} more on the card machine` : `Take ${formatPence(d)} more`;
  if (d < 0) return card ? `Refund ${formatPence(-d)} on the card machine` : `Give back ${formatPence(-d)}`;
  return EDIT_NO_PAYMENT_CHANGE;
}

/** The whole `edit-delta` line: its words and the tone to paint it in. */
export function editPrompt({ changed = false, delta = 0, payment = 'card' } = {}) {
  if (!changed) return { text: EDIT_NO_CHANGES, tone: 'none' };
  const d = Math.round(Number(delta) || 0);
  return { text: paymentChangeText(d, payment), tone: d > 0 ? 'up' : (d < 0 ? 'down' : 'same') };
}

/** "Give back £15.00 cash" / "Refund £15.00 on the card machine" (Phase V 3). */
export function refundText(total, payment) {
  const amount = formatPence(Math.abs(Math.round(Number(total) || 0)));
  return payment === 'card' ? `Refund ${amount} on the card machine` : `Give back ${amount} cash`;
}

/** "A-041 updated. Take £5.00 more." */
export function editToastText(orderNo, delta, payment) {
  return `${orderNo} updated. ${paymentChangeText(delta, payment)}.`;
}

/** "A-041 cancelled. Give back £15.00 cash." */
export function cancelToastText(orderNo, total, payment) {
  return `${orderNo} cancelled. ${refundText(total, payment)}.`;
}

/** The order moved on while the panel was open (CLAUDE.md Phase V 2). */
export function editBlockedMessage(orderNo, status) {
  return `${orderNo} is now ${statusLabel(status)}, so it can't be edited. Cancel it or start a new order.`;
}

/** The order is past cancelling (CLAUDE.md Phase V 3). */
export function cancelBlockedMessage(orderNo, status) {
  return `${orderNo} was already ${statusLabel(status).toLowerCase()}`;
}

/** "Was 2× Momo, 1× Papri Chat, £15.00, Cash" for the edit banner. */
export function orderWasText(order) {
  const o = order || {};
  return `${orderSummary(o)}, ${formatPence(orderAmount(o))}, ${paymentLabel(o.payment)}`;
}

/* ------------------------------------------------------------- history */

/** One `history` row. `before` is the order as it stood before this change. */
export function buildHistoryEntry({ atMs, action, till, fromStatus, reason, before, deltaPence }) {
  const entry = {
    atMs: Math.round(Number(atMs) || 0),
    action: action === 'cancel' ? 'cancel' : 'edit',
    till: String(till || ''),
    fromStatus: String(fromStatus || 'new'),
    before: {
      items: Array.isArray(before && before.items) ? before.items : [],
      total: Math.round(Number(before && before.total) || 0),
      name: String((before && before.name) || 'Guest'),
      payment: (before && before.payment) === 'card' ? 'card' : 'cash'
    },
    deltaPence: Math.round(Number(deltaPence) || 0)
  };
  if (reason) entry.reason = String(reason);
  return entry;
}

/** Append and keep the last ten (CLAUDE.md Phase V 6). */
export function appendHistory(history, entry, max = HISTORY_MAX) {
  const rows = (Array.isArray(history) ? history.filter(Boolean) : []).concat([entry]);
  return rows.slice(Math.max(0, rows.length - max));
}

/** Has this order been edited at least once? */
export function isEdited(order) {
  return Number(order && order.editCount) > 0;
}

/** The items as they stood before the most recent edit, or null. */
export function lastChangeBefore(order) {
  const entries = (Array.isArray(order && order.history) ? order.history : [])
    .filter((h) => h && h.action === 'edit' && h.before);
  if (!entries.length) return null;
  const last = entries[entries.length - 1];
  return Array.isArray(last.before.items) ? last.before.items : [];
}

/* -------------------------------------------------- food counter cards */

/**
 * What the food counter should paint for this order (CLAUDE.md Phase V 4):
 *   'cancelled' red "STOP MAKING" card, waiting for Remove
 *   'changed'   amber "ORDER CHANGED" card, waiting for Got it
 *   'tagged'    an ordinary New card with a small "Changed" tag
 *   'plain'     an ordinary card
 *   'gone'      not on the board at all
 */
export function kitchenCardState(order) {
  const o = order || {};
  if (o.status === 'cancelled') {
    const from = o.cancelledFrom;
    const cleared = Number(o.kitchenClearedAtMs) > 0;
    return (from === 'preparing' || from === 'ready') && !cleared ? 'cancelled' : 'gone';
  }
  if (o.status === 'preparing' && Number(o.editedAtMs || 0) > Number(o.changeSeenAtMs || 0)) return 'changed';
  if (o.status === 'new' && isEdited(o)) return 'tagged';
  return 'plain';
}

/** The column a card belongs in: its status, or where it was when cancelled. */
export function kitchenColumnOf(order) {
  const o = order || {};
  if (o.status === 'cancelled') return o.cancelledFrom || null;
  return o.status || null;
}

/** "Changed at till A, 1 min ago." */
export function kitchenChangeNote(order, nowMs = Date.now()) {
  const o = order || {};
  const till = o.history && o.history.length
    ? (o.history[o.history.length - 1].till || o.till || 'A')
    : (o.till || 'A');
  const mins = ageMinutes(o.editedAtMs, nowMs);
  return `Changed at till ${till}, ${mins === 0 ? 'just now' : `${mins} min ago`}.`;
}

/** "Cancelled by cash counter, till A: Customer changed mind." */
export function kitchenCancelNote(order) {
  const o = order || {};
  const entries = (Array.isArray(o.history) ? o.history : []).filter((h) => h && h.action === 'cancel');
  const till = entries.length ? (entries[entries.length - 1].till || o.till || 'A') : (o.till || 'A');
  const reason = cancelReasonLabel(o.cancelReason);
  return `Cancelled by cash counter, till ${till}${reason ? `: ${reason}` : ''}.`;
}

/* ------------------------------------------- Changes list (orders report) */

/**
 * Each change on the order, oldest first, with the items and total either
 * side of it. The "after" of one entry is the "before" of the next, and the
 * last entry's "after" is the order as it stands now (CLAUDE.md Phase V 5).
 */
export function orderChanges(order) {
  const o = order || {};
  const entries = (Array.isArray(o.history) ? o.history : []).filter((h) => h && h.before);
  const now = {
    items: Array.isArray(o.items) ? o.items : [],
    total: orderAmount(o),
    name: o.name || 'Guest',
    payment: o.payment === 'card' ? 'card' : 'cash'
  };
  return entries.map((h, i) => {
    const next = entries[i + 1];
    const after = next ? next.before : now;
    const beforeTotal = Math.round(Number(h.before.total) || orderTotal(h.before.items));
    const afterTotal = Math.round(Number(after.total) || orderTotal(after.items));
    const atMs = Math.round(Number(h.atMs) || 0);
    const action = h.action === 'cancel' ? 'cancel' : 'edit';
    return {
      atMs,
      time: formatClock(atMs),
      action,
      till: h.till || o.till || '',
      reason: h.reason || '',
      reasonLabel: cancelReasonLabel(h.reason),
      beforeItems: h.before.items || [],
      afterItems: action === 'cancel' ? (h.before.items || []) : (after.items || []),
      beforeTotal,
      afterTotal: action === 'cancel' ? beforeTotal : afterTotal,
      beforeSummary: orderSummary({ items: h.before.items || [] }),
      afterSummary: orderSummary({ items: action === 'cancel' ? (h.before.items || []) : (after.items || []) }),
      delta: action === 'cancel' ? 0 : editDelta(beforeTotal, afterTotal),
      label: action === 'cancel' ? 'Cancelled' : 'Edited',
      // Phase VI: the Changes boxes in the order history detail want the
      // status the order was in and one finished sentence per line.
      fromStatus: h.fromStatus || '',
      fromStatusLabel: h.fromStatus ? statusLabel(h.fromStatus) : '',
      head: changeHeadText(h, o),
      beforeText: `${orderSummary({ items: h.before.items || [] }) || '\u2014'} \u00b7 ${formatPence(beforeTotal)}`,
      afterText: action === 'cancel'
        ? `${orderSummary({ items: h.before.items || [] }) || '\u2014'} \u00b7 ${formatPence(beforeTotal)}`
        : `${orderSummary({ items: (after.items || []) }) || '\u2014'} \u00b7 ${formatPence(afterTotal)}`,
      money: action === 'cancel'
        ? refundText(beforeTotal, h.before.payment)
        : changeMoneyText(editDelta(beforeTotal, afterTotal))
    };
  });
}

/** "Edited 15:13 at till A while Preparing" (CLAUDE.md Phase VI 7). */
function changeHeadText(entry, order) {
  const label = entry.action === 'cancel' ? 'Cancelled' : 'Edited';
  const time = formatClock(Math.round(Number(entry.atMs) || 0));
  const till = entry.till || (order && order.till) || '';
  const status = entry.fromStatus ? statusLabel(entry.fromStatus) : '';
  return `${label} ${time}`
    + (till ? ` at till ${till}` : '')
    + (status ? ` while ${status}` : '');
}

/**
 * The money line in a Changes box: "Took £5.00 more", "Gave back £5.00" or
 * "No payment change". Past tense, because history is read-only: the money
 * moved at the till when the edit was made (CLAUDE.md Phase VI 7).
 */
export function changeMoneyText(delta) {
  const d = Math.round(Number(delta) || 0);
  if (d > 0) return `Took ${formatPence(d)} more`;
  if (d < 0) return `Gave back ${formatPence(-d)}`;
  return EDIT_NO_PAYMENT_CHANGE;
}

/* =========================================================================
   Phase VI (v1.5.0): Order history
   Read-only helpers behind #/reports/history (CLAUDE.md Phase VI,
   design/ReportsHistory.dc.html and design/ReportsHistoryMobile.dc.html).
   Nothing here writes: history looks at orders exactly as they are stored.
   ========================================================================= */

/** A year and a day, so a whole leap year can be asked for in one go. */
export const HISTORY_MAX_DAYS = 366;
export const HISTORY_TOO_LONG_MESSAGE = 'Pick 366 days or fewer';
export const HISTORY_EMPTY_MESSAGE = 'No orders match these filters.';
export const HISTORY_LOADING_MESSAGE = 'Loading orders…';
export const HISTORY_ERROR_MESSAGE = 'Couldn’t load orders. Check the connection and tap Refresh.';
export const HISTORY_LARGE_MESSAGE = 'Large range: narrow it to load faster';

/** Reads stay one per order, so a very wide range is flagged, not blocked. */
export const HISTORY_LARGE_COUNT = 5000;

/**
 * Should the "Large range: narrow it to load faster" note show? Driven by the
 * number of orders loaded in the range, so it is testable without seeding
 * five thousand documents (CLAUDE.md Phase VI 9).
 */
export function isLargeHistory(count) {
  return Math.round(Number(count) || 0) > HISTORY_LARGE_COUNT;
}

/** The list shows this many orders, then "Show 100 more" (CLAUDE.md Phase VI 6). */
export const HISTORY_PAGE_SIZE = 100;

/** Status chips: All, Collected, Cancelled, Not finished (Phase VI 4). */
export const HISTORY_STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'collected', label: 'Collected' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'open', label: 'Not finished' }
];

/** Payment chips, the same three as the orders list. */
export const HISTORY_PAY_FILTERS = ORDER_PAY_FILTERS;

/** Every filter at rest. `order` is the selected document id, not an order number. */
export const HISTORY_DEFAULTS = {
  status: 'all', pay: 'all', till: 'all', item: 'all', edited: false, q: '', order: null
};

/**
 * Tidy a From/To pair for the history screen: swap when To is before From,
 * then enforce the 366-day maximum (CLAUDE.md Phase VI 2). A range that is
 * too long is reported and never queried.
 * Returns { from, to, dayCount, days, swapped, tooLong, valid, ok, error }.
 */
export function clampHistoryRange(from, to) {
  let a = isDayString(from) ? from : null;
  let b = isDayString(to) ? to : null;
  if (!a && !b) {
    return {
      from: '', to: '', days: [], dayCount: 0, swapped: false,
      tooLong: false, valid: false, ok: false, error: 'Pick a From and To date'
    };
  }
  if (!a) a = b;
  if (!b) b = a;
  let swapped = false;
  if (dayDiff(a, b) < 0) { const t = a; a = b; b = t; swapped = true; }
  const dayCount = rangeLength(a, b);
  const tooLong = dayCount > HISTORY_MAX_DAYS;
  return {
    from: a,
    to: b,
    days: tooLong ? [] : listDays(a, b),
    dayCount,
    swapped,
    tooLong,
    valid: !tooLong,
    ok: !tooLong,
    error: tooLong ? HISTORY_TOO_LONG_MESSAGE : null
  };
}

/** Quick range "Last 30 days", ending today. */
export function last30Range(today = dayString()) {
  const end = isDayString(today) ? today : dayString();
  return { from: addDays(end, -29), to: end };
}

/** Quick range "This year": 1 January to today. */
export function yearRange(today = dayString()) {
  const end = isDayString(today) ? today : dayString();
  return { from: `${end.slice(0, 4)}-01-01`, to: end };
}

/** "Sun 18 Oct 2026", the day heading in the history list. */
export function formatDayFull(day) {
  return isDayString(day) ? `${weekdayShort(day)} ${formatDayLong(day)}` : '';
}

/** Does this order contain at least one unit of the given item id? */
export function orderHasItem(order, itemId) {
  if (!itemId || itemId === 'all') return true;
  const items = Array.isArray(order && order.items) ? order.items : [];
  return items.some((line) => line && line.id === itemId && Math.round(Number(line.qty) || 0) > 0);
}

/**
 * The history filters, all of them client-side (CLAUDE.md Phase VI 4).
 * Cancelled orders pass like any other; they are only left out of the money.
 */
export function filterHistory(orders, options = {}) {
  const status = options.status || 'all';
  const pay = options.pay || options.payment || 'all';
  const till = options.till || 'all';
  const item = options.item || 'all';
  const edited = options.edited === true || options.edited === '1' || options.edited === 'true';
  const q = String(options.q === null || options.q === undefined ? '' : options.q).trim().toLowerCase();

  return (Array.isArray(orders) ? orders.filter(Boolean) : []).filter((o) => {
    const st = o.status || 'new';
    if (status === 'open') { if (!OPEN_STATUSES.includes(st)) return false; }
    else if (status !== 'all' && st !== status) return false;
    if (pay !== 'all' && (o.payment === 'card' ? 'card' : 'cash') !== pay) return false;
    if (till !== 'all' && String(o.till || '') !== String(till)) return false;
    if (!orderHasItem(o, item)) return false;
    if (edited && !isEdited(o)) return false;
    if (!q) return true;
    const no = String(o.orderNo || '').toLowerCase();
    const name = String(o.name || '').toLowerCase();
    return no.includes(q) || name.includes(q);
  });
}

/**
 * Group orders by trading day, newest day first and newest order first inside
 * each day (CLAUDE.md Phase VI 6). Each group carries its own summary line.
 */
export function groupByDay(orders) {
  const rows = Array.isArray(orders) ? orders.filter(Boolean) : [];
  const byDay = new Map();
  for (const o of rows) {
    const day = typeof o.day === 'string' ? o.day : '';
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(o);
  }
  return Array.from(byDay.keys())
    .sort((a, b) => String(b).localeCompare(String(a)))
    .map((day) => {
      const dayRows = sortOrdersNewestFirst(byDay.get(day));
      const summary = summariseOrders(dayRows);
      return {
        day,
        label: formatDayFull(day) || day,
        orders: dayRows,
        rows: dayRows,
        count: summary.count,
        total: summary.total,
        cancelled: summary.cancelled,
        meta: summary.text
      };
    });
}

/** Every order in the list, newest first, ignoring the day grouping. */
export function flattenHistory(groups) {
  const out = [];
  for (const g of (Array.isArray(groups) ? groups : [])) out.push(...(g.orders || []));
  return out;
}

/**
 * The four summary tiles and the phone's one-line version (Phase VI 5).
 * Sales exclude cancelled orders; "cancelledValue" is the money not taken.
 */
export function historySummary(orders) {
  const rows = Array.isArray(orders) ? orders.filter(Boolean) : [];
  const live = rows.filter((o) => !isCancelled(o));
  const cancelledRows = rows.filter(isCancelled);
  const days = new Set();
  for (const o of rows) if (typeof o.day === 'string' && o.day) days.add(o.day);
  const sales = live.reduce((sum, o) => sum + orderAmount(o), 0);
  const cancelledValue = cancelledRows.reduce((sum, o) => sum + orderAmount(o), 0);
  const edited = rows.filter(isEdited).length;
  const tradingDays = days.size;
  return {
    count: rows.length,
    orders: rows.length,
    tradingDays,
    days: tradingDays,
    daysNote: `across ${tradingDays} ${tradingDays === 1 ? 'trading day' : 'trading days'}`,
    sales,
    salesText: formatPence(sales),
    cancelled: cancelledRows.length,
    cancelledValue,
    cancelledNote: `${formatPence(cancelledValue)} not taken`,
    edited,
    large: isLargeHistory(rows.length),
    text: summariseOrders(rows).text
  };
}

/** Till letters found on the loaded orders, plus "All tills" (Phase VI 4). */
export function historyTills(orders) {
  const seen = new Set();
  for (const o of (Array.isArray(orders) ? orders.filter(Boolean) : [])) {
    const till = String((o && o.till) || '').trim();
    if (till) seen.add(till);
  }
  return [{ key: 'all', label: 'All tills' }]
    .concat(Array.from(seen).sort().map((t) => ({ key: t, label: t })));
}

/**
 * "Any item" plus every menu item and any other id found on a loaded order
 * line, shown by the name stored on that line (CLAUDE.md Phase VI 4).
 */
export function historyItems(orders) {
  const out = [{ key: 'all', label: 'Any item' }];
  const seen = new Set();
  for (const m of MENU) {
    seen.add(m.id);
    out.push({ key: m.id, label: m.short || m.name || m.id });
  }
  for (const o of (Array.isArray(orders) ? orders.filter(Boolean) : [])) {
    for (const line of (Array.isArray(o.items) ? o.items.filter(Boolean) : [])) {
      if (!line.id || seen.has(line.id)) continue;
      seen.add(line.id);
      out.push({ key: line.id, label: line.name || line.id });
    }
  }
  return out;
}

/** How many filters are on, for the phone "Filters (2)" button (Phase VI 4). */
export function historyFilterCount(state = {}) {
  let n = 0;
  if (state.status && state.status !== 'all') n += 1;
  if ((state.pay || state.payment) && (state.pay || state.payment) !== 'all') n += 1;
  if (state.till && state.till !== 'all') n += 1;
  if (state.item && state.item !== 'all') n += 1;
  if (state.edited) n += 1;
  return n;
}

/** "Cancelled 15:19 · Out of stock · was Preparing"; '' when not cancelled. */
export function historyCancelLine(order) {
  const o = order || {};
  if (o.status !== 'cancelled') return '';
  const reason = cancelReasonLabel(o.cancelReason);
  const from = o.cancelledFrom ? statusLabel(o.cancelledFrom) : '';
  return `Cancelled ${formatClock(o.cancelledAtMs)}`
    + (reason ? ` · ${reason}` : '')
    + (from ? ` · was ${from}` : '');
}

/** Only the edit entries of an order's history, for the Changes section. */
export function historyEdits(order) {
  return orderChanges(order).filter((c) => c.action === 'edit');
}

/* ------------------------------------------------------- hash round trip */

const HISTORY_ROUTE = '/reports/history';

/**
 * The screen's whole state as a hash (CLAUDE.md Phase VI 2), so a link opens
 * the same view. Defaults are left out to keep the link short and readable.
 */
export function historyHash(state = {}) {
  const params = new URLSearchParams();
  if (isDayString(state.from)) params.set('from', state.from);
  if (isDayString(state.to)) params.set('to', state.to);
  const status = state.status || 'all';
  const pay = state.pay || state.payment || 'all';
  const till = state.till || 'all';
  const item = state.item || 'all';
  const q = String(state.q === null || state.q === undefined ? '' : state.q).trim();
  if (status !== 'all') params.set('status', status);
  if (pay !== 'all') params.set('pay', pay);
  if (till !== 'all') params.set('till', till);
  if (item !== 'all') params.set('item', item);
  if (state.edited) params.set('edited', '1');
  if (q) params.set('q', q);
  if (state.order) params.set('order', String(state.order));
  const query = params.toString();
  return '#' + HISTORY_ROUTE + (query ? '?' + query : '');
}

const HISTORY_STATUS_KEYS = HISTORY_STATUS_FILTERS.map((s) => s.key);
const HISTORY_PAY_KEYS = ORDER_PAY_FILTERS.map((p) => p.key);

/**
 * Read a history hash back. Accepts the whole hash ("#/reports/history?…"),
 * the path and query, a bare query string or a URLSearchParams. Anything
 * unusable falls back to the default for that field, so a hand-typed or
 * truncated link still opens a working screen.
 */
export function parseHistoryHash(hash) {
  let params;
  if (hash instanceof URLSearchParams) {
    params = hash;
  } else {
    const raw = String(hash === null || hash === undefined ? '' : hash);
    const i = raw.indexOf('?');
    params = new URLSearchParams(i === -1 ? (raw.includes('=') ? raw : '') : raw.slice(i + 1));
  }
  const get = (key) => {
    const value = params.get(key);
    return value === null ? '' : value;
  };
  const status = get('status');
  const pay = get('pay');
  const from = get('from');
  const to = get('to');
  const order = get('order');
  const edited = get('edited');
  return {
    from: isDayString(from) ? from : '',
    to: isDayString(to) ? to : '',
    status: HISTORY_STATUS_KEYS.includes(status) ? status : 'all',
    pay: HISTORY_PAY_KEYS.includes(pay) ? pay : 'all',
    till: get('till') || 'all',
    item: get('item') || 'all',
    edited: edited === '1' || edited === 'true',
    q: get('q'),
    order: order || null
  };
}

/** "nba-food-stall_history_2026-10-14_2026-10-20.csv" (CLAUDE.md Phase VI 8). */
export function historyCsvFilename(from, to) {
  return `nba-food-stall_history_${from}_${to}.csv`;
}

/** The history export: the same columns as the orders list export. */
export const historyToCsv = exportOrdersCsv;
