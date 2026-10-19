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
  { id: 'marshmallow', name: 'Chocolate Marshmallow (V)', short: 'Choc Marshmallow', price: 500, colour: '#FBCFE8', station: 'sweets', active: true, sort: 7 }
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

/** The CSV lines for one order: one row per order line, already escaped. */
function csvRowsForOrder(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  const createdAt = isoOrBlank(o.createdAtMs);
  const readyAt = isoOrBlank(o.readyAtMs);
  const waitSeconds = (Number(o.readyAtMs) && Number(o.createdAtMs) && Number(o.readyAtMs) >= Number(o.createdAtMs))
    ? String(Math.round((Number(o.readyAtMs) - Number(o.createdAtMs)) / 1000))
    : '';
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
      waitSeconds
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
  const step = (key, label, ms) => {
    const n = Number(ms);
    const reached = Number.isFinite(n) && n > 0;
    return { key, label, ms: reached ? n : null, time: reached ? formatClock(n) : '—', reached };
  };
  if (o.status === 'cancelled') {
    return [step('placed', 'Placed', orderTimeMs(o)), step('cancelled', 'Cancelled', o.cancelledAtMs)];
  }
  return [
    step('placed', 'Placed', orderTimeMs(o)),
    step('started', 'Started', o.startedAtMs),
    step('ready', 'Ready', o.readyAtMs),
    step('collected', 'Collected', o.collectedAtMs)
  ];
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
