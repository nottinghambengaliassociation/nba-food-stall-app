// U-20..U-23, U-28 — CSV export. Spec: CLAUDE.md Reports FR 6:
// "Export CSV downloads one row per order line: day, orderNo, till, name, item,
//  qty, price, lineTotal, payment, status, createdAt, readyAt, waitSeconds".
// Requirement change 2026-10-18: Cash received is screen-only, so the two
// Phase II columns are NOT added; the header stays exactly as in Phase I.
import { describe, it, expect } from 'vitest';
import { ordersToCsv, csvEscape } from '../../public/js/logic.js';
import { REPORT_ORDERS, parseCsv, londonMs, DAY } from './fixtures.js';

const HEADER = 'day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds';
const COLUMNS = HEADER.split(',').length; // 13

describe('U-20 CSV header', () => {
  it('is exactly the column list from the brief, in order', () => {
    const csv = ordersToCsv(REPORT_ORDERS);
    expect(csv.split(/\r?\n/)[0]).toBe(HEADER);
  });

  it('is present even with no orders', () => {
    expect(ordersToCsv([]).split(/\r?\n/)[0]).toBe(HEADER);
    expect(ordersToCsv([]).trim()).toBe(HEADER);
  });
});

describe('U-21 one row per order line', () => {
  const rows = parseCsv(ordersToCsv(REPORT_ORDERS));
  const body = rows.slice(1);
  const col = (name) => rows[0].indexOf(name);

  it('emits a row for every line of every exported order', () => {
    // A-001 1 line, A-002 2 lines, A-003 1, A-004 1, A-005 1 = 6 lines.
    // The cancelled A-006 is either excluded entirely or present with status=cancelled
    // (qa/test-plan.md section 15.3); both readings are accepted here.
    const cancelledRows = body.filter((r) => r[col('status')] === 'cancelled');
    expect(body.length - cancelledRows.length).toBe(6);
    expect(cancelledRows.length === 0 || cancelledRows.length === 1).toBe(true);
  });

  it('gives every row exactly 13 fields', () => {
    for (const r of body) expect(r).toHaveLength(COLUMNS);
  });

  it('keeps money as integer pence and lineTotal = qty x price', () => {
    for (const r of body) {
      const qty = Number(r[col('qty')]);
      const price = Number(r[col('price')]);
      const lineTotal = Number(r[col('lineTotal')]);
      expect(Number.isInteger(qty)).toBe(true);
      expect(Number.isInteger(price)).toBe(true);
      expect(lineTotal).toBe(qty * price);
    }
  });

  it('carries day, till, payment, status and the order number', () => {
    const first = body.find((r) => r[col('orderNo')] === 'A-001');
    expect(first).toBeTruthy();
    expect(first[col('day')]).toBe(DAY);
    expect(first[col('till')]).toBe('A');
    expect(first[col('name')]).toBe('Priya');
    expect(first[col('qty')]).toBe('2');
    expect(first[col('price')]).toBe('500');
    expect(first[col('lineTotal')]).toBe('1000');
    expect(first[col('payment')]).toBe('cash');
    expect(first[col('status')]).toBe('collected');
    expect(first[col('item')]).toMatch(/Fuchka/);
  });

  it('fills waitSeconds where the order reached ready and leaves it blank otherwise', () => {
    const a001 = body.find((r) => r[col('orderNo')] === 'A-001');
    const a002 = body.filter((r) => r[col('orderNo')] === 'A-002');
    const a005 = body.find((r) => r[col('orderNo')] === 'A-005');
    expect(a001[col('waitSeconds')]).toBe('120');
    for (const r of a002) expect(r[col('waitSeconds')]).toBe('300');
    expect(a005[col('waitSeconds')]).toBe('');
  });

  it('writes a parseable createdAt and a blank readyAt when not ready', () => {
    const a001 = body.find((r) => r[col('orderNo')] === 'A-001');
    const a005 = body.find((r) => r[col('orderNo')] === 'A-005');
    expect(Number.isNaN(Date.parse(a001[col('createdAt')]))).toBe(false);
    expect(Number.isNaN(Date.parse(a001[col('readyAt')]))).toBe(false);
    expect(a005[col('readyAt')]).toBe('');
  });

  it('repeats the order-level columns on each of a multi-line order rows', () => {
    const a002 = body.filter((r) => r[col('orderNo')] === 'A-002');
    expect(a002).toHaveLength(2);
    for (const r of a002) {
      expect(r[col('name')]).toBe('Sam');
      expect(r[col('payment')]).toBe('card');
    }
    expect(a002.map((r) => r[col('item')]).sort()).toEqual(['Momo', 'Papri Chat']);
  });
});

describe('U-22 quoting and escaping', () => {
  const tricky = [
    {
      orderNo: 'A-007', till: 'A', day: DAY, name: 'Smith, Priya',
      items: [{ id: 'momo', name: 'Momo, large', qty: 1, price: 500 }],
      total: 500, payment: 'cash', status: 'collected',
      createdAtMs: londonMs(12, 0), readyAtMs: londonMs(12, 2)
    },
    {
      orderNo: 'A-008', till: 'A', day: DAY, name: 'O"Brien',
      items: [{ id: 'chat', name: 'Papri Chat', qty: 1, price: 500 }],
      total: 500, payment: 'card', status: 'collected',
      createdAtMs: londonMs(12, 10), readyAtMs: londonMs(12, 12)
    },
    {
      orderNo: 'A-009', till: 'A', day: DAY, name: 'Line\nBreak',
      items: [{ id: 'momo', name: 'Momo', qty: 1, price: 500 }],
      total: 500, payment: 'cash', status: 'collected',
      createdAtMs: londonMs(12, 20), readyAtMs: londonMs(12, 22)
    }
  ];
  const csv = ordersToCsv(tricky);
  const rows = parseCsv(csv);
  const col = (n) => rows[0].indexOf(n);

  it('wraps a name containing a comma in quotes', () => {
    expect(csv).toContain('"Smith, Priya"');
  });

  it('doubles an embedded double quote', () => {
    expect(csv).toContain('"O""Brien"');
  });

  it('round-trips every tricky value through an RFC4180 parse', () => {
    const names = rows.slice(1).map((r) => r[col('name')]);
    expect(names).toContain('Smith, Priya');
    expect(names).toContain('O"Brien');
    expect(names).toContain('Line\nBreak');
  });

  it('quotes an item name containing a comma', () => {
    const items = rows.slice(1).map((r) => r[col('item')]);
    expect(items).toContain('Momo, large');
    expect(csv).toContain('"Momo, large"');
  });

  it('keeps the field count correct despite the embedded separators', () => {
    for (const r of rows) expect(r).toHaveLength(COLUMNS);
  });

  it('csvEscape leaves plain values untouched', () => {
    expect(csvEscape('Priya')).toBe('Priya');
    expect(csvEscape(500)).toBe('500');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('a"b')).toBe('"a""b"');
  });
});

describe('U-23 cancelled rows', () => {
  it('either omits cancelled lines or marks them status=cancelled', () => {
    const rows = parseCsv(ordersToCsv(REPORT_ORDERS));
    const statusCol = rows[0].indexOf('status');
    const cancelled = rows.slice(1).filter((r) => r[statusCol] === 'cancelled');
    const fountain = rows.slice(1).filter((r) => r[rows[0].indexOf('item')].includes('Fountain'));
    // The only cancelled order is the Chocolate Fountain one.
    expect(fountain.length).toBe(cancelled.length);
  });
});

describe('U-28 the CSV carries no cash-received columns', () => {
  it('has exactly the thirteen Phase I columns and nothing about the tender', () => {
    const rows = parseCsv(ordersToCsv(REPORT_ORDERS));
    expect(rows[0]).toHaveLength(COLUMNS);
    expect(rows[0], 'cash received is screen-only (requirement change 2026-10-18)').not.toContain('tendered');
    expect(rows[0]).not.toContain('changeGiven');
  });

  it('ignores a stray tendered field on an order document', () => {
    // Even if an old document carries one, it must not reach the export.
    const csv = ordersToCsv([{
      orderNo: 'Z-001', till: 'Z', day: DAY, name: 'Legacy',
      items: [{ id: 'momo', name: 'Momo', qty: 1, price: 500 }],
      total: 500, payment: 'cash', tendered: 2000, changeGiven: 1500,
      status: 'collected', createdAtMs: londonMs(12, 0), readyAtMs: londonMs(12, 1)
    }]);
    const rows = parseCsv(csv);
    expect(rows[0].join(',')).toBe(HEADER);
    for (const r of rows) expect(r).toHaveLength(COLUMNS);
    expect(csv).not.toContain('2000');
    expect(csv).not.toContain('1500');
  });
});
