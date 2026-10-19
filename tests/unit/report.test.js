// U-12..U-19 — report aggregation. Spec: CLAUDE.md "Reports" FR 2..5 and the
// hand-calculated fixture in qa/test-plan.md section 8.
import { describe, it, expect } from 'vitest';
import {
  buildReport, stationOf, inStation, activeOrders, itemCount, formatWait
} from '../../public/js/logic.js';
import { REPORT_ORDERS, LIVE_ORDERS, londonMs } from './fixtures.js';

const report = buildReport(REPORT_ORDERS);
const slotCount = (r, label) => (r.slots.find((s) => s.label === label) || { count: 0 }).count;
const itemRow = (r, id) => r.byItem.find((x) => x.id === id);

describe('U-12 stationOf', () => {
  it('maps each menu item to its station from the brief', () => {
    expect(stationOf('fuchka')).toBe('chaat');
    expect(stationOf('chat')).toBe('chaat');
    expect(stationOf('momo')).toBe('momo');
    expect(stationOf('sweet_box')).toBe('sweets');
    expect(stationOf('samosa_only')).toBe('sweets');
    expect(stationOf('choc_strawberry')).toBe('sweets');
    expect(stationOf('marshmallow')).toBe('sweets');
  });

  it('an id deleted by H3 is simply unknown (CLAUDE.md H3 7)', () => {
    // "Remove the retired-id special cases from the code (station lists ...)".
    for (const id of ['samosa', 'straw', 'fountain']) {
      expect(stationOf(id), `stationOf("${id}") after the H3 reset`).toBeFalsy();
    }
  });

  it('does not throw on an unknown id', () => {
    expect(() => stationOf('nope')).not.toThrow();
    expect(stationOf('nope')).toBeFalsy();
  });

  it('inStation treats "all" as everything', () => {
    expect(inStation('momo', 'all')).toBe(true);
    expect(inStation('momo', 'chaat')).toBe(false);
    expect(inStation('fuchka', 'chaat')).toBe(true);
  });
});

describe('U-13 KPI tiles', () => {
  it('total sales is the sum of non-cancelled totals in pence', () => {
    expect(report.totalSales).toBe(6000);
    expect(Number.isInteger(report.totalSales)).toBe(true);
  });

  it('orders counts non-cancelled orders', () => {
    expect(report.orderCount).toBe(5);
  });

  it('items sold counts every line quantity', () => {
    expect(report.itemsSold).toBe(12);
  });

  it('average order is total sales / orders, in pence', () => {
    expect(report.averageOrder).toBe(1200);
  });

  it('average wait is createdAt to readyAt, in seconds', () => {
    // (120 + 300 + 240 + 180) / 4 = 210
    expect(report.averageWaitSeconds).toBe(210);
    expect(formatWait(report.averageWaitSeconds)).toBe('3m 30s');
  });

  it('produces zeroes rather than NaN for an empty day', () => {
    const empty = buildReport([]);
    expect(empty.totalSales).toBe(0);
    expect(empty.orderCount).toBe(0);
    expect(empty.itemsSold).toBe(0);
    expect(empty.averageOrder).toBe(0);
    expect(Number.isNaN(empty.averageOrder)).toBe(false);
    expect(empty.averageWaitSeconds == null || empty.averageWaitSeconds === 0).toBe(true);
    expect(formatWait(empty.averageWaitSeconds)).not.toMatch(/NaN/);
  });
});

describe('U-14 cancelled orders excluded everywhere', () => {
  const withoutCancelled = buildReport(LIVE_ORDERS);

  it('gives exactly the same report with and without the cancelled order', () => {
    const strip = (r) => JSON.stringify({
      totalSales: r.totalSales, orderCount: r.orderCount, itemsSold: r.itemsSold,
      averageOrder: r.averageOrder, averageWaitSeconds: r.averageWaitSeconds,
      byItem: r.byItem, slots: r.slots, peak: r.peak,
      busiestWindow: r.busiestWindow, payment: r.payment
    });
    expect(strip(report)).toBe(strip(withoutCancelled));
  });

  it('never counts the cancelled order anywhere', () => {
    expect(report.totalSales).not.toBe(11000);          // 6000 + the cancelled 5000
    expect(report.itemsSold).not.toBe(22);              // 12 + the cancelled 10
    expect(itemRow(report, 'fountain')).toBeUndefined(); // only sold on the cancelled order
    expect(report.payment.card.amount).toBe(1500);       // excludes the cancelled £50 card order
  });

  it('activeOrders filters cancelled', () => {
    expect(activeOrders(REPORT_ORDERS)).toHaveLength(5);
    expect(activeOrders(REPORT_ORDERS).some((o) => o.status === 'cancelled')).toBe(false);
  });

  it('itemCount sums line quantities', () => {
    expect(itemCount(REPORT_ORDERS[1].items)).toBe(2);
    expect(itemCount([])).toBe(0);
  });
});

describe('U-15 sales by item', () => {
  it('reports units and revenue per item', () => {
    expect(itemRow(report, 'fuchka')).toMatchObject({ units: 5, revenue: 2500 });
    expect(itemRow(report, 'momo')).toMatchObject({ units: 5, revenue: 2500 });
    expect(itemRow(report, 'chat')).toMatchObject({ units: 1, revenue: 500 });
    expect(itemRow(report, 'samosa')).toMatchObject({ units: 1, revenue: 500 });
  });

  it('lists only items that actually sold', () => {
    expect(report.byItem.map((x) => x.id).sort()).toEqual(['chat', 'fuchka', 'momo', 'samosa']);
  });

  it('item revenue sums to total sales', () => {
    expect(report.byItem.reduce((a, b) => a + b.revenue, 0)).toBe(report.totalSales);
  });

  it('item units sum to items sold', () => {
    expect(report.byItem.reduce((a, b) => a + b.units, 0)).toBe(report.itemsSold);
  });
});

describe('U-16 30-minute buckets and the peak slot', () => {
  it('buckets orders by London half hour', () => {
    expect(slotCount(report, '12:00–12:30')).toBe(2); // A-001, A-002
    expect(slotCount(report, '12:30–13:00')).toBe(1); // A-003
    expect(slotCount(report, '13:00–13:30')).toBe(1); // A-004 (A-006 is cancelled)
    expect(slotCount(report, '13:30–14:00')).toBe(1); // A-005
    expect(slotCount(report, '11:30–12:00')).toBe(0);
  });

  it('bucket counts sum to the order count', () => {
    expect(report.slots.reduce((a, s) => a + s.count, 0)).toBe(report.orderCount);
  });

  it('highlights the busiest half hour', () => {
    expect(report.peak.count).toBe(2);
    expect(report.peak.label).toBe('12:00–12:30');
  });

  it('resolves a tie to the earliest slot', () => {
    // qa/test-plan.md section 15.2: the brief is silent, earliest wins.
    const tie = buildReport([
      { total: 500, payment: 'cash', status: 'collected', items: [{ id: 'momo', qty: 1, price: 500 }], createdAtMs: londonMs(12, 1) },
      { total: 500, payment: 'cash', status: 'collected', items: [{ id: 'momo', qty: 1, price: 500 }], createdAtMs: londonMs(15, 1) }
    ]);
    expect(tie.peak.label).toBe('12:00–12:30');
  });

  it('has no peak on an empty day', () => {
    expect(buildReport([]).peak).toBeFalsy();
  });
});

describe('U-17 busiest rolling 2 hours', () => {
  it('reports the best run of four consecutive half hours', () => {
    expect(report.busiestWindow.count).toBe(5);
    expect(report.busiestWindow.label).toBe('12:00–14:00');
  });

  it('can pick a window that is not centred on the single peak slot', () => {
    const mk = (h, m) => ({
      total: 500, payment: 'cash', status: 'collected',
      items: [{ id: 'momo', name: 'Momo', qty: 1, price: 500 }], createdAtMs: londonMs(h, m)
    });
    // 09:00 slot holds the single peak (4 orders) and is isolated.
    // 14:00–16:00 holds 3+3+3+3 = 12 and is the busiest two hours.
    const orders = [
      ...Array.from({ length: 4 }, (_, i) => mk(9, i)),
      ...Array.from({ length: 3 }, (_, i) => mk(14, i)),
      ...Array.from({ length: 3 }, (_, i) => mk(14, 30 + i)),
      ...Array.from({ length: 3 }, (_, i) => mk(15, i)),
      ...Array.from({ length: 3 }, (_, i) => mk(15, 30 + i))
    ];
    const r = buildReport(orders);
    expect(r.peak.label).toBe('09:00–09:30');
    expect(r.peak.count).toBe(4);
    expect(r.busiestWindow.label).toBe('14:00–16:00');
    expect(r.busiestWindow.count).toBe(12);
  });

  it('spans exactly two hours', () => {
    const [from, to] = report.busiestWindow.label.split(/[–-]/);
    const mins = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
    expect(mins(to) - mins(from)).toBe(120);
  });

  it('has no window on an empty day', () => {
    expect(buildReport([]).busiestWindow).toBeFalsy();
  });
});

describe('U-18 cash vs card split', () => {
  it('splits the amounts', () => {
    expect(report.payment.cash.amount).toBe(4500); // A-001 1000 + A-003 1500 + A-005 2000
    expect(report.payment.card.amount).toBe(1500); // A-002 1000 + A-004 500
  });

  it('amounts sum to total sales', () => {
    expect(report.payment.cash.amount + report.payment.card.amount).toBe(report.totalSales);
  });

  it('percentages are of total sales and sum to 100', () => {
    expect(report.payment.cash.percent).toBe(75);
    expect(report.payment.card.percent).toBe(25);
    expect(report.payment.cash.percent + report.payment.card.percent).toBe(100);
  });

  it('counts orders per payment method', () => {
    expect(report.payment.cash.count).toBe(3);
    expect(report.payment.card.count).toBe(2);
  });

  it('is 0% / 0% on an empty day rather than NaN', () => {
    const empty = buildReport([]);
    expect(empty.payment.cash.percent).toBe(0);
    expect(empty.payment.card.percent).toBe(0);
  });
});

describe('U-19 average wait', () => {
  const base = { total: 500, payment: 'cash', items: [{ id: 'momo', qty: 1, price: 500 }] };

  it('averages only orders that reached ready', () => {
    const r = buildReport([
      { ...base, status: 'collected', createdAtMs: 1_000_000, readyAtMs: 1_000_000 + 120_000 },
      { ...base, status: 'ready', createdAtMs: 2_000_000, readyAtMs: 2_000_000 + 300_000 },
      { ...base, status: 'new', createdAtMs: 3_000_000 }
    ]);
    expect(r.averageWaitSeconds).toBe(210);
  });

  it('is not NaN when nothing has reached ready', () => {
    const r = buildReport([{ ...base, status: 'new', createdAtMs: 3_000_000 }]);
    expect(Number.isNaN(r.averageWaitSeconds)).toBe(false);
    expect(r.averageWaitSeconds == null || r.averageWaitSeconds === 0).toBe(true);
  });

  it('formatWait renders minutes and seconds', () => {
    expect(formatWait(210)).toBe('3m 30s');
    expect(formatWait(250)).toBe('4m 10s');
    expect(formatWait(0)).toBe('0m 00s');
    expect(formatWait(null)).not.toMatch(/NaN/);
  });
});

describe('report robustness', () => {
  it('survives junk input', () => {
    expect(() => buildReport(undefined)).not.toThrow();
    expect(() => buildReport([null, {}, { items: null }])).not.toThrow();
  });
});
