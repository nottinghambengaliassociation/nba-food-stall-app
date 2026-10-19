// Phase III fixture: a scripted week of trading, hand-calculated in
// qa/test-plan.md section 27. Five trading days inside a seven-day range, so
// the two quiet days prove "only days with at least one order appear"
// (CLAUDE.md Phase III 4).
//
// Every item is £5 (500p). 13–19 Oct 2026 is inside British Summer Time, so
// Europe/London is UTC+1 and a wall-clock hour h is Date.UTC(..., h - 1).

export const RANGE_FROM = '2026-10-13'; // Tue
export const RANGE_TO = '2026-10-19';   // Mon

export const D = {
  tue: '2026-10-13',
  wed: '2026-10-14',
  thu: '2026-10-15', // no orders
  fri: '2026-10-16',
  sat: '2026-10-17',
  sun: '2026-10-18', // no orders
  mon: '2026-10-19'
};

export const TRADING_DAYS = [D.tue, D.wed, D.fri, D.sat, D.mon];
export const QUIET_DAYS = [D.thu, D.sun];

const P = 500;
const line = (id, name, qty) => ({ id, name, qty, price: P });

/** Epoch ms for a Europe/London wall-clock time on a day string in BST. */
export function bstMs(day, hour, minute = 0) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour - 1, minute);
}

/**
 * The scripted range. Deliberately contains:
 *  - a cancelled order (Wed) that must not reach any figure;
 *  - a Phase I order carrying the legacy `tendered` field (Fri), which the
 *    whole of Phase III ignores (CLAUDE.md Phase III 10);
 *  - retired menu ids `samosa` and `straw` (Fri), which must still report
 *    under their original names (Hotfix H1 6).
 */
export const RANGE_ORDERS = [
  // --- Tue 13 Oct: 2 orders, 3 items, £15.00 (cash £10.00, card £5.00)
  {
    orderNo: 'A-001', name: 'Priya', till: 'A', day: D.tue,
    items: [line('fuchka', 'Fuchka / Gol Gappa', 2)],
    total: 1000, payment: 'cash', status: 'collected',
    createdAtMs: bstMs(D.tue, 11, 0), readyAtMs: bstMs(D.tue, 11, 2)
  },
  {
    orderNo: 'A-002', name: 'Sam', till: 'A', day: D.tue,
    items: [line('momo', 'Momo', 1)],
    total: 500, payment: 'card', status: 'collected',
    createdAtMs: bstMs(D.tue, 11, 20), readyAtMs: bstMs(D.tue, 11, 25)
  },

  // --- Wed 14 Oct: 2 live orders, 5 items, £25.00, plus one CANCELLED order
  {
    orderNo: 'B-001', name: 'Ahmed', till: 'B', day: D.wed,
    items: [line('chat', 'Papri Chat', 3)],
    total: 1500, payment: 'cash', status: 'collected',
    createdAtMs: bstMs(D.wed, 12, 5), readyAtMs: bstMs(D.wed, 12, 10)
  },
  {
    orderNo: 'B-002', name: 'Lucy', till: 'B', day: D.wed,
    items: [line('sweet_box', 'Sweet Box', 1), line('marshmallow', 'Marshmallow (V)', 1)],
    total: 1000, payment: 'card', status: 'ready',
    createdAtMs: bstMs(D.wed, 12, 40), readyAtMs: bstMs(D.wed, 12, 45)
  },
  {
    orderNo: 'B-003', name: 'Gone', till: 'B', day: D.wed,
    items: [line('fuchka', 'Fuchka / Gol Gappa', 2)],
    total: 1000, payment: 'cash', status: 'cancelled',
    createdAtMs: bstMs(D.wed, 12, 50), cancelledAtMs: bstMs(D.wed, 12, 51)
  },

  // --- Fri 16 Oct: the legacy day. Retired ids, and `tendered` on A-010.
  {
    orderNo: 'A-010', name: 'Meera', till: 'A', day: D.fri,
    items: [line('samosa', 'Sweets Box Samosa / Shingara', 2)],
    total: 1000, payment: 'cash', status: 'collected',
    tendered: 2000,
    createdAtMs: bstMs(D.fri, 13, 0), readyAtMs: bstMs(D.fri, 13, 4)
  },
  {
    orderNo: 'A-011', name: 'Josh', till: 'A', day: D.fri,
    items: [line('straw', 'Chocolate Strawberry & Marshmallow (V)', 1)],
    total: 500, payment: 'card', status: 'collected',
    createdAtMs: bstMs(D.fri, 13, 10), readyAtMs: bstMs(D.fri, 13, 12)
  },

  // --- Sat 17 Oct: the best day. 3 orders, 16 items, £80.00
  {
    orderNo: 'A-020', name: 'Rina', till: 'A', day: D.sat,
    items: [line('fuchka', 'Fuchka / Gol Gappa', 10)],
    total: 5000, payment: 'cash', status: 'collected',
    createdAtMs: bstMs(D.sat, 14, 0), readyAtMs: bstMs(D.sat, 14, 5)
  },
  {
    orderNo: 'A-021', name: 'Dev', till: 'A', day: D.sat,
    items: [line('momo', 'Momo', 4)],
    total: 2000, payment: 'card', status: 'collected',
    createdAtMs: bstMs(D.sat, 14, 40), readyAtMs: bstMs(D.sat, 14, 44)
  },
  {
    orderNo: 'A-022', name: 'Kate', till: 'A', day: D.sat,
    items: [line('fountain', 'Chocolate Fountain', 2)],
    total: 1000, payment: 'cash', status: 'ready',
    createdAtMs: bstMs(D.sat, 15, 10), readyAtMs: bstMs(D.sat, 15, 14)
  },

  // --- Mon 19 Oct: 2 orders, 6 items, £30.00
  {
    orderNo: 'A-030', name: 'Nina', till: 'A', day: D.mon,
    items: [
      line('fuchka', 'Fuchka / Gol Gappa', 1),
      line('momo', 'Momo', 1),
      line('chat', 'Papri Chat', 1)
    ],
    total: 1500, payment: 'cash', status: 'collected',
    createdAtMs: bstMs(D.mon, 10, 0), readyAtMs: bstMs(D.mon, 10, 3)
  },
  {
    orderNo: 'A-031', name: 'Omar', till: 'A', day: D.mon,
    items: [line('choc_strawberry', 'Chocolate Strawberry', 3)],
    total: 1500, payment: 'card', status: 'new',
    createdAtMs: bstMs(D.mon, 10, 20)
  }
];

/**
 * Hand-calculated expectations. Worked out from the table above with a pen,
 * not from logic.js: every figure here is a literal.
 */
export const EXPECTED_DAYS = [
  { day: D.tue, weekday: 'Tue', date: '13 Oct', label: 'Tue 13 Oct', orders: 2, items: 3, sales: 1500, cash: 1000, card: 500, avgOrder: 750, peak: '11:00–11:30' },
  { day: D.wed, weekday: 'Wed', date: '14 Oct', label: 'Wed 14 Oct', orders: 2, items: 5, sales: 2500, cash: 1500, card: 1000, avgOrder: 1250, peak: '12:00–12:30' },
  { day: D.fri, weekday: 'Fri', date: '16 Oct', label: 'Fri 16 Oct', orders: 2, items: 3, sales: 1500, cash: 1000, card: 500, avgOrder: 750, peak: '13:00–13:30' },
  { day: D.sat, weekday: 'Sat', date: '17 Oct', label: 'Sat 17 Oct', orders: 3, items: 16, sales: 8000, cash: 6000, card: 2000, avgOrder: 2667, peak: '14:00–14:30' },
  { day: D.mon, weekday: 'Mon', date: '19 Oct', label: 'Mon 19 Oct', orders: 2, items: 6, sales: 3000, cash: 1500, card: 1500, avgOrder: 1500, peak: '10:00–10:30' }
];

export const EXPECTED_TOTALS = {
  tradingDays: 5,
  sales: 16500,        // 1500 + 2500 + 1500 + 8000 + 3000
  orders: 11,          // 2 + 2 + 2 + 3 + 2
  items: 33,           // 3 + 5 + 3 + 16 + 6
  itemsPerOrder: '3.0',
  cash: 11000,         // 1000 + 1500 + 1000 + 6000 + 1500
  card: 5500,          // 500 + 1000 + 500 + 2000 + 1500
  avgOrder: 1500,      // round(16500 / 11)
  bestDay: D.sat,
  bestSales: 8000,
  averagePerDay: 3300, // 16500 / 5
  ordersPerDay: 2      // round(11 / 5)
};

/** Rows of "Items sold by day", in MENU sort order. units keyed by day. */
export const EXPECTED_ITEMS = [
  { id: 'fuchka', name: 'Fuchka / Gol Gappa', units: { [D.tue]: 2, [D.wed]: 0, [D.fri]: 0, [D.sat]: 10, [D.mon]: 1 }, total: 13, sales: 6500, bestDay: D.sat },
  { id: 'momo', name: 'Momo', units: { [D.tue]: 1, [D.wed]: 0, [D.fri]: 0, [D.sat]: 4, [D.mon]: 1 }, total: 6, sales: 3000, bestDay: D.sat },
  { id: 'chat', name: 'Papri Chat', units: { [D.tue]: 0, [D.wed]: 3, [D.fri]: 0, [D.sat]: 0, [D.mon]: 1 }, total: 4, sales: 2000, bestDay: D.wed },
  { id: 'sweet_box', name: 'Sweet Box', units: { [D.tue]: 0, [D.wed]: 1, [D.fri]: 0, [D.sat]: 0, [D.mon]: 0 }, total: 1, sales: 500, bestDay: D.wed },
  { id: 'choc_strawberry', name: 'Chocolate Strawberry', units: { [D.tue]: 0, [D.wed]: 0, [D.fri]: 0, [D.sat]: 0, [D.mon]: 3 }, total: 3, sales: 1500, bestDay: D.mon },
  { id: 'marshmallow', name: 'Marshmallow (V)', units: { [D.tue]: 0, [D.wed]: 1, [D.fri]: 0, [D.sat]: 0, [D.mon]: 0 }, total: 1, sales: 500, bestDay: D.wed },
  { id: 'fountain', name: 'Chocolate Fountain', units: { [D.tue]: 0, [D.wed]: 0, [D.fri]: 0, [D.sat]: 2, [D.mon]: 0 }, total: 2, sales: 1000, bestDay: D.sat },
  { id: 'samosa', name: 'Sweets Box Samosa / Shingara', units: { [D.tue]: 0, [D.wed]: 0, [D.fri]: 2, [D.sat]: 0, [D.mon]: 0 }, total: 2, sales: 1000, bestDay: D.fri },
  { id: 'straw', name: 'Chocolate Strawberry & Marshmallow (V)', units: { [D.tue]: 0, [D.wed]: 0, [D.fri]: 1, [D.sat]: 0, [D.mon]: 0 }, total: 1, sales: 500, bestDay: D.fri }
];
