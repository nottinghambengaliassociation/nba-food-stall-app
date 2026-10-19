// P4-U-* — Phase IV "Orders list and order detail": the pure logic behind
// #/reports/orders. Spec: CLAUDE.md "Phase IV: Orders list and order detail"
// 1–10, the orchestrator's Phase IV DOM contract, and the mock-ups
// design/ReportsOrders.dc.html and design/ReportsOrdersMobile.dc.html.
// Hand-calculated fixture: tests/unit/orders-fixtures.js.
//
// Function names come from .claude/agents/neo.md ("Morpheus unit-tests these
// by name; keep the names"): filterOrders, orderSummary, orderTimeline,
// orderWaitMinutes. The brief needs two more pieces of pure logic that no
// contract names — the summary line and the CSV file name — so those are
// resolved from a short list of plausible names and the test fails with the
// list when none of them exists. Recorded in qa/test-plan.md section 34.
import { describe, it, expect } from 'vitest';
import * as logic from '../../public/js/logic.js';
import { parseCsv } from './fixtures.js';
import {
  DAY, PREV_DAY, DAY_ORDERS, PREV_DAY_ORDER, NEWEST_FIRST,
  EXPECTED_FILTERS, EXPECTED_SUMMARIES, EXPECTED_WAIT, order
} from './orders-fixtures.js';

/* ------------------------------------------------------------- resolution */

const names = {
  filterOrders: ['filterOrders', 'filterOrderList', 'ordersFiltered'],
  orderSummary: ['orderSummary', 'itemsSummary', 'orderItemsSummary', 'summariseItems'],
  orderTimeline: ['orderTimeline', 'timelineSteps', 'orderSteps'],
  orderWaitMinutes: ['orderWaitMinutes', 'waitMinutes', 'orderWait'],
  summaryLine: ['ordersSummaryLine', 'ordersSummary', 'ordersSummaryText', 'summariseOrders', 'ordersCountLine'],
  csvFilename: ['ordersCsvFilename', 'orderCsvFilename', 'ordersCsvName', 'dayCsvFilename', 'csvFilenameForDay'],
  ordersCsv: ['exportOrdersCsv', 'ordersListToCsv', 'filteredOrdersToCsv', 'ordersScreenToCsv'],
  sortNewest: ['sortOrdersNewestFirst', 'sortNewestFirst', 'ordersNewestFirst', 'sortOrders'],
  waitText: ['orderWaitText', 'formatWaitMinutes', 'waitText'],
  statusLabel: ['statusLabel', 'orderStatusLabel']
};

function find(key) {
  for (const n of names[key]) if (typeof logic[n] === 'function') return logic[n];
  return null;
}

/** Required: a stub that fails with the contract when the export is missing. */
function required(key) {
  const fn = find(key);
  if (fn) return fn;
  return () => {
    throw new Error(
      `public/js/logic.js must export ${key}: one of ${names[key].join(', ')} ` +
      '(CLAUDE.md Phase IV + .claude/agents/neo.md "keep the names")'
    );
  };
}

const filterOrders = required('filterOrders');
const orderSummary = required('orderSummary');
const orderTimeline = required('orderTimeline');
const orderWaitMinutes = required('orderWaitMinutes');
const summaryLine = required('summaryLine');
const csvFilename = required('csvFilename');
const exportOrdersCsv = required('ordersCsv');
const sortNewest = find('sortNewest');
const waitText = find('waitText');

/**
 * filterOrders takes `{status, pay, q}` per .claude/agents/neo.md. Pass the
 * obvious synonyms too, so a reasonable naming choice is not a failure. An
 * implementation reading only its own keys ignores the rest.
 */
function args({ status = 'all', pay = 'all', q = '' } = {}) {
  return { status, pay, payment: pay, q, search: q, query: q };
}

const nos = (rows) => rows.map((o) => o.orderNo);

/**
 * What the list actually shows: the filtered orders, newest first
 * (CLAUDE.md Phase IV 5). The brief does not say whether the sort lives
 * inside filterOrders or beside it, so compose whichever logic.js provides.
 */
const view = (orders, filters) => {
  const rows = filterOrders(orders, args(filters));
  return sortNewest ? sortNewest(rows) : rows;
};

/** The summary line as a string, whether the function returns text or an object. */
function lineOf(rows) {
  const out = summaryLine(rows);
  if (typeof out === 'string') return out.replace(/\s+/g, ' ').trim();
  if (out && typeof out === 'object') {
    const text = out.text || out.line || out.label || out.summary;
    if (typeof text === 'string') return text.replace(/\s+/g, ' ').trim();
  }
  throw new Error(`the orders summary must produce a line of text, got ${JSON.stringify(out)}`);
}

/* --------------------------------------------------------------- the API */

describe('P4-U-00 the Phase IV logic API', () => {
  it('logic.js exports the pure functions the Orders screen is built from', () => {
    const missing = [];
    for (const key of ['filterOrders', 'orderSummary', 'orderTimeline', 'orderWaitMinutes', 'summaryLine', 'csvFilename', 'ordersCsv']) {
      if (!find(key)) missing.push(`${key} (tried: ${names[key].join(', ')})`);
    }
    expect(missing,
      'CLAUDE.md puts all pure logic in public/js/logic.js so it is unit-testable.\nMissing:\n' + missing.join('\n')
    ).toEqual([]);
  });

  it('logic.js still has no Firebase import', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../public/js/logic.js', import.meta.url), 'utf8');
    expect(src, 'CLAUDE.md Technical constraints: logic.js has no Firebase imports')
      .not.toMatch(/^\s*import\b[^\n]*firebase/mi);
    expect(src).not.toMatch(/gstatic\.com\/firebasejs/i);
  });
});

/* ---------------------------------------------------------------- sorting */

describe('P4-U-01 newest first (CLAUDE.md Phase IV 5)', () => {
  it('orders the day newest first by createdAtMs', () => {
    const shuffled = [...DAY_ORDERS].sort((a, b) => a.orderNo.localeCompare(b.orderNo));
    const rows = sortNewest ? sortNewest(shuffled) : filterOrders(shuffled, args());
    expect(nos(rows)).toEqual(NEWEST_FIRST);
  });

  it('falls back to createdAt when createdAtMs is missing, and never throws', () => {
    const rows = [
      { orderNo: 'A-001', day: DAY, status: 'new', payment: 'cash', name: 'A', items: [], total: 0 },
      { orderNo: 'A-002', day: DAY, status: 'new', payment: 'cash', name: 'B', items: [], total: 0, createdAtMs: 2000 },
      { orderNo: 'A-003', day: DAY, status: 'new', payment: 'cash', name: 'C', items: [], total: 0, createdAtMs: 3000 }
    ];
    const out = sortNewest ? sortNewest(rows) : filterOrders(rows, args());
    expect(nos(out).slice(0, 2)).toEqual(['A-003', 'A-002']);
    expect(out).toHaveLength(3);
  });

  it('does not mutate the array it is given (the screen is read-only)', () => {
    const input = [...DAY_ORDERS];
    const before = nos(input);
    filterOrders(input, args());
    if (sortNewest) sortNewest(input);
    expect(nos(input), 'filtering must not reorder the caller\'s array').toEqual(before);
  });
});

/* -------------------------------------------------------------- filtering */

describe('P4-U-02 filterOrders (CLAUDE.md Phase IV 2)', () => {
  for (const c of EXPECTED_FILTERS) {
    it(`${c.label} → ${c.rows.length} row(s)`, () => {
      const rows = view(DAY_ORDERS, c.args);
      expect(nos(rows), `filter: ${JSON.stringify(c.args)}`).toEqual(c.rows);
    });
  }

  it('lists cancelled orders rather than hiding them (CLAUDE.md Phase IV 3)', () => {
    const rows = view(DAY_ORDERS, {});
    expect(nos(rows)).toContain('A-044');
  });

  it('survives rubbish input without throwing', () => {
    expect(() => filterOrders([], args())).not.toThrow();
    expect(filterOrders([], args())).toEqual([]);
    expect(() => filterOrders(DAY_ORDERS, {})).not.toThrow();
    expect(() => filterOrders(DAY_ORDERS)).not.toThrow();
    expect(() => filterOrders(null, args())).not.toThrow();
    expect(filterOrders(null, args())).toEqual([]);
  });

  it('matches an order number or a name, nothing else', () => {
    // "Fuchka" is an item name, not a name or an order number: no match.
    expect(nos(view(DAY_ORDERS, { q: 'Fuchka' }))).toEqual([]);
    // the till letter alone is part of the order number
    expect(nos(view(DAY_ORDERS, { q: 'B-' }))).toEqual(['B-019', 'B-017']);
  });

  it('a day query never mixes days in (CLAUDE.md Phase IV 3)', () => {
    const both = [...DAY_ORDERS, PREV_DAY_ORDER];
    const today = both.filter((o) => o.day === DAY);   // the where("day","==",day) query
    expect(nos(view(today, {}))).toEqual(NEWEST_FIRST);
    const yesterday = both.filter((o) => o.day === PREV_DAY);
    expect(nos(view(yesterday, {}))).toEqual(['A-900']);
  });
});

/* ---------------------------------------------------------- summary line */

describe('P4-U-03 the summary line (CLAUDE.md Phase IV 4)', () => {
  it('reads "<n> orders · £<total> (excludes <c> cancelled)" with every order showing', () => {
    const rows = view(DAY_ORDERS, {});
    expect(lineOf(rows)).toBe('9 orders · £95.00 (excludes 1 cancelled)');
  });

  it('drops the "(excludes …)" clause when nothing in view is cancelled', () => {
    const rows = view(DAY_ORDERS, { status: 'collected' });
    const text = lineOf(rows);
    expect(text).toBe('5 orders · £60.00');
    expect(text, 'the clause only appears when c > 0').not.toMatch(/exclude/i);
  });

  it('counts cancelled rows but leaves their money out of the total', () => {
    const rows = view(DAY_ORDERS, { status: 'cancelled' });
    const text = lineOf(rows);
    expect(text).toMatch(/^1 orders?\b/);
    expect(text, 'the £10.00 cancelled order is excluded from the total').toContain('£0.00');
    expect(text).toMatch(/\(excludes 1 cancelled\)$/);
  });

  it('reflects the filters it is given', () => {
    for (const c of EXPECTED_FILTERS) {
      const rows = view(DAY_ORDERS, c.args);
      const text = lineOf(rows);
      expect(text, `${c.label}: count`).toMatch(new RegExp(`^${c.rows.length} orders?\\b`));
      const pounds = '£' + (c.total / 100).toFixed(2);
      expect(text, `${c.label}: total`).toContain(pounds);
      if (c.cancelled > 0) expect(text, `${c.label}: clause`).toContain(`(excludes ${c.cancelled} cancelled)`);
      else expect(text, `${c.label}: no clause`).not.toMatch(/exclude/i);
    }
  });

  it('says "0 orders · £0.00" for an empty list, never NaN', () => {
    const text = lineOf([]);
    expect(text).toMatch(/^0 orders?\b/);
    expect(text).toContain('£0.00');
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
  });
});

/* -------------------------------------------------------- items summary */

describe('P4-U-04 orderSummary: the Items column (CLAUDE.md Phase IV 5)', () => {
  for (const [no, expected] of Object.entries(EXPECTED_SUMMARIES)) {
    it(`${no} reads "${expected}"`, () => {
      expect(orderSummary(order(no))).toBe(expected);
    });
  }

  it('uses the menu short name, not the long one', () => {
    expect(orderSummary(order('A-041')), 'short "Fuchka", not "Fuchka / Gol Gappa"')
      .not.toContain('Gol Gappa');
  });

  it('uses the multiplication sign and ", " between lines', () => {
    expect(orderSummary(order('A-041'))).toMatch(/^2× Fuchka, 1× Momo$/u);
  });

  it('shows retired ids under their original name (CLAUDE.md Phase IV 9, H1 6)', () => {
    // `samosa` retired on 18 Oct; the live `samosa_only` is a different item
    // called "Samosa". An old `samosa` line must never read as the new one.
    const retired = orderSummary(order('A-010'));
    expect(retired, 'the retired Sweets Box keeps its own name').toMatch(/Sweets Box/);
    expect(retired).not.toBe('2× Samosa');
    expect(retired).toMatch(/^2× /u);

    const straw = orderSummary(order('A-011'));
    expect(straw, 'the retired combined strawberry item keeps its own name').toMatch(/Strawberry/i);
    expect(straw).toMatch(/^1× /u);
  });

  it('falls back to the name stored on the line for an id no longer in the menu', () => {
    const ghost = {
      orderNo: 'A-099', name: 'Old', day: DAY, status: 'collected', payment: 'cash', total: 500,
      items: [{ id: 'mystery_item', name: 'Mystery Item', qty: 1, price: 500 }], createdAtMs: 1
    };
    expect(orderSummary(ghost)).toBe('1× Mystery Item');
  });

  it('is empty, not broken, for an order with no lines', () => {
    expect(() => orderSummary({ orderNo: 'A-000', items: [] })).not.toThrow();
    expect(orderSummary({ orderNo: 'A-000', items: [] })).toBe('');
    expect(() => orderSummary({})).not.toThrow();
    expect(() => orderSummary(null)).not.toThrow();
  });
});

/* ------------------------------------------------------------------ wait */

describe('P4-U-05 wait, placed to ready (CLAUDE.md Phase IV 5)', () => {
  for (const [no, minutes] of Object.entries(EXPECTED_WAIT)) {
    it(`${no} waited ${minutes === null ? 'no measurable time (—)' : minutes + ' min'}`, () => {
      const got = orderWaitMinutes(order(no));
      if (minutes === null) expect(got, 'not ready yet: there is no wait').toBeNull();
      else expect(got).toBe(minutes);
    });
  }

  it('a cancelled order never shows a wait', () => {
    expect(orderWaitMinutes(order('A-044'))).toBeNull();
  });

  it('renders "—" when there is no wait and "<n> min" when there is', () => {
    const render = waitText || ((o) => {
      const m = orderWaitMinutes(o);
      return m === null || m === undefined ? '—' : `${m} min`;
    });
    expect(render(order('A-043'))).toBe('—');
    expect(render(order('A-041'))).toBe('4 min');
    if (!waitText) {
      // Nothing in logic.js renders it, so the e2e suite owns the "—" rule:
      // P4-05 asserts the Wait column and P4-08 the detail panel.
      expect(true).toBe(true);
    }
  });

  it('never throws and never returns NaN on a half-written order', () => {
    for (const bad of [null, undefined, {}, { readyAtMs: 5 }, { createdAtMs: 5 }, { createdAtMs: 10, readyAtMs: 5 }]) {
      expect(() => orderWaitMinutes(bad)).not.toThrow();
      const got = orderWaitMinutes(bad);
      expect(Number.isNaN(got), `orderWaitMinutes(${JSON.stringify(bad)}) = ${got}`).toBe(false);
    }
  });
});

/* -------------------------------------------------------------- timeline */

describe('P4-U-06 orderTimeline (CLAUDE.md Phase IV 6)', () => {
  /** A step's key, however the implementation spells the field. */
  const keyOf = (s) => String(s.key || s.id || s.step || s.label || '').toLowerCase();
  /** Whether a step has been reached. */
  const reached = (s) => {
    if (typeof s.reached === 'boolean') return s.reached;
    if (typeof s.done === 'boolean') return s.done;
    const at = s.at ?? s.ms ?? s.atMs;
    if (at !== undefined) return at !== null && at !== undefined;
    const time = s.time ?? s.text;
    return typeof time === 'string' && time !== '—' && time !== '';
  };
  const timeOf = (s) => (s.time ?? s.text ?? '');

  it('a collected order runs Placed → Started → Ready → Collected with its times', () => {
    const steps = orderTimeline(order('A-041'));
    expect(steps.map(keyOf)).toEqual(['placed', 'started', 'ready', 'collected']);
    expect(steps.map(reached), 'every step was reached').toEqual([true, true, true, true]);
    expect(steps.map(timeOf)).toEqual(['10:12', '10:13', '10:16', '10:17']);
  });

  it('an unfinished order shows the steps it has not reached as "—"', () => {
    const steps = orderTimeline(order('A-043')); // preparing
    expect(steps.map(keyOf)).toEqual(['placed', 'started', 'ready', 'collected']);
    expect(steps.map(reached)).toEqual([true, true, false, false]);
    expect(steps.map(timeOf)).toEqual(['10:40', '10:42', '—', '—']);
  });

  it('a brand new order has only Placed', () => {
    const steps = orderTimeline(order('B-019'));
    expect(steps.map(reached)).toEqual([true, false, false, false]);
    expect(timeOf(steps[0])).toBe('10:50');
  });

  it('a cancelled order runs Placed → Cancelled and nothing else', () => {
    const steps = orderTimeline(order('A-044'));
    expect(steps.map(keyOf), 'CLAUDE.md Phase IV 6: "or Placed → Cancelled"').toEqual(['placed', 'cancelled']);
    expect(steps.map(timeOf)).toEqual(['10:55', '10:56']);
    expect(steps.map(reached)).toEqual([true, true]);
  });

  it('never throws on a half-written order', () => {
    for (const bad of [null, undefined, {}, { status: 'ready' }]) {
      expect(() => orderTimeline(bad)).not.toThrow();
      expect(Array.isArray(orderTimeline(bad))).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------- CSV */

describe('P4-U-07 the orders CSV (CLAUDE.md Phase IV 8)', () => {
  it('is named nba-food-stall_orders_<day>.csv', () => {
    expect(csvFilename(DAY)).toBe('nba-food-stall_orders_2026-10-17.csv');
    expect(csvFilename(PREV_DAY)).toBe('nba-food-stall_orders_2026-10-16.csv');
  });

  it('has exactly the One day columns, in the One day order', () => {
    const csv = exportOrdersCsv(view(DAY_ORDERS, {}));
    expect(csv.split('\n')[0])
      .toBe('day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds');
    expect(logic.CSV_HEADER).toEqual([
      'day', 'orderNo', 'till', 'name', 'item', 'qty', 'price',
      'lineTotal', 'payment', 'status', 'createdAt', 'readyAt', 'waitSeconds'
    ]);
  });

  it('exports one row per line of the orders currently shown, cancelled included', () => {
    const all = parseCsv(exportOrdersCsv(view(DAY_ORDERS, {})));
    const col = (n) => all[0].indexOf(n);
    const body = all.slice(1);
    // 2 + 3 + 2 + 2 + 1 + 2 + 2 + 1 + 1 = 14 lines over all nine orders.
    expect(body, 'every order on screen contributes its lines').toHaveLength(14);
    expect(body.every((r) => r[col('day')] === DAY)).toBe(true);
    expect(body.map((r) => r[col('orderNo')]),
      'CLAUDE.md Phase IV 8: the orders currently shown, and a cancelled order is shown (Phase IV 5)'
    ).toContain('A-044');
    expect(body.find((r) => r[col('orderNo')] === 'A-044')[col('status')],
      'the status column is what tells the reader it was cancelled').toBe('cancelled');
    for (const r of body) {
      expect(r).toHaveLength(13);
      expect(Number(r[col('lineTotal')])).toBe(Number(r[col('qty')]) * Number(r[col('price')]));
    }
  });

  it('keeps the rows in the order the list shows them, newest first', () => {
    const rows = parseCsv(exportOrdersCsv(view(DAY_ORDERS, {}))).slice(1);
    const col = 1; // orderNo
    const seen = [];
    for (const r of rows) if (seen[seen.length - 1] !== r[col]) seen.push(r[col]);
    expect(seen, 'CLAUDE.md Phase IV 5 + 8: the export follows the list').toEqual(NEWEST_FIRST);
  });

  it('follows the filters: Cash narrows it, Cancelled still produces rows', () => {
    const header = 'day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds';

    const cash = parseCsv(exportOrdersCsv(view(DAY_ORDERS, { pay: 'cash' })));
    const col = (n) => cash[0].indexOf(n);
    expect(cash.slice(1), 'a narrowed filter narrows the export').toHaveLength(9);
    expect(new Set(cash.slice(1).map((r) => r[col('payment')]))).toEqual(new Set(['cash']));

    const cancelled = exportOrdersCsv(view(DAY_ORDERS, { status: 'cancelled' }));
    expect(cancelled.split('\n')[0]).toBe(header);
    const body = parseCsv(cancelled).slice(1);
    expect(body, 'filtering to Cancelled must not export an empty file').toHaveLength(1);
    expect(body[0][col('orderNo')]).toBe('A-044');
    expect(body[0][col('status')]).toBe('cancelled');
    expect(body[0][col('qty')]).toBe('2');
    expect(body[0][col('lineTotal')]).toBe('1000');

    const nothing = parseCsv(exportOrdersCsv(view(DAY_ORDERS, { q: 'zzz' })));
    expect(nothing.slice(1), 'no rows on screen, no rows in the file').toHaveLength(0);
    expect(nothing[0].join(',')).toBe(header);
  });

  it('leaves the One day and Sales by day exports excluding cancelled', () => {
    // CLAUDE.md Reports 2: "Cancelled orders excluded everywhere" on those two
    // screens. Only the Orders screen, which lists them, exports them.
    const oneDay = parseCsv(logic.ordersToCsv(DAY_ORDERS)).slice(1);
    expect(oneDay).toHaveLength(13);
    expect(oneDay.map((r) => r[1])).not.toContain('A-044');
    expect(logic.rangeToCsv).toBe(logic.ordersToCsv);
  });

  it('writes retired items under the name stored on the order line', () => {
    const rows = parseCsv(exportOrdersCsv(view(DAY_ORDERS, { q: 'a-01' })));
    const col = (n) => rows[0].indexOf(n);
    const body = rows.slice(1);
    expect(body.map((r) => r[col('item')]).sort()).toEqual([
      'Chocolate Strawberry & Marshmallow (V)', 'Sweets Box Samosa / Shingara'
    ]);
  });

  it('never exports the Phase I tendered field', () => {
    const csv = exportOrdersCsv(view(DAY_ORDERS, {}));
    expect(csv).not.toMatch(/tendered/i);
    expect(csv).not.toMatch(/changeGiven/i);
    // A-010 carries tendered: 2000. The number must not appear as a field.
    const body = parseCsv(csv).slice(1);
    expect(body.some((r) => r.includes('2000'))).toBe(false);
  });

  it('quotes a name containing a comma', () => {
    const tricky = [{
      orderNo: 'A-077', name: 'Smith, Jo', till: 'A', day: DAY, payment: 'cash', status: 'collected',
      items: [{ id: 'momo', name: 'Momo', qty: 1, price: 500 }], total: 500, createdAtMs: 1
    }];
    const csv = exportOrdersCsv(tricky);
    expect(csv).toContain('"Smith, Jo"');
    expect(parseCsv(csv)[1][3]).toBe('Smith, Jo');
  });

  it('never throws on rubbish input', () => {
    for (const bad of [null, undefined, [], [null]]) {
      expect(() => exportOrdersCsv(bad)).not.toThrow();
      expect(exportOrdersCsv(bad).split('\n')[0]).toContain('day,orderNo');
    }
  });
});

/* --------------------------------------------------------------- read-only */

describe('P4-U-08 the screen is read-only (CLAUDE.md Phase IV, heading)', () => {
  it('none of the Phase IV logic alters the orders it is given', () => {
    const snapshot = JSON.stringify(DAY_ORDERS);
    filterOrders(DAY_ORDERS, args({ status: 'collected', pay: 'cash', q: 'a' }));
    for (const o of DAY_ORDERS) {
      orderSummary(o);
      orderTimeline(o);
      orderWaitMinutes(o);
    }
    logic.ordersToCsv(DAY_ORDERS);
    exportOrdersCsv(DAY_ORDERS);
    summaryLine(DAY_ORDERS);
    expect(JSON.stringify(DAY_ORDERS), 'Phase IV writes nothing, not even in memory').toBe(snapshot);
  });
});

/* ------------------------------------------------------------- version */

describe('P4-U-09 the version in package.json', () => {
  it('is on 1.3.2, the hotfix H4 release', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.version,
      'CLAUDE.md -> Hotfix H4 4: "package.json version 1.3.2", and the version table lists ' +
      '1.3.2 as hotfix H4 ("Card is the default payment"). package.json is the single source ' +
      'of truth (Phase III part 2, 1), so the header pill and the login version line follow it.'
    ).toBe('1.3.2');
  });
});
