// H-01..H-06 — Hotfix H1 (18 Oct 2026): the ten-row menu, the four new icons,
// stationOf over retired ids, and backwards compatibility of orders that hold
// the retired ids `samosa` and `straw`.
//
// Spec: CLAUDE.md -> "Menu" (the ten-row table) and "Hotfix H1: split menu
// items (18 Oct 2026)" 1-6. Plan: qa/test-plan.md sections 20 and 23.
//
// This file tests the brief. Where the app disagrees with the table below,
// the app is wrong.
import { describe, it, expect } from 'vitest';
import * as logic from '../../public/js/logic.js';
import { MENU, stationOf, inStation, buildReport, ordersToCsv } from '../../public/js/logic.js';
import { itemIcon } from '../../public/js/icons.js';
import { parseCsv } from './fixtures.js';

/** CLAUDE.md -> Menu, transcribed verbatim. The single source of truth here. */
const BRIEF_MENU = [
  { id: 'fuchka', name: 'Fuchka / Gol Gappa', short: 'Fuchka', price: 500, colour: '#FDE68A', station: 'chaat', active: true, sort: 1 },
  { id: 'momo', name: 'Momo', short: 'Momo', price: 500, colour: '#BFDBFE', station: 'momo', active: true, sort: 2 },
  { id: 'chat', name: 'Papri Chat', short: 'Papri Chat', price: 500, colour: '#FECACA', station: 'chaat', active: true, sort: 3 },
  { id: 'sweet_box', name: 'Sweet Box', short: 'Sweet Box', price: 500, colour: '#FED7AA', station: 'sweets', active: true, sort: 4 },
  { id: 'samosa_only', name: 'Samosa', short: 'Samosa', price: 500, colour: '#D9F99D', station: 'sweets', active: true, sort: 5 },
  { id: 'choc_strawberry', name: 'Chocolate Strawberry', short: 'Choc Strawberry', price: 500, colour: '#E9D5FF', station: 'sweets', active: true, sort: 6 },
  { id: 'marshmallow', name: 'Marshmallow (V)', short: 'Marshmallow', price: 500, colour: '#FBCFE8', station: 'sweets', active: true, sort: 7 },
  { id: 'fountain', name: 'Chocolate Fountain', short: 'Choc Fountain', price: 500, colour: '#E7D3BF', station: 'sweets', active: true, sort: 8 },
  { id: 'samosa', name: 'Sweets Box Samosa / Shingara', short: 'Sweets Box', price: 500, colour: '#FED7AA', station: 'sweets', active: false, sort: 90 },
  { id: 'straw', name: 'Chocolate Strawberry & Marshmallow (V)', short: 'Choc Strawberry', price: 500, colour: '#E9D5FF', station: 'sweets', active: false, sort: 91 }
];

export const NEW_IDS = ['sweet_box', 'samosa_only', 'choc_strawberry', 'marshmallow'];
export const RETIRED_IDS = ['samosa', 'straw'];
const ACTIVE_IDS = BRIEF_MENU.filter((m) => m.active).map((m) => m.id);

const byId = (id) => MENU.find((m) => m.id === id);

/* ------------------------------------------------------------------ H-01 */

describe('H-01 the MENU seed is exactly the brief table', () => {
  it('has exactly ten rows', () => {
    expect(Array.isArray(MENU)).toBe(true);
    expect(MENU.map((m) => m.id).sort()).toEqual(BRIEF_MENU.map((m) => m.id).sort());
    expect(MENU).toHaveLength(10);
  });

  it('has unique ids — a retired id is never reused', () => {
    const ids = MENU.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const want of BRIEF_MENU) {
    it(`${want.id} matches the table field for field`, () => {
      const got = byId(want.id);
      expect(got, `menu row "${want.id}" is missing from MENU`).toBeTruthy();
      expect(got.name).toBe(want.name);
      expect(got.short).toBe(want.short);
      expect(got.price).toBe(want.price);
      expect(Number.isInteger(got.price), 'price must be integer pence').toBe(true);
      expect(String(got.colour).toUpperCase()).toBe(want.colour);
      expect(got.station).toBe(want.station);
      expect(got.active).toBe(want.active);
      expect(got.sort).toBe(want.sort);
    });
  }

  it('prices are £5 everywhere', () => {
    expect(MENU.every((m) => m.price === 500)).toBe(true);
  });
});

/* ------------------------------------------------------------------ H-02 */

describe('H-02 eight active items with sorts 1-8, two retired', () => {
  it('eight rows are active', () => {
    expect(MENU.filter((m) => m.active === true).map((m) => m.id)).toEqual(ACTIVE_IDS);
  });

  it('their sorts are 1..8 with no gaps or duplicates', () => {
    const sorts = MENU.filter((m) => m.active === true).map((m) => m.sort).sort((a, b) => a - b);
    expect(sorts).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('in sort order the till reads fuchka, momo, chat, sweet_box, samosa_only, choc_strawberry, marshmallow, fountain', () => {
    const order = MENU.filter((m) => m.active === true)
      .slice()
      .sort((a, b) => a.sort - b.sort)
      .map((m) => m.id);
    expect(order).toEqual(ACTIVE_IDS);
  });

  it('exactly samosa (90) and straw (91) are retired', () => {
    const retired = MENU.filter((m) => m.active === false);
    expect(retired.map((m) => m.id).sort()).toEqual([...RETIRED_IDS].sort());
    expect(byId('samosa').sort).toBe(90);
    expect(byId('straw').sort).toBe(91);
  });

  it('ACTIVE_MENU holds the eight active items and neither retired id', () => {
    expect(Array.isArray(logic.ACTIVE_MENU), 'logic.js must export ACTIVE_MENU for the till').toBe(true);
    const ids = logic.ACTIVE_MENU.slice().sort((a, b) => a.sort - b.sort).map((m) => m.id);
    expect(ids).toEqual(ACTIVE_IDS);
    for (const id of RETIRED_IDS) {
      expect(ids, `retired "${id}" must not be a till tile`).not.toContain(id);
    }
  });
});

/* ------------------------------------------------------------------ H-03 */

describe('H-03 stationOf knows every id, old and new', () => {
  it('all four new ids are sweets (CLAUDE.md H1 3)', () => {
    for (const id of NEW_IDS) expect(stationOf(id), `stationOf("${id}")`).toBe('sweets');
  });

  it('keeps the Phase I stations', () => {
    expect(stationOf('fuchka')).toBe('chaat');
    expect(stationOf('chat')).toBe('chaat');
    expect(stationOf('momo')).toBe('momo');
    expect(stationOf('fountain')).toBe('sweets');
  });

  it('still resolves the retired ids rather than throwing or defaulting', () => {
    for (const id of RETIRED_IDS) {
      expect(() => stationOf(id)).not.toThrow();
      expect(stationOf(id), `retired "${id}" must still resolve to sweets`).toBe('sweets');
    }
  });

  it('an unknown id is still falsy and still does not throw', () => {
    expect(() => stationOf('nope')).not.toThrow();
    expect(stationOf('nope')).toBeFalsy();
  });

  it('inStation filters retired and new lines the same way', () => {
    for (const id of [...RETIRED_IDS, ...NEW_IDS]) {
      expect(inStation(id, 'sweets'), `${id} in sweets`).toBe(true);
      expect(inStation(id, 'chaat'), `${id} in chaat`).toBe(false);
      expect(inStation(id, 'momo'), `${id} in momo`).toBe(false);
      expect(inStation(id, 'all')).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ H-04 */

describe('H-04 icons for the four new ids, retired icons kept', () => {
  const fallback = itemIcon('definitely-not-a-menu-id');

  const bodyOf = (svg) => String(svg).replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

  it('the fallback is a real svg (so the comparison below means something)', () => {
    expect(fallback).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
  });

  for (const { id } of BRIEF_MENU) {
    it(`${id} has its own icon, not the unknown fallback`, () => {
      const svg = itemIcon(id);
      expect(svg, `itemIcon("${id}") must return inline svg markup`).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
      expect(bodyOf(svg).length, `itemIcon("${id}") is empty`).toBeGreaterThan(0);
      expect(bodyOf(svg), `itemIcon("${id}") falls through to the unknown plate icon`).not.toBe(bodyOf(fallback));
    });
  }

  it('keeps the samosa and straw icons for old orders (CLAUDE.md H1 2)', () => {
    for (const id of RETIRED_IDS) {
      expect(bodyOf(itemIcon(id)), `the "${id}" icon was removed; old orders still need it`).not.toBe(bodyOf(fallback));
    }
  });

  it('icons are decorative stroke SVG with no emoji', () => {
    for (const { id } of BRIEF_MENU) {
      const svg = itemIcon(id);
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('focusable="false"');
      expect(svg).toMatch(/stroke="currentColor"/);
      expect(svg).toMatch(/fill="none"/);
      // No emoji / pictographic code points anywhere in the markup.
      expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(svg), `${id} icon contains an emoji`).toBe(false);
    }
  });

  it('honours the requested size', () => {
    expect(itemIcon('marshmallow', 32)).toContain('width="32"');
    expect(itemIcon('marshmallow', 32)).toContain('height="32"');
  });
});

/* ------------------------------------------- H-05 / H-06 fixtures --------- */

const P = 500;
const line = (id, name, qty) => (name === null ? { id, qty, price: P } : { id, name, qty, price: P });
const DAY = '2026-10-18';
const t = (h, m) => Date.UTC(2026, 9, 18, h - 1, m); // BST

/**
 * A day that mixes real 17-Oct orders (retired ids) with 18-Oct orders
 * (new ids). Nothing is migrated: the legacy lines keep the names they were
 * written with, and one legacy line has no stored name at all so the seed has
 * to supply it.
 */
const MIXED_ORDERS = [
  {
    orderNo: 'A-001', name: 'Lucy', till: 'A', day: DAY,
    items: [line('samosa', 'Sweets Box Samosa / Shingara', 2)],
    total: 1000, payment: 'cash', status: 'collected',
    createdAtMs: t(12, 0), readyAtMs: t(12, 3), collectedAtMs: t(12, 4)
  },
  {
    orderNo: 'A-002', name: 'Dev', till: 'A', day: DAY,
    items: [line('straw', 'Chocolate Strawberry & Marshmallow (V)', 1), line('samosa_only', 'Samosa', 3)],
    total: 2000, payment: 'card', status: 'collected',
    createdAtMs: t(12, 10), readyAtMs: t(12, 14), collectedAtMs: t(12, 15)
  },
  {
    orderNo: 'A-003', name: 'Nadia', till: 'A', day: DAY,
    // A legacy line written without a `name` field: the retired MENU row is
    // the only thing that can name it.
    items: [line('straw', null, 1), line('marshmallow', 'Marshmallow (V)', 2), line('sweet_box', 'Sweet Box', 1)],
    total: 2000, payment: 'cash', status: 'ready',
    createdAtMs: t(12, 40), readyAtMs: t(12, 45)
  },
  {
    orderNo: 'A-004', name: 'Ria', till: 'A', day: DAY,
    items: [line('choc_strawberry', 'Chocolate Strawberry', 2)],
    total: 1000, payment: 'card', status: 'new',
    createdAtMs: t(13, 5)
  }
];

/* ------------------------------------------------------------------ H-05 */

describe('H-05 reports name legacy lines by their original name', () => {
  const report = buildReport(MIXED_ORDERS);
  const row = (id) => report.byItem.find((x) => x.id === id);

  it('keeps old and new ids as separate rows — nothing is merged', () => {
    expect(report.byItem.map((x) => x.id).sort()).toEqual(
      ['choc_strawberry', 'marshmallow', 'samosa', 'samosa_only', 'straw', 'sweet_box']
    );
  });

  it('a legacy samosa line reports as "Sweets Box Samosa / Shingara"', () => {
    expect(row('samosa')).toMatchObject({ name: 'Sweets Box Samosa / Shingara', units: 2, revenue: 1000 });
  });

  it('a new samosa_only line reports as "Samosa", separately', () => {
    expect(row('samosa_only')).toMatchObject({ name: 'Samosa', units: 3, revenue: 1500 });
  });

  it('a legacy straw line with no stored name falls back to the retired seed row', () => {
    expect(row('straw')).toMatchObject({
      name: 'Chocolate Strawberry & Marshmallow (V)', units: 2, revenue: 1000
    });
  });

  it('the new split items report under their new names', () => {
    expect(row('choc_strawberry')).toMatchObject({ name: 'Chocolate Strawberry', units: 2, revenue: 1000 });
    expect(row('marshmallow')).toMatchObject({ name: 'Marshmallow (V)', units: 2, revenue: 1000 });
    expect(row('sweet_box')).toMatchObject({ name: 'Sweet Box', units: 1, revenue: 500 });
  });

  it('totals still add up across the mixed day', () => {
    expect(report.totalSales).toBe(6000);
    expect(report.orderCount).toBe(4);
    expect(report.itemsSold).toBe(12);
    expect(report.byItem.reduce((a, b) => a + b.revenue, 0)).toBe(report.totalSales);
    expect(report.byItem.reduce((a, b) => a + b.units, 0)).toBe(report.itemsSold);
  });
});

/* ------------------------------------------------------------------ H-06 */

describe('H-06 CSV exports legacy lines under their original names', () => {
  const rows = parseCsv(ordersToCsv(MIXED_ORDERS));
  const header = rows[0];
  const col = (r, name) => r[header.indexOf(name)];
  const body = rows.slice(1);

  it('keeps the thirteen Phase I columns', () => {
    expect(header).toEqual([
      'day', 'orderNo', 'till', 'name', 'item', 'qty', 'price',
      'lineTotal', 'payment', 'status', 'createdAt', 'readyAt', 'waitSeconds'
    ]);
  });

  it('writes one row per order line', () => {
    expect(body).toHaveLength(MIXED_ORDERS.reduce((n, o) => n + o.items.length, 0));
  });

  it('a legacy samosa line exports as "Sweets Box Samosa / Shingara"', () => {
    const r = body.find((x) => col(x, 'orderNo') === 'A-001');
    expect(col(r, 'item')).toBe('Sweets Box Samosa / Shingara');
    expect(col(r, 'qty')).toBe('2');
    expect(col(r, 'lineTotal')).toBe('1000');
  });

  it('a legacy straw line exports as "Chocolate Strawberry & Marshmallow (V)"', () => {
    const names = body.filter((x) => col(x, 'orderNo') === 'A-002' || col(x, 'orderNo') === 'A-003')
      .map((x) => col(x, 'item'));
    expect(names).toContain('Chocolate Strawberry & Marshmallow (V)');
  });

  it('new lines export under their new names', () => {
    const names = body.map((x) => col(x, 'item'));
    expect(names).toContain('Samosa');
    expect(names).toContain('Chocolate Strawberry');
    expect(names).toContain('Marshmallow (V)');
    expect(names).toContain('Sweet Box');
  });

  it('never rewrites a legacy name into a new one', () => {
    const a001 = body.filter((x) => col(x, 'orderNo') === 'A-001').map((x) => col(x, 'item'));
    expect(a001).toEqual(['Sweets Box Samosa / Shingara']);
    expect(a001).not.toContain('Samosa');
  });

  it('survives a round trip through the parser unchanged', () => {
    const raw = ordersToCsv(MIXED_ORDERS);
    expect(raw).toContain('Sweets Box Samosa / Shingara');
    expect(raw).toContain('Chocolate Strawberry & Marshmallow (V)');
    expect(raw).toContain('Marshmallow (V)');
  });
});
