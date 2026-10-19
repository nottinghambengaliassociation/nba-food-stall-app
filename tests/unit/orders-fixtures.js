// Phase IV fixture: one scripted trading day for the Orders list and the
// order detail (CLAUDE.md "Phase IV: Orders list and order detail").
// Hand-calculated expectations live in qa/test-plan.md section 32; every
// figure below is a literal, worked out from the table there, not computed.
//
// Every item is £5 (500p). 17 Oct 2026 is inside British Summer Time, so
// Europe/London is UTC+1 and a wall-clock hour h is Date.UTC(..., h - 1).
// The shape mirrors tests/e2e/helpers.js -> ordersFixture / ordersExpect, so
// the unit and the end-to-end figures are the same figures.

export const DAY = '2026-10-17';
export const PREV_DAY = '2026-10-16';

/** Epoch ms for a Europe/London wall-clock time on a BST day. */
export function bstMs(day, hour, minute = 0) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour - 1, minute);
}

const line = (id, name, qty) => ({ id, name, qty, price: 500 });
const t = (h, m) => bstMs(DAY, h, m);

/**
 * The scripted day. Deliberately contains every status including one
 * cancelled order, two tills, a cash/card mix, two orders on retired menu ids
 * (one still carrying the Phase I `tendered` field) and one order on the
 * previous day that a `day == DAY` query must never return.
 */
export const DAY_ORDERS = [
  { orderNo: 'A-010', name: 'Josh', till: 'A', day: DAY, payment: 'cash', status: 'collected', tendered: 2000,
    items: [line('samosa', 'Sweets Box Samosa / Shingara', 2)], total: 1000,
    createdAtMs: t(9, 30), startedAtMs: t(9, 31), readyAtMs: t(9, 34), collectedAtMs: t(9, 35) },

  { orderNo: 'A-011', name: 'Rina', till: 'A', day: DAY, payment: 'card', status: 'collected',
    items: [line('straw', 'Chocolate Strawberry & Marshmallow (V)', 1)], total: 500,
    createdAtMs: t(9, 40), startedAtMs: t(9, 41), readyAtMs: t(9, 43), collectedAtMs: t(9, 44) },

  { orderNo: 'A-040', name: 'Lucy', till: 'A', day: DAY, payment: 'cash', status: 'collected',
    items: [line('sweet_box', 'Sweet Box', 2), line('samosa_only', 'Samosa', 1)], total: 1500,
    createdAtMs: t(10, 5), startedAtMs: t(10, 6), readyAtMs: t(10, 9), collectedAtMs: t(10, 10) },

  { orderNo: 'A-041', name: 'Priya', till: 'A', day: DAY, payment: 'cash', status: 'collected',
    items: [line('fuchka', 'Fuchka / Gol Gappa', 2), line('momo', 'Momo', 1)], total: 1500,
    createdAtMs: t(10, 12), startedAtMs: t(10, 13), readyAtMs: t(10, 16), collectedAtMs: t(10, 17) },

  { orderNo: 'B-017', name: 'Tom', till: 'B', day: DAY, payment: 'card', status: 'collected',
    items: [line('fuchka', 'Fuchka / Gol Gappa', 3)], total: 1500,
    createdAtMs: t(10, 20), startedAtMs: t(10, 22), readyAtMs: t(10, 25), collectedAtMs: t(10, 26) },

  { orderNo: 'A-042', name: 'Sam', till: 'A', day: DAY, payment: 'card', status: 'ready',
    items: [line('fuchka', 'Fuchka / Gol Gappa', 1), line('choc_strawberry', 'Chocolate Strawberry', 1)], total: 1000,
    createdAtMs: t(10, 30), startedAtMs: t(10, 31), readyAtMs: t(10, 35) },

  { orderNo: 'A-043', name: 'Meera', till: 'A', day: DAY, payment: 'cash', status: 'preparing',
    items: [line('fountain', 'Chocolate Fountain', 1), line('sweet_box', 'Sweet Box', 1)], total: 1000,
    createdAtMs: t(10, 40), startedAtMs: t(10, 42) },

  { orderNo: 'B-019', name: 'Ahmed', till: 'B', day: DAY, payment: 'cash', status: 'new',
    items: [line('momo', 'Momo', 2), line('chat', 'Papri Chat', 1)], total: 1500,
    createdAtMs: t(10, 50) },

  { orderNo: 'A-044', name: 'Guest', till: 'A', day: DAY, payment: 'card', status: 'cancelled',
    items: [line('samosa_only', 'Samosa', 2)], total: 1000,
    createdAtMs: t(10, 55), cancelledAtMs: t(10, 56) }
];

/** One order on the day before: proves the list is a single-day query. */
export const PREV_DAY_ORDER = {
  orderNo: 'A-900', name: 'Yesterday', till: 'A', day: PREV_DAY, payment: 'cash', status: 'collected',
  items: [line('fuchka', 'Fuchka / Gol Gappa', 1)], total: 500,
  createdAtMs: bstMs(PREV_DAY, 12, 0), startedAtMs: bstMs(PREV_DAY, 12, 1),
  readyAtMs: bstMs(PREV_DAY, 12, 3), collectedAtMs: bstMs(PREV_DAY, 12, 4)
};

/** Newest first by createdAtMs (CLAUDE.md Phase IV 5). */
export const NEWEST_FIRST = ['A-044', 'B-019', 'A-043', 'A-042', 'B-017', 'A-041', 'A-040', 'A-011', 'A-010'];

/**
 * Every filter combination, hand-calculated.
 * `rows` is newest first; `total` is pence over the non-cancelled rows only
 * (CLAUDE.md Phase IV 3, 4); `cancelled` is how many of `rows` are cancelled.
 */
export const EXPECTED_FILTERS = [
  { label: 'no filters', args: {}, rows: NEWEST_FIRST, total: 9500, cancelled: 1 },
  { label: 'status all', args: { status: 'all' }, rows: NEWEST_FIRST, total: 9500, cancelled: 1 },
  { label: 'status new', args: { status: 'new' }, rows: ['B-019'], total: 1500, cancelled: 0 },
  { label: 'status preparing', args: { status: 'preparing' }, rows: ['A-043'], total: 1000, cancelled: 0 },
  { label: 'status ready', args: { status: 'ready' }, rows: ['A-042'], total: 1000, cancelled: 0 },
  { label: 'status collected', args: { status: 'collected' }, rows: ['B-017', 'A-041', 'A-040', 'A-011', 'A-010'], total: 6000, cancelled: 0 },
  { label: 'status cancelled', args: { status: 'cancelled' }, rows: ['A-044'], total: 0, cancelled: 1 },
  { label: 'pay all', args: { pay: 'all' }, rows: NEWEST_FIRST, total: 9500, cancelled: 1 },
  { label: 'pay cash', args: { pay: 'cash' }, rows: ['B-019', 'A-043', 'A-041', 'A-040', 'A-010'], total: 6500, cancelled: 0 },
  { label: 'pay card', args: { pay: 'card' }, rows: ['A-044', 'A-042', 'B-017', 'A-011'], total: 3000, cancelled: 1 },
  { label: 'search by order number', args: { q: 'a-04' }, rows: ['A-044', 'A-043', 'A-042', 'A-041', 'A-040'], total: 5000, cancelled: 1 },
  { label: 'search by order number, upper case', args: { q: 'A-04' }, rows: ['A-044', 'A-043', 'A-042', 'A-041', 'A-040'], total: 5000, cancelled: 1 },
  { label: 'search by till letter prefix', args: { q: 'b-0' }, rows: ['B-019', 'B-017'], total: 3000, cancelled: 0 },
  { label: 'search by name', args: { q: 'Priya' }, rows: ['A-041'], total: 1500, cancelled: 0 },
  { label: 'search by name, lower case', args: { q: 'priya' }, rows: ['A-041'], total: 1500, cancelled: 0 },
  { label: 'search by name, upper case', args: { q: 'PRIYA' }, rows: ['A-041'], total: 1500, cancelled: 0 },
  { label: 'search by part of a name', args: { q: 'eer' }, rows: ['A-043'], total: 1000, cancelled: 0 },
  { label: 'search trimmed', args: { q: '   priya  ' }, rows: ['A-041'], total: 1500, cancelled: 0 },
  { label: 'search matching nothing', args: { q: 'zzz' }, rows: [], total: 0, cancelled: 0 },
  { label: 'blank search matches everything', args: { q: '   ' }, rows: NEWEST_FIRST, total: 9500, cancelled: 1 },
  { label: 'status + pay', args: { status: 'collected', pay: 'cash' }, rows: ['A-041', 'A-040', 'A-010'], total: 4000, cancelled: 0 },
  { label: 'status + pay + search', args: { status: 'collected', pay: 'cash', q: 'a-0' }, rows: ['A-041', 'A-040', 'A-010'], total: 4000, cancelled: 0 },
  { label: 'cancelled + card', args: { status: 'cancelled', pay: 'card' }, rows: ['A-044'], total: 0, cancelled: 1 },
  { label: 'cancelled + cash finds nothing', args: { status: 'cancelled', pay: 'cash' }, rows: [], total: 0, cancelled: 0 }
];

/** The items column, "2× Fuchka, 1× Momo" in menu `short` names. */
export const EXPECTED_SUMMARIES = {
  'A-041': '2× Fuchka, 1× Momo',
  'A-040': '2× Sweet Box, 1× Samosa',
  'B-019': '2× Momo, 1× Papri Chat',
  'A-042': '1× Fuchka, 1× Choc Strawberry',
  'A-043': '1× Choc Fountain, 1× Sweet Box',
  'B-017': '3× Fuchka',
  'A-044': '2× Samosa'
};

/** Wait, placed to ready (CLAUDE.md Phase IV 5). null means "—". */
export const EXPECTED_WAIT = {
  'A-010': 4, 'A-011': 3, 'A-040': 4, 'A-041': 4, 'B-017': 5,
  'A-042': 5, 'A-043': null, 'B-019': null, 'A-044': null
};

export const order = (no) => DAY_ORDERS.find((o) => o.orderNo === no);
