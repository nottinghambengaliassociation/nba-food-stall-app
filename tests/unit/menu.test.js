// H-01..H-06 — the menu seed, the icons, stationOf, and what happens to an
// order line whose item id the app no longer knows.
//
// Spec: CLAUDE.md -> "Menu" (the seven-row table, "This is the whole menu from
// v1.3.1: 7 items") and "Hotfix H3: phone cash counter layout (v1.3.1)" 7,
// which supersedes hotfix H1's ten-row menu:
//   * Chocolate Fountain is removed;
//   * `marshmallow` is renamed "Chocolate Marshmallow (V)" / "Choc Marshmallow";
//   * `samosa` and `straw` are deleted, not retired — the code keeps no
//     retired-id special cases at all;
//   * "Any item id the app doesn't know still renders with the name stored on
//     the order line and the plate icon."
// Plan: qa/test-plan.md sections 20, 23 and 28.
//
// This file tests the brief. Where the app disagrees with the table below,
// the app is wrong.
import { describe, it, expect } from 'vitest';
import * as logic from '../../public/js/logic.js';
import {
  MENU, stationOf, inStation, buildReport, ordersToCsv,
  lineShortName, lineFullName
} from '../../public/js/logic.js';
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
  { id: 'marshmallow', name: 'Chocolate Marshmallow (V)', short: 'Choc Marshmallow', price: 500, colour: '#FBCFE8', station: 'sweets', active: true, sort: 7 }
];

export const NEW_IDS = ['sweet_box', 'samosa_only', 'choc_strawberry', 'marshmallow'];
/** Deleted by H3. "Don't reuse those ids." */
export const GONE_IDS = ['samosa', 'straw', 'fountain'];
const ALL_IDS = BRIEF_MENU.map((m) => m.id);

const byId = (id) => MENU.find((m) => m.id === id);

/* ------------------------------------------------------------------ H-01 */

describe('H-01 the MENU seed is exactly the brief table', () => {
  it('has exactly seven rows', () => {
    expect(Array.isArray(MENU)).toBe(true);
    expect(MENU.map((m) => m.id).sort()).toEqual([...ALL_IDS].sort());
    expect(MENU).toHaveLength(7);
  });

  it('has unique ids — a deleted id is never reused', () => {
    const ids = MENU.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of GONE_IDS) {
      expect(ids, `CLAUDE.md H3 7: "${id}" is deleted and must not be in the seed`).not.toContain(id);
    }
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

  it('renames marshmallow (CLAUDE.md H3 7)', () => {
    expect(byId('marshmallow').name).toBe('Chocolate Marshmallow (V)');
    expect(byId('marshmallow').short).toBe('Choc Marshmallow');
  });
});

/* ------------------------------------------------------------------ H-02 */

describe('H-02 seven active items with sorts 1-7 and no retired rows', () => {
  it('every row is active', () => {
    expect(MENU.filter((m) => m.active === true).map((m) => m.id)).toEqual(ALL_IDS);
    expect(MENU.filter((m) => m.active === false),
      'CLAUDE.md H3 7 removes the retired rows from the seed entirely').toEqual([]);
  });

  it('their sorts are 1..7 with no gaps or duplicates', () => {
    const sorts = MENU.map((m) => m.sort).sort((a, b) => a - b);
    expect(sorts).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('in sort order the till reads fuchka, momo, chat, sweet_box, samosa_only, choc_strawberry, marshmallow', () => {
    const order = MENU.slice().sort((a, b) => a.sort - b.sort).map((m) => m.id);
    expect(order).toEqual(ALL_IDS);
  });

  it('ACTIVE_MENU holds the same seven items and none of the deleted ids', () => {
    expect(Array.isArray(logic.ACTIVE_MENU), 'logic.js must export ACTIVE_MENU for the till').toBe(true);
    const ids = logic.ACTIVE_MENU.slice().sort((a, b) => a.sort - b.sort).map((m) => m.id);
    expect(ids).toEqual(ALL_IDS);
    for (const id of GONE_IDS) {
      expect(ids, `deleted "${id}" must not be a till tile`).not.toContain(id);
    }
  });
});

/* ------------------------------------------------------------------ H-03 */

describe('H-03 stationOf knows every current id and nothing else', () => {
  it('all four sweets ids are sweets (CLAUDE.md Menu)', () => {
    for (const id of NEW_IDS) expect(stationOf(id), `stationOf("${id}")`).toBe('sweets');
  });

  it('keeps the Phase I stations', () => {
    expect(stationOf('fuchka')).toBe('chaat');
    expect(stationOf('chat')).toBe('chaat');
    expect(stationOf('momo')).toBe('momo');
  });

  it('a deleted id is unknown now, and still does not throw', () => {
    for (const id of GONE_IDS) {
      expect(() => stationOf(id)).not.toThrow();
      expect(stationOf(id),
        `CLAUDE.md H3 7: "Remove the retired-id special cases from the code (station lists ...)"`
      ).toBeFalsy();
    }
  });

  it('an unknown id is still falsy and still does not throw', () => {
    expect(() => stationOf('nope')).not.toThrow();
    expect(stationOf('nope')).toBeFalsy();
  });

  it('inStation keeps every current sweets line in the sweets filter', () => {
    for (const id of NEW_IDS) {
      expect(inStation(id, 'sweets'), `${id} in sweets`).toBe(true);
      expect(inStation(id, 'chaat'), `${id} in chaat`).toBe(false);
      expect(inStation(id, 'momo'), `${id} in momo`).toBe(false);
      expect(inStation(id, 'all')).toBe(true);
    }
  });

  it('an unknown id belongs to no station but is never filtered out of "All"', () => {
    for (const id of [...GONE_IDS, 'mystery_item']) {
      expect(inStation(id, 'all'), `${id} must survive the All filter`).toBe(true);
      for (const station of ['chaat', 'momo', 'sweets']) {
        expect(inStation(id, station), `${id} in ${station}`).toBe(false);
      }
    }
  });
});

/* ------------------------------------------------------------------ H-04 */

describe('H-04 an icon for every menu id, and a plate for anything else', () => {
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

  it('an unknown id gets the plate icon and never throws (CLAUDE.md Menu)', () => {
    for (const id of ['mystery_item', '', null, undefined]) {
      expect(() => itemIcon(id)).not.toThrow();
      expect(bodyOf(itemIcon(id)), `itemIcon(${JSON.stringify(id)}) must be the plate fallback`)
        .toBe(bodyOf(fallback));
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
 * A day that mixes orders written before the H3 reset (ids the app no longer
 * knows) with orders on the current menu. Nothing is migrated: the older lines
 * keep the names they were written with.
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
    items: [line('fountain', 'Chocolate Fountain', 1), line('marshmallow', 'Chocolate Marshmallow (V)', 2), line('sweet_box', 'Sweet Box', 1)],
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

describe('H-05 reports name older lines by the name stored on the line', () => {
  const report = buildReport(MIXED_ORDERS);
  const row = (id) => report.byItem.find((x) => x.id === id);

  it('keeps old and new ids as separate rows — nothing is merged', () => {
    expect(report.byItem.map((x) => x.id).sort()).toEqual(
      ['choc_strawberry', 'fountain', 'marshmallow', 'samosa', 'samosa_only', 'straw', 'sweet_box']
    );
  });

  it('an older samosa line reports as "Sweets Box Samosa / Shingara"', () => {
    expect(row('samosa')).toMatchObject({ name: 'Sweets Box Samosa / Shingara', units: 2, revenue: 1000 });
  });

  it('a current samosa_only line reports as "Samosa", separately', () => {
    expect(row('samosa_only')).toMatchObject({ name: 'Samosa', units: 3, revenue: 1500 });
  });

  it('a deleted fountain line still reports under its stored name', () => {
    expect(row('fountain')).toMatchObject({ name: 'Chocolate Fountain', units: 1, revenue: 500 });
  });

  it('the current items report under their current names', () => {
    expect(row('choc_strawberry')).toMatchObject({ name: 'Chocolate Strawberry', units: 2, revenue: 1000 });
    expect(row('marshmallow')).toMatchObject({ name: 'Chocolate Marshmallow (V)', units: 2, revenue: 1000 });
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

/* ------------------------------------------- H-05b the unknown-id fallback */

describe('H-05b an unknown item id falls back to the stored line name', () => {
  it('lineShortName and lineFullName use the stored name', () => {
    const l = { id: 'mystery_item', name: 'Mystery Item', qty: 1, price: 500 };
    expect(lineShortName(l)).toBe('Mystery Item');
    expect(lineFullName(l)).toBe('Mystery Item');
  });

  it('a deleted id is named from the order line, not from a leftover seed row', () => {
    for (const [id, name] of [
      ['samosa', 'Sweets Box Samosa / Shingara'],
      ['straw', 'Chocolate Strawberry & Marshmallow (V)'],
      ['fountain', 'Chocolate Fountain']
    ]) {
      const l = { id, name, qty: 1, price: 500 };
      expect(lineShortName(l), `lineShortName for the deleted id "${id}"`).toBe(name);
      expect(lineFullName(l), `lineFullName for the deleted id "${id}"`).toBe(name);
    }
  });

  it('a current id still uses the menu wording', () => {
    const l = { id: 'marshmallow', name: 'Chocolate Marshmallow (V)', qty: 1, price: 500 };
    expect(lineShortName(l)).toBe('Choc Marshmallow');
    expect(lineFullName(l)).toBe('Chocolate Marshmallow (V)');
  });

  it('a line with neither a known id nor a stored name degrades to the id, never to a crash', () => {
    expect(() => lineShortName({ id: 'ghost_item' })).not.toThrow();
    expect(lineShortName({ id: 'ghost_item' })).toBe('ghost_item');
    expect(() => lineFullName({})).not.toThrow();
    expect(lineFullName({})).toBe('');
  });
});

/* ------------------------------------------------------------------ H-06 */

describe('H-06 CSV exports older lines under their stored names', () => {
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

  it('an older samosa line exports as "Sweets Box Samosa / Shingara"', () => {
    const r = body.find((x) => col(x, 'orderNo') === 'A-001');
    expect(col(r, 'item')).toBe('Sweets Box Samosa / Shingara');
    expect(col(r, 'qty')).toBe('2');
    expect(col(r, 'lineTotal')).toBe('1000');
  });

  it('an older straw line exports as "Chocolate Strawberry & Marshmallow (V)"', () => {
    const names = body.filter((x) => col(x, 'orderNo') === 'A-002' || col(x, 'orderNo') === 'A-003')
      .map((x) => col(x, 'item'));
    expect(names).toContain('Chocolate Strawberry & Marshmallow (V)');
  });

  it('current lines export under their current names', () => {
    const names = body.map((x) => col(x, 'item'));
    expect(names).toContain('Samosa');
    expect(names).toContain('Chocolate Strawberry');
    expect(names).toContain('Chocolate Marshmallow (V)');
    expect(names).toContain('Sweet Box');
  });

  it('never rewrites an older name into a current one', () => {
    const a001 = body.filter((x) => col(x, 'orderNo') === 'A-001').map((x) => col(x, 'item'));
    expect(a001).toEqual(['Sweets Box Samosa / Shingara']);
    expect(a001).not.toContain('Samosa');
  });

  it('survives a round trip through the parser unchanged', () => {
    const raw = ordersToCsv(MIXED_ORDERS);
    expect(raw).toContain('Sweets Box Samosa / Shingara');
    expect(raw).toContain('Chocolate Strawberry & Marshmallow (V)');
    expect(raw).toContain('Chocolate Marshmallow (V)');
    expect(raw).toContain('Chocolate Fountain');
  });
});
