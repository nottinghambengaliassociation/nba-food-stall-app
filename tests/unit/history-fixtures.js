// The scripted Order history range (qa/test-plan.md section 58), with absolute
// days so every expectation below is a hand-calculated literal.
//
// Anchor T = 2026-10-20 (Tue). Every day used here is inside BST (the 2026
// clocks go back on 25 October), so London is UTC+1 throughout.
//
// The fixture deliberately contains, in one range:
//   - four trading days inside "Last 7 days" and three more inside "Last 30";
//   - the T-7 and T-30 boundaries, each with an order, so an off-by-one in the
//     range cannot hide in an empty neighbour;
//   - every status including two cancelled orders, one from `new` and one from
//     `ready` (CLAUDE.md Phase VI 7: the red box names the status before);
//   - three till letters (the Till filter is built from the loaded orders);
//   - the same order number `A-001` on three different days (Phase VI 2:
//     "Order numbers repeat across days, so every result shows its date");
//   - a Phase I order carrying `tendered` and no Phase V fields at all
//     (Phase VI 7: "Orders from before Phase V show no Changes section");
//   - an unknown item id, shown by the name stored on the line;
//   - one order edited once and one edited twice, so a Changes box has to take
//     its "after" from the next entry's "before".

export const T = '2026-10-20';

export const D = {
  t: T,                  // today
  t1: '2026-10-19',      // T-1
  t3: '2026-10-17',      // T-3
  t6: '2026-10-14',      // T-6, the first day of Last 7 days
  t7: '2026-10-13',      // T-7, one day outside it
  t13: '2026-10-07',     // T-13
  t29: '2026-09-21',     // T-29, the first day of Last 30 days
  t30: '2026-09-20',     // T-30, one day outside it
  t39: '2026-09-11'      // T-39, the oldest seeded day
};

/** Epoch ms for a London wall-clock time on a BST day. */
export function bstMs(day, hour, minute = 0) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour - 1, minute);
}

const P = 500;
const NAMES = {
  fuchka: 'Fuchka / Gol Gappa',
  momo: 'Momo',
  chat: 'Papri Chat',
  sweet_box: 'Sweet Box',
  samosa_only: 'Samosa',
  choc_strawberry: 'Chocolate Strawberry',
  marshmallow: 'Chocolate Marshmallow (V)',
  samosa_chat: 'Samosa Chat',
  fountain: 'Chocolate Fountain'   // retired in H3: not in the menu any more
};

export const line = (id, qty) => ({ id, name: NAMES[id] || id, qty, price: P });
const totalOf = (items) => items.reduce((sum, l) => sum + l.qty * l.price, 0);

/** A collected/ready order's timestamps: +2 started, +6 ready, +8 collected. */
function times(day, hour, minute, status) {
  const t = (plus) => bstMs(day, hour, minute + plus);
  const out = { createdAtMs: t(0) };
  if (status === 'new') return out;
  out.startedAtMs = t(2);
  if (status === 'preparing') return out;
  out.readyAtMs = t(6);
  if (status === 'ready') return out;
  out.collectedAtMs = t(8);
  return out;
}

function order(id, day, orderNo, hour, minute, name, till, payment, status, items, extra = {}) {
  return {
    id,
    orderNo,
    name,
    till,
    day,
    items,
    total: totalOf(items),
    payment,
    status,
    ...times(day, hour, minute, status),
    ...extra
  };
}

export const HISTORY_ORDERS = [
  order('h01', D.t, 'A-003', 13, 12, 'Ruma', 'A', 'card', 'collected', [line('samosa_chat', 2)]),

  order('h02', D.t, 'A-002', 13, 5, 'Guest', 'A', 'cash', 'cancelled', [line('momo', 1)], {
    cancelledAtMs: bstMs(D.t, 13, 9),
    cancelReason: 'mistake',
    cancelledFrom: 'new',
    history: [{
      atMs: bstMs(D.t, 13, 9), action: 'cancel', till: 'A', fromStatus: 'new', reason: 'mistake',
      before: { items: [line('momo', 1)], total: 500, name: 'Guest', payment: 'cash' }, deltaPence: 0
    }]
  }),

  order('h03', D.t, 'A-001', 12, 58, 'Arjun', 'A', 'card', 'collected',
    [line('fuchka', 1), line('samosa_chat', 1)]),

  order('h04', D.t1, 'B-012', 15, 20, 'Meera', 'B', 'card', 'ready',
    [line('momo', 1), line('sweet_box', 1)]),

  // Edited once, while Preparing, with no money difference at all.
  order('h05', D.t1, 'A-031', 15, 10, 'Ahmed', 'A', 'cash', 'collected', [line('momo', 3)], {
    editCount: 1,
    editedAtMs: bstMs(D.t1, 15, 13),
    history: [{
      atMs: bstMs(D.t1, 15, 13), action: 'edit', till: 'A', fromStatus: 'preparing',
      before: { items: [line('momo', 2), line('chat', 1)], total: 1500, name: 'Ahmed', payment: 'cash' },
      deltaPence: 0
    }]
  }),

  order('h06', D.t1, 'A-030', 15, 2, 'Priya', 'A', 'card', 'collected',
    [line('fuchka', 2), line('marshmallow', 1)]),

  order('h07', D.t3, 'A-012', 11, 40, 'Tom', 'A', 'cash', 'preparing',
    [line('samosa_only', 1), line('choc_strawberry', 1)]),

  // Cancelled after it reached Ready: the red box must say "was Ready".
  order('h08', D.t3, 'C-001', 11, 5, 'Dev', 'C', 'card', 'cancelled', [line('fuchka', 1)], {
    cancelledAtMs: bstMs(D.t3, 11, 23),
    cancelReason: 'not_collected',
    cancelledFrom: 'ready',
    history: [{
      atMs: bstMs(D.t3, 11, 23), action: 'cancel', till: 'C', fromStatus: 'ready', reason: 'not_collected',
      before: { items: [line('fuchka', 1)], total: 500, name: 'Dev', payment: 'card' }, deltaPence: 0
    }]
  }),

  order('h09', D.t6, 'A-001', 16, 40, 'Josh', 'A', 'card', 'new',
    [line('chat', 1), line('marshmallow', 2)]),

  // Edited twice: 1 -> 3 -> 2 Sweet Box, so the first box reads "Took £10.00
  // more" and the second "Gave back £5.00", and the second box's "after" is
  // the order as stored.
  {
    ...order('h10', D.t6, 'B-002', 16, 31, 'Sohini', 'B', 'cash', 'collected', [line('sweet_box', 2)]),
    startedAtMs: bstMs(D.t6, 16, 34),
    readyAtMs: bstMs(D.t6, 16, 37),
    collectedAtMs: bstMs(D.t6, 16, 39),
    editCount: 2,
    editedAtMs: bstMs(D.t6, 16, 36),
    history: [
      {
        atMs: bstMs(D.t6, 16, 33), action: 'edit', till: 'B', fromStatus: 'new',
        before: { items: [line('sweet_box', 1)], total: 500, name: 'Sohini', payment: 'cash' },
        deltaPence: 1000
      },
      {
        atMs: bstMs(D.t6, 16, 36), action: 'edit', till: 'A', fromStatus: 'preparing',
        before: { items: [line('sweet_box', 3)], total: 1500, name: 'Sohini', payment: 'cash' },
        deltaPence: -500
      }
    ]
  },

  // Phase I: carries `tendered`, and none of the Phase V fields.
  order('h11', D.t7, 'A-007', 12, 30, 'Lucy', 'A', 'cash', 'collected', [line('fuchka', 2)], {
    tendered: 2000
  }),

  order('h12', D.t13, 'B-005', 18, 5, 'Nadia', 'B', 'card', 'collected',
    [line('fountain', 1), line('momo', 1)]),

  order('h13', D.t29, 'A-050', 10, 10, 'Imran', 'A', 'cash', 'collected', [line('chat', 3)]),

  order('h14', D.t30, 'A-001', 9, 15, 'Ekta', 'A', 'card', 'collected', [line('sweet_box', 1)]),

  order('h15', D.t39, 'B-001', 19, 45, 'Raj', 'B', 'cash', 'collected', [line('momo', 2)])
];

export const byId = (id) => HISTORY_ORDERS.find((o) => o.id === id);
export const inRange = (from, to) => HISTORY_ORDERS.filter((o) => o.day >= from && o.day <= to);
export const ids = (orders) => orders.map((o) => o.id);

/* --------------------------------------------- hand-calculated expectations */

export const DEFAULT_RANGE = { from: D.t6, to: D.t };

/** The default Last 7 days view, newest day first and newest order first. */
export const DEFAULT_IDS = ['h01', 'h02', 'h03', 'h04', 'h05', 'h06', 'h07', 'h08', 'h09', 'h10'];

export const DEFAULT_SUMMARY = {
  orders: 10,
  tradingDays: 4,
  sales: 9500,
  cancelled: 2,
  cancelledValue: 1000,
  edited: 2,
  text: '10 orders · £95.00 (excludes 2 cancelled)'
};

export const DAY_GROUPS = [
  { day: D.t, label: 'Tue 20 Oct 2026', ids: ['h01', 'h02', 'h03'], meta: '3 orders · £20.00 (excludes 1 cancelled)' },
  { day: D.t1, label: 'Mon 19 Oct 2026', ids: ['h04', 'h05', 'h06'], meta: '3 orders · £40.00' },
  { day: D.t3, label: 'Sat 17 Oct 2026', ids: ['h07', 'h08'], meta: '2 orders · £10.00 (excludes 1 cancelled)' },
  { day: D.t6, label: 'Wed 14 Oct 2026', ids: ['h09', 'h10'], meta: '2 orders · £25.00' }
];

/** Every filter, over the default range. Sales exclude cancelled orders. */
export const FILTER_CASES = [
  { label: 'none', options: {}, ids: DEFAULT_IDS, sales: 9500, cancelled: 2 },
  { label: 'status collected', options: { status: 'collected' }, ids: ['h01', 'h03', 'h05', 'h06', 'h10'], sales: 6000, cancelled: 0 },
  { label: 'status cancelled', options: { status: 'cancelled' }, ids: ['h02', 'h08'], sales: 0, cancelled: 2 },
  { label: 'status not finished', options: { status: 'open' }, ids: ['h04', 'h07', 'h09'], sales: 3500, cancelled: 0 },
  { label: 'pay cash', options: { pay: 'cash' }, ids: ['h02', 'h05', 'h07', 'h10'], sales: 3500, cancelled: 1 },
  { label: 'pay card', options: { pay: 'card' }, ids: ['h01', 'h03', 'h04', 'h06', 'h08', 'h09'], sales: 6000, cancelled: 1 },
  { label: 'till A', options: { till: 'A' }, ids: ['h01', 'h02', 'h03', 'h05', 'h06', 'h07', 'h09'], sales: 7500, cancelled: 1 },
  { label: 'till B', options: { till: 'B' }, ids: ['h04', 'h10'], sales: 2000, cancelled: 0 },
  { label: 'till C', options: { till: 'C' }, ids: ['h08'], sales: 0, cancelled: 1 },
  { label: 'item momo', options: { item: 'momo' }, ids: ['h02', 'h04', 'h05'], sales: 2500, cancelled: 1 },
  { label: 'item samosa_chat', options: { item: 'samosa_chat' }, ids: ['h01', 'h03'], sales: 2000, cancelled: 0 },
  { label: 'edited only', options: { edited: true }, ids: ['h05', 'h10'], sales: 2500, cancelled: 0 },
  { label: 'search a-00', options: { q: 'a-00' }, ids: ['h01', 'h02', 'h03', 'h09'], sales: 3500, cancelled: 1 },
  { label: 'search a-001', options: { q: 'a-001' }, ids: ['h03', 'h09'], sales: 2500, cancelled: 0 },
  { label: 'search ahmed', options: { q: 'ahmed' }, ids: ['h05'], sales: 1500, cancelled: 0 },
  { label: 'search AHMED', options: { q: 'AHMED' }, ids: ['h05'], sales: 1500, cancelled: 0 },
  { label: 'search padded', options: { q: '  ahmed  ' }, ids: ['h05'], sales: 1500, cancelled: 0 },
  { label: 'search zzz', options: { q: 'zzz' }, ids: [], sales: 0, cancelled: 0 },
  { label: 'search by item name', options: { q: 'fuchka' }, ids: [], sales: 0, cancelled: 0 },
  { label: 'collected + cash + till A', options: { status: 'collected', pay: 'cash', till: 'A' }, ids: ['h05'], sales: 1500, cancelled: 0 },
  { label: 'not finished + card', options: { status: 'open', pay: 'card' }, ids: ['h04', 'h09'], sales: 2500, cancelled: 0 },
  { label: 'cancelled + till B', options: { status: 'cancelled', till: 'B' }, ids: [], sales: 0, cancelled: 0 }
];

/** Quick ranges, hand-counted against the table above. */
export const RANGE_CASES = [
  { label: 'today', from: D.t, to: D.t, ids: ['h01', 'h02', 'h03'], sales: 2000, cancelled: 1, days: 1 },
  { label: 'last 7 days', from: D.t6, to: D.t, ids: DEFAULT_IDS, sales: 9500, cancelled: 2, days: 4 },
  {
    label: 'last 30 days', from: D.t29, to: D.t,
    ids: DEFAULT_IDS.concat(['h11', 'h12', 'h13']), sales: 13000, cancelled: 2, days: 7
  },
  { label: 'this event', from: D.t3, to: D.t1, ids: ['h04', 'h05', 'h06', 'h07', 'h08'], sales: 5000, cancelled: 1, days: 2 },
  {
    label: 'this year', from: '2026-01-01', to: D.t,
    ids: DEFAULT_IDS.concat(['h11', 'h12', 'h13', 'h14', 'h15']), sales: 14500, cancelled: 2, days: 9
  }
];
