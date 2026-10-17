// Shared fixtures for the unit suite. Derived from qa/test-plan.md section 8.
// 2026-10-17 is inside BST, so Europe/London is UTC+1.

export const DAY = '2026-10-17';

/** Epoch ms for a Europe/London wall-clock time on DAY (BST, UTC+1). */
export function londonMs(hour, minute = 0, second = 0) {
  return Date.UTC(2026, 9, 17, hour - 1, minute, second);
}

const P = 500; // every menu item is £5 in Phase I

const line = (id, name, qty) => ({ id, name, qty, price: P });

/**
 * The scripted day used by the report cases.
 * Hand-calculated expectations live in qa/test-plan.md section 8.
 */
export const REPORT_ORDERS = [
  {
    orderNo: 'A-001', name: 'Priya', till: 'A', day: DAY,
    items: [line('fuchka', 'Fuchka / Gol Gappa', 2)],
    total: 1000, payment: 'cash', tendered: 2000, status: 'collected',
    createdAtMs: londonMs(12, 5), readyAtMs: londonMs(12, 7), collectedAtMs: londonMs(12, 8)
  },
  {
    orderNo: 'A-002', name: 'Sam', till: 'A', day: DAY,
    items: [line('momo', 'Momo', 1), line('chat', 'Papri Chat', 1)],
    total: 1000, payment: 'card', tendered: null, status: 'collected',
    createdAtMs: londonMs(12, 20), readyAtMs: londonMs(12, 25), collectedAtMs: londonMs(12, 26)
  },
  {
    orderNo: 'A-003', name: 'Ahmed', till: 'A', day: DAY,
    items: [line('fuchka', 'Fuchka / Gol Gappa', 3)],
    total: 1500, payment: 'cash', tendered: 2000, status: 'ready',
    createdAtMs: londonMs(12, 40), readyAtMs: londonMs(12, 44)
  },
  {
    orderNo: 'A-004', name: 'Lucy', till: 'A', day: DAY,
    items: [line('samosa', 'Sweets Box Samosa / Shingara', 1)],
    total: 500, payment: 'card', tendered: null, status: 'collected',
    createdAtMs: londonMs(13, 10), readyAtMs: londonMs(13, 13)
  },
  {
    orderNo: 'A-005', name: 'Josh', till: 'A', day: DAY,
    items: [line('momo', 'Momo', 4)],
    total: 2000, payment: 'cash', tendered: 2000, status: 'new',
    createdAtMs: londonMs(13, 40)
  },
  {
    orderNo: 'A-006', name: 'Meera', till: 'A', day: DAY,
    items: [line('fountain', 'Chocolate Fountain', 10)],
    total: 5000, payment: 'card', tendered: null, status: 'cancelled',
    createdAtMs: londonMs(13, 20), cancelledAtMs: londonMs(13, 21)
  }
];

export const LIVE_ORDERS = REPORT_ORDERS.filter((o) => o.status !== 'cancelled');

/** A storage stub with the localStorage interface. */
export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get size() { return map.size; },
    keys() { return [...map.keys()]; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); }
  };
}

/** Minimal RFC4180 parser so CSV assertions do not rely on naive splitting. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
    } else if (c === '\r') {
      // ignore
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
