// P3-U-* — Phase III "Sales by day": day arithmetic, range rules, range
// aggregation and the range CSV.
// Spec: CLAUDE.md "Phase III: Sales by day report" 2–10 and the mock-up
// design/ReportsByDay.dc.html. Hand-calculated fixture: tests/unit/range-fixtures.js.
import { describe, it, expect } from 'vitest';
import {
  isDayString, addDays, dayDiff, rangeLength, listDays,
  weekdayShort, formatDayShort, formatDayLabel, formatDayLong,
  clampRange, defaultRange, todayRange, ordersInRange,
  buildRangeReport, rangeToCsv, rangeCsvFilename, ordersToCsv, CSV_HEADER,
  formatPenceGrouped, formatPoundsRounded, formatPenceCompact,
  RANGE_MAX_DAYS, RANGE_TOO_LONG_MESSAGE, RANGE_EMPTY_MESSAGE, dayString
} from '../../public/js/logic.js';
import {
  RANGE_ORDERS, EXPECTED_DAYS, EXPECTED_TOTALS, EXPECTED_ITEMS,
  TRADING_DAYS, QUIET_DAYS, RANGE_FROM, RANGE_TO, D
} from './range-fixtures.js';
import { parseCsv } from './fixtures.js';

const report = buildRangeReport(RANGE_ORDERS);
const dayRow = (d) => report.days.find((x) => x.day === d);
const itemRow = (id) => report.items.find((x) => x.id === id);

/* ------------------------------------------------------------ day strings */

describe('P3-U-01 isDayString', () => {
  it('accepts a real YYYY-MM-DD day', () => {
    expect(isDayString('2026-10-19')).toBe(true);
    expect(isDayString('2026-02-29')).toBe(false); // 2026 is not a leap year
    expect(isDayString('2024-02-29')).toBe(true);
  });

  it('rejects anything else without throwing', () => {
    for (const bad of ['', '2026-10-32', '19/10/2026', '2026-1-9', null, undefined, 20261019, {}]) {
      expect(() => isDayString(bad)).not.toThrow();
      expect(isDayString(bad)).toBe(false);
    }
  });
});

describe('P3-U-02 addDays / dayDiff / rangeLength / listDays', () => {
  it('adds and subtracts calendar days', () => {
    expect(addDays('2026-10-19', 1)).toBe('2026-10-20');
    expect(addDays('2026-10-19', -6)).toBe('2026-10-13');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-19', 0)).toBe('2026-10-19');
  });

  it('crosses the BST → GMT change without slipping a day', () => {
    // 2026 clocks go back at 02:00 BST on Sunday 25 October.
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(dayDiff('2026-10-24', '2026-10-26')).toBe(2);
    expect(listDays('2026-10-24', '2026-10-27')).toEqual(
      ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']
    );
    // and the spring-forward weekend
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(listDays('2026-03-28', '2026-03-30')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
  });

  it('measures a range inclusively', () => {
    expect(dayDiff('2026-10-13', '2026-10-19')).toBe(6);
    expect(dayDiff('2026-10-19', '2026-10-13')).toBe(-6);
    expect(rangeLength('2026-10-19', '2026-10-19')).toBe(1);
    expect(rangeLength('2026-10-13', '2026-10-19')).toBe(7);
    expect(rangeLength('2026-10-19', '2026-10-13')).toBe(7); // order does not matter
  });

  it('lists every day ascending, whichever way round the ends are', () => {
    expect(listDays('2026-10-17', '2026-10-19')).toEqual(['2026-10-17', '2026-10-18', '2026-10-19']);
    expect(listDays('2026-10-19', '2026-10-17')).toEqual(['2026-10-17', '2026-10-18', '2026-10-19']);
    expect(listDays('2026-10-19', '2026-10-19')).toEqual(['2026-10-19']);
    expect(listDays('nonsense', '2026-10-19')).toEqual([]);
  });
});

describe('P3-U-03 day labels (design/ReportsByDay.dc.html)', () => {
  it('formats the weekday, the short date and the chart label', () => {
    expect(weekdayShort('2026-10-18')).toBe('Sun');
    expect(formatDayShort('2026-10-18')).toBe('18 Oct');
    expect(formatDayLabel('2026-10-18')).toBe('Sun 18 Oct');
    expect(formatDayLabel('2026-10-13')).toBe('Tue 13 Oct');
    expect(formatDayLabel('2026-01-01')).toBe('Thu 1 Jan');
  });

  it('formats the long date used by the version line', () => {
    expect(formatDayLong('2026-10-19')).toBe('19 Oct 2026');
    expect(formatDayLong('nope')).toBe('');
  });
});

/* --------------------------------------------------------------- clamping */

describe('P3-U-04 clampRange (CLAUDE.md Phase III 2)', () => {
  it('leaves a good range alone', () => {
    const r = clampRange('2026-10-13', '2026-10-19');
    expect(r.from).toBe('2026-10-13');
    expect(r.to).toBe('2026-10-19');
    expect(r.dayCount).toBe(7);
    expect(r.swapped).toBe(false);
    expect(r.tooLong).toBe(false);
    expect(r.valid).toBe(true);
    expect(r.days).toHaveLength(7);
  });

  it('swaps when To is before From', () => {
    const r = clampRange('2026-10-19', '2026-10-13');
    expect(r.from).toBe('2026-10-13');
    expect(r.to).toBe('2026-10-19');
    expect(r.swapped).toBe(true);
    expect(r.valid).toBe(true);
  });

  it('allows exactly 31 days', () => {
    expect(RANGE_MAX_DAYS).toBe(31);
    const r = clampRange('2026-10-01', '2026-10-31');
    expect(r.dayCount).toBe(31);
    expect(r.tooLong).toBe(false);
    expect(r.valid).toBe(true);
    expect(r.days).toHaveLength(31);
    expect(r.error).toBeFalsy();
  });

  it('rejects 32 days with "Pick 31 days or fewer" and lists no days to query', () => {
    expect(RANGE_TOO_LONG_MESSAGE).toBe('Pick 31 days or fewer');
    const r = clampRange('2026-10-01', '2026-11-01');
    expect(r.dayCount).toBe(32);
    expect(r.tooLong).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.error).toBe(RANGE_TOO_LONG_MESSAGE);
    // Nothing to query: the screen must make no request at all.
    expect(r.days).toEqual([]);
  });

  it('rejects a long range the wrong way round too', () => {
    const r = clampRange('2026-11-01', '2026-10-01');
    expect(r.swapped).toBe(true);
    expect(r.tooLong).toBe(true);
    expect(r.days).toEqual([]);
  });

  it('copes with one or both ends missing', () => {
    const one = clampRange('2026-10-19', '');
    expect(one.from).toBe('2026-10-19');
    expect(one.to).toBe('2026-10-19');
    expect(one.valid).toBe(true);

    const other = clampRange('', '2026-10-19');
    expect(other.from).toBe('2026-10-19');
    expect(other.to).toBe('2026-10-19');

    const none = clampRange('', '');
    expect(none.valid).toBe(false);
    expect(none.days).toEqual([]);
    expect(() => clampRange(null, undefined)).not.toThrow();
  });
});

describe('P3-U-05 default and quick ranges (CLAUDE.md Phase III 2)', () => {
  it('defaults to the last 7 days ending today', () => {
    const r = defaultRange('2026-10-19');
    expect(r).toEqual({ from: '2026-10-13', to: '2026-10-19' });
    expect(rangeLength(r.from, r.to)).toBe(7);
  });

  it('"Today" is a single day', () => {
    expect(todayRange('2026-10-19')).toEqual({ from: '2026-10-19', to: '2026-10-19' });
  });

  it('falls back to the Europe/London today when given nothing', () => {
    const today = dayString();
    expect(todayRange().to).toBe(today);
    expect(defaultRange().to).toBe(today);
    expect(defaultRange().from).toBe(addDays(today, -6));
  });
});

describe('P3-U-06 ordersInRange', () => {
  it('keeps only the days inside the inclusive range', () => {
    const inside = ordersInRange(RANGE_ORDERS, D.wed, D.sat);
    expect(inside.map((o) => o.orderNo).sort()).toEqual(['A-010', 'A-011', 'A-020', 'A-021', 'A-022', 'B-001', 'B-002', 'B-003']);
    expect(ordersInRange(RANGE_ORDERS, D.tue, D.tue).map((o) => o.orderNo)).toEqual(['A-001', 'A-002']);
    expect(ordersInRange(RANGE_ORDERS, '2026-11-01', '2026-11-30')).toEqual([]);
    expect(ordersInRange(RANGE_ORDERS, 'nope', D.sat)).toEqual([]);
  });
});

/* ------------------------------------------------------------ aggregation */

describe('P3-U-07 trading days only (CLAUDE.md Phase III 4)', () => {
  it('has one row per day that traded, ascending, and none for the quiet days', () => {
    expect(report.days.map((d) => d.day)).toEqual(TRADING_DAYS);
    expect(report.tradingDays).toBe(EXPECTED_TOTALS.tradingDays);
    for (const quiet of QUIET_DAYS) {
      expect(report.days.some((d) => d.day === quiet), `${quiet} had no orders and must not appear`).toBe(false);
      expect(report.dayKeys).not.toContain(quiet);
    }
  });

  it('reports an empty range as empty, not as a crash', () => {
    const none = buildRangeReport([]);
    expect(none.days).toEqual([]);
    expect(none.tradingDays).toBe(0);
    expect(none.empty).toBe(true);
    expect(none.totalSales).toBe(0);
    expect(none.orderCount).toBe(0);
    expect(none.itemsSold).toBe(0);
    expect(none.best).toBeNull();
    expect(none.averagePerDay).toBe(0);
    expect(Number.isNaN(none.itemsPerOrder)).toBe(false);
    expect(RANGE_EMPTY_MESSAGE).toBe('No sales in this range');
  });

  it('a range made only of cancelled orders is empty', () => {
    const cancelledOnly = RANGE_ORDERS.filter((o) => o.status === 'cancelled');
    expect(cancelledOnly).toHaveLength(1);
    expect(buildRangeReport(cancelledOnly).tradingDays).toBe(0);
    expect(buildRangeReport(cancelledOnly).empty).toBe(true);
  });
});

describe('P3-U-08 per-day rows match the hand-calculated table', () => {
  for (const expected of EXPECTED_DAYS) {
    it(`${expected.label}`, () => {
      const row = dayRow(expected.day);
      expect(row, `no row for ${expected.day}`).toBeTruthy();
      expect(row.weekday).toBe(expected.weekday);
      expect(row.date).toBe(expected.date);
      expect(row.label).toBe(expected.label);
      expect(row.orders).toBe(expected.orders);
      expect(row.items).toBe(expected.items);
      expect(row.sales).toBe(expected.sales);
      expect(row.cash).toBe(expected.cash);
      expect(row.card).toBe(expected.card);
      expect(row.avgOrder).toBe(expected.avgOrder);
      expect(row.peak).toBe(expected.peak);
      expect(row.cash + row.card).toBe(row.sales);
      expect(Number.isInteger(row.sales)).toBe(true);
    });
  }
});

describe('P3-U-09 cancelled orders are excluded everywhere (CLAUDE.md Phase III 3)', () => {
  it('matches a report built without the cancelled order at all', () => {
    const withoutCancelled = buildRangeReport(RANGE_ORDERS.filter((o) => o.status !== 'cancelled'));
    const strip = (r) => JSON.stringify({
      days: r.days.map(({ report: _ignored, ...rest }) => rest),
      totals: r.totals,
      items: r.items,
      best: r.best && r.best.day,
      totalSales: r.totalSales,
      orderCount: r.orderCount,
      itemsSold: r.itemsSold
    });
    expect(strip(report)).toBe(strip(withoutCancelled));
  });

  it('the cancelled Wednesday order contributes neither sales nor items', () => {
    const wed = dayRow(D.wed);
    expect(wed.orders).toBe(2);   // B-001 and B-002 only
    expect(wed.sales).toBe(2500); // the cancelled £10.00 is not here
    expect(wed.items).toBe(5);    // the cancelled 2 × fuchka are not here
    expect(itemRow('fuchka').units[0]).toBeUndefined(); // units is a number, not an array
    expect(itemRow('fuchka').cells.find((c) => c.day === D.wed).units).toBe(0);
  });
});

describe('P3-U-10 totals tiles (CLAUDE.md Phase III 5)', () => {
  it('total sales, orders and items', () => {
    expect(report.totalSales).toBe(EXPECTED_TOTALS.sales);
    expect(report.orderCount).toBe(EXPECTED_TOTALS.orders);
    expect(report.itemsSold).toBe(EXPECTED_TOTALS.items);
    expect(report.itemsPerOrder.toFixed(1)).toBe(EXPECTED_TOTALS.itemsPerOrder);
  });

  it('best day and its sales', () => {
    expect(report.best.day).toBe(EXPECTED_TOTALS.bestDay);
    expect(report.best.sales).toBe(EXPECTED_TOTALS.bestSales);
    expect(report.maxSales).toBe(EXPECTED_TOTALS.bestSales);
  });

  it('average per trading day, and orders a day', () => {
    expect(report.averagePerDay).toBe(EXPECTED_TOTALS.averagePerDay);
    expect(report.averageOrdersPerDay).toBe(EXPECTED_TOTALS.ordersPerDay);
  });

  it('a tie for best day goes to the earlier day', () => {
    const tie = buildRangeReport([
      { day: '2026-10-18', status: 'collected', payment: 'cash', total: 1000, items: [{ id: 'momo', name: 'Momo', qty: 2, price: 500 }], createdAtMs: Date.UTC(2026, 9, 18, 10) },
      { day: '2026-10-19', status: 'collected', payment: 'cash', total: 1000, items: [{ id: 'momo', name: 'Momo', qty: 2, price: 500 }], createdAtMs: Date.UTC(2026, 9, 19, 10) }
    ]);
    expect(tie.days.map((d) => d.sales)).toEqual([1000, 1000]);
    expect(tie.best.day).toBe('2026-10-18');
  });
});

describe('P3-U-11 the totals row of the day table (CLAUDE.md Phase III 7)', () => {
  it('sums every column of the day rows', () => {
    expect(report.totals.orders).toBe(EXPECTED_TOTALS.orders);
    expect(report.totals.items).toBe(EXPECTED_TOTALS.items);
    expect(report.totals.sales).toBe(EXPECTED_TOTALS.sales);
    expect(report.totals.cash).toBe(EXPECTED_TOTALS.cash);
    expect(report.totals.card).toBe(EXPECTED_TOTALS.card);
    expect(report.totals.avgOrder).toBe(EXPECTED_TOTALS.avgOrder);
    expect(report.totals.cash + report.totals.card).toBe(report.totals.sales);
    // and they really are the sum of the rows on screen
    const sum = (k) => report.days.reduce((a, d) => a + d[k], 0);
    expect(sum('orders')).toBe(report.totals.orders);
    expect(sum('items')).toBe(report.totals.items);
    expect(sum('sales')).toBe(report.totals.sales);
    expect(sum('cash')).toBe(report.totals.cash);
    expect(sum('card')).toBe(report.totals.card);
  });
});

describe('P3-U-12 items sold by day (CLAUDE.md Phase III 8, Hotfix H1 6)', () => {
  it('has a row per item that sold, in menu order, retired ids last', () => {
    expect(report.items.map((i) => i.id)).toEqual(EXPECTED_ITEMS.map((i) => i.id));
    // samosa_only never sold in this range, so it has no row at all
    expect(report.items.some((i) => i.id === 'samosa_only')).toBe(false);
  });

  for (const expected of EXPECTED_ITEMS) {
    it(`${expected.id} units, total, sales and best day`, () => {
      const row = itemRow(expected.id);
      expect(row, `no matrix row for ${expected.id}`).toBeTruthy();
      expect(row.name).toBe(expected.name);
      expect(row.cells.map((c) => c.day)).toEqual(TRADING_DAYS);
      for (const cell of row.cells) {
        expect(cell.units, `${expected.id} on ${cell.day}`).toBe(expected.units[cell.day]);
      }
      expect(row.total).toBe(expected.total);
      expect(row.sales).toBe(expected.sales);
      expect(row.bestDay).toBe(expected.bestDay);
      const best = row.cells.filter((c) => c.best && c.units > 0);
      expect(best.map((c) => c.day)).toEqual([expected.bestDay]);
    });
  }

  it('retired ids keep their original names and never merge with the new ones', () => {
    expect(itemRow('samosa').name).toBe('Sweets Box Samosa / Shingara');
    expect(itemRow('straw').name).toBe('Chocolate Strawberry & Marshmallow (V)');
    expect(itemRow('choc_strawberry').name).toBe('Chocolate Strawberry');
    expect(itemRow('samosa').total).toBe(2);
    expect(itemRow('straw').total).toBe(1);
  });

  it('every row total and sales figure adds up to the range totals', () => {
    expect(report.items.reduce((a, i) => a + i.total, 0)).toBe(EXPECTED_TOTALS.items);
    expect(report.items.reduce((a, i) => a + i.sales, 0)).toBe(EXPECTED_TOTALS.sales);
  });
});

describe('P3-U-13 the legacy `tendered` field is ignored (CLAUDE.md Phase III 10)', () => {
  it('changes nothing when it is removed', () => {
    const legacy = RANGE_ORDERS.find((o) => o.orderNo === 'A-010');
    expect(legacy.tendered, 'the fixture must carry a Phase I tendered field').toBe(2000);
    const stripped = RANGE_ORDERS.map(({ tendered: _drop, ...rest }) => rest);
    expect(JSON.stringify(buildRangeReport(stripped).days.map(({ report: _r, ...d }) => d)))
      .toBe(JSON.stringify(report.days.map(({ report: _r, ...d }) => d)));
  });
});

/* -------------------------------------------------------------- range CSV */

describe('P3-U-14 range CSV (CLAUDE.md Phase III 9)', () => {
  const csv = rangeToCsv(RANGE_ORDERS);
  const rows = parseCsv(csv);

  it('has exactly the One day columns', () => {
    expect(rows[0]).toEqual(CSV_HEADER);
    expect(rows[0].join(',')).toBe(
      'day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds'
    );
    expect(csv.split('\n')[0]).toBe(ordersToCsv([]).split('\n')[0]);
  });

  it('writes one row per order line in the range, cancelled excluded', () => {
    const liveLines = RANGE_ORDERS
      .filter((o) => o.status !== 'cancelled')
      .reduce((n, o) => n + o.items.length, 0);
    expect(rows.length - 1).toBe(liveLines);
    expect(rows.some((r) => r[1] === 'B-003'), 'the cancelled order must not be exported').toBe(false);
  });

  it('never mentions tendered or changeGiven', () => {
    expect(rows[0]).not.toContain('tendered');
    expect(rows[0]).not.toContain('changeGiven');
    expect(csv).not.toMatch(/tendered/i);
    expect(csv).not.toMatch(/changeGiven/i);
    // 2000 is the legacy tendered amount on A-010; it must not appear on its row.
    const row = rows.find((r) => r[1] === 'A-010');
    expect(row).toBeTruthy();
    expect(row).not.toContain('2000');
  });

  it('keeps the original names of retired ids', () => {
    const items = rows.slice(1).map((r) => r[4]);
    expect(items).toContain('Sweets Box Samosa / Shingara');
    expect(items).toContain('Chocolate Strawberry & Marshmallow (V)');
    expect(items).toContain('Chocolate Strawberry');
  });

  it('every row carries its own day, so the range really is day by day', () => {
    const days = new Set(rows.slice(1).map((r) => r[0]));
    expect([...days].sort()).toEqual(TRADING_DAYS);
  });

  it('names the file nba-food-stall_<from>_<to>.csv', () => {
    expect(rangeCsvFilename(RANGE_FROM, RANGE_TO)).toBe('nba-food-stall_2026-10-13_2026-10-19.csv');
    expect(rangeCsvFilename('2026-10-19', '2026-10-19')).toBe('nba-food-stall_2026-10-19_2026-10-19.csv');
  });
});

/* ------------------------------------------------------ display formatting */

describe('P3-U-15 money formatting on the by-day screen', () => {
  it('groups thousands, as the mock-up does', () => {
    expect(formatPenceGrouped(200500)).toBe('£2,005.00');
    expect(formatPenceGrouped(16500)).toBe('£165.00');
    expect(formatPenceGrouped(0)).toBe('£0.00');
    expect(formatPenceGrouped(5)).toBe('£0.05');
    expect(formatPenceGrouped(-150)).toBe('-£1.50');
  });

  it('rounds to whole pounds for the gridlines', () => {
    expect(formatPoundsRounded(200500)).toBe('£2,005');
    expect(formatPoundsRounded(0)).toBe('£0');
    expect(formatPoundsRounded(149)).toBe('£1');
  });

  it('bar labels stay exact until the figures reach four digits', () => {
    expect(formatPenceCompact(8000)).toBe('£80.00');
    expect(formatPenceCompact(16500)).toBe('£165.00');
    expect(formatPenceCompact(200500)).toBe('£2,005');
  });

  it('the hover readout reads "Sun 18 Oct · £2,005.00 · 208 orders"', () => {
    const row = dayRow(D.sat);
    const readout = `${row.label} · ${formatPenceGrouped(row.sales)} · ${row.orders} orders`;
    expect(readout).toBe('Sat 17 Oct · £80.00 · 3 orders');
    // and the shape the mock-up gives, with its own numbers
    expect(`${formatDayLabel('2026-10-18')} · ${formatPenceGrouped(200500)} · 208 orders`)
      .toBe('Sun 18 Oct · £2,005.00 · 208 orders');
  });
});
