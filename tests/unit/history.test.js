// P6-U-01..P6-U-10 — Phase VI (v1.5.0): Order history.
//
// Source of truth: CLAUDE.md -> "Phase VI: Order history in Reports (v1.5.0)",
// requirements 1-10, and the mock-ups design/ReportsHistory.dc.html and
// design/ReportsHistoryMobile.dc.html. The plan for these cases is
// qa/test-plan.md sections 58-59.
//
// These tests check the brief, not the implementation: every figure comes from
// the hand-calculated tables in tests/unit/history-fixtures.js.

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as logic from '../../public/js/logic.js';
import { parseCsv } from './fixtures.js';
import {
  D, T, HISTORY_ORDERS, DEFAULT_RANGE, DEFAULT_IDS, DEFAULT_SUMMARY, DAY_GROUPS,
  FILTER_CASES, RANGE_CASES, byId, inRange, ids, line, bstMs
} from './history-fixtures.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Resolve an export by any of several plausible names, or fail loudly. */
function fn(...names) {
  for (const name of names) if (typeof logic[name] === 'function') return logic[name];
  throw new Error(`logic.js exports none of: ${names.join(', ')}`);
}

const clampHistoryRange = fn('clampHistoryRange');
const filterHistory = fn('filterHistory');
const groupByDay = fn('groupByDay');
const historySummary = fn('historySummary');
const orderChanges = fn('orderChanges');
const historyEdits = fn('historyEdits');
const historyHash = fn('historyHash');
const parseHistoryHash = fn('parseHistoryHash');
const historyCsvFilename = fn('historyCsvFilename');
const historyToCsv = fn('historyToCsv');
const isLargeHistory = fn('isLargeHistory');
const historyTills = fn('historyTills');
const historyItems = fn('historyItems');
const historyCancelLine = fn('historyCancelLine');
const historyFilterCount = fn('historyFilterCount');
const defaultRange = fn('defaultRange');
const todayRange = fn('todayRange');
const last30Range = fn('last30Range');
const yearRange = fn('yearRange');

const DEFAULT_ORDERS = inRange(DEFAULT_RANGE.from, DEFAULT_RANGE.to);

/* ================================================================ P6-U-01 */

describe('P6-U-01 clampHistoryRange (CLAUDE.md Phase VI 2)', () => {
  it('leaves a sane range alone and counts the days inclusively', () => {
    const r = clampHistoryRange(D.t6, D.t);
    expect(r.from).toBe(D.t6);
    expect(r.to).toBe(D.t);
    expect(r.dayCount, 'T-6 to T inclusive is 7 days').toBe(7);
    expect(r.tooLong).toBe(false);
    expect(r.error).toBeFalsy();
  });

  it('swaps To before From rather than erroring', () => {
    const r = clampHistoryRange(D.t, D.t6);
    expect(r.from, 'CLAUDE.md Phase VI 2: "To before From swaps them"').toBe(D.t6);
    expect(r.to).toBe(D.t);
    expect(r.swapped).toBe(true);
    expect(r.tooLong).toBe(false);
  });

  it('treats one day as a one-day range', () => {
    const r = clampHistoryRange(D.t, D.t);
    expect(r.dayCount).toBe(1);
    expect(r.tooLong).toBe(false);
  });

  it('accepts 366 days and rejects 367 with the brief\'s message', () => {
    const ok = clampHistoryRange('2025-10-20', T);              // 366 days inclusive
    expect(ok.dayCount, 'inclusive counting: 2025-10-20..2026-10-20').toBe(366);
    expect(ok.tooLong, 'CLAUDE.md Phase VI 2: "Maximum 366 days"').toBe(false);
    expect(ok.error).toBeFalsy();

    const tooLong = clampHistoryRange('2025-10-19', T);         // 367 days
    expect(tooLong.dayCount).toBe(367);
    expect(tooLong.tooLong, '367 days is over the maximum').toBe(true);
    expect(tooLong.error, 'CLAUDE.md Phase VI 2: "Pick 366 days or fewer"')
      .toBe('Pick 366 days or fewer');
    expect(logic.HISTORY_TOO_LONG_MESSAGE).toBe('Pick 366 days or fewer');
    expect(logic.HISTORY_MAX_DAYS).toBe(366);
  });

  it('never throws on rubbish', () => {
    for (const args of [[null, null], ['', ''], ['nonsense', T], [undefined, undefined], [5, {}]]) {
      expect(() => clampHistoryRange(...args)).not.toThrow();
    }
    expect(clampHistoryRange(null, T).from, 'one date given is a one-day range').toBe(T);
  });

  it('resolves the five quick ranges', () => {
    expect(todayRange(T)).toEqual({ from: T, to: T });
    expect(defaultRange(T), 'Last 7 days ends today').toEqual({ from: D.t6, to: T });
    expect(last30Range(T), 'Last 30 days ends today').toEqual({ from: D.t29, to: T });
    expect(yearRange(T), 'This year is 1 Jan to today').toEqual({ from: '2026-01-01', to: T });
    for (const r of [todayRange(T), defaultRange(T), last30Range(T), yearRange(T)]) {
      expect(clampHistoryRange(r.from, r.to).tooLong, 'no quick range is ever too long').toBe(false);
    }
  });
});

/* ================================================================ P6-U-02 */

describe('P6-U-02 filterHistory (CLAUDE.md Phase VI 3, 4)', () => {
  for (const c of FILTER_CASES) {
    it(`${c.label} leaves exactly the hand-counted orders`, () => {
      const got = filterHistory(DEFAULT_ORDERS, c.options);
      expect(ids(got).sort()).toEqual(c.ids.slice().sort());
    });
  }

  it('matches the unknown item id by its own id, in a wider range', () => {
    const wide = inRange(D.t29, D.t);
    expect(ids(filterHistory(wide, { item: 'fountain' })), 'the retired id is still an id')
      .toEqual(['h12']);
  });

  it('searches order number or name only, trimmed and case-insensitively', () => {
    expect(ids(filterHistory(DEFAULT_ORDERS, { q: 'B-0' }))).toEqual(['h04', 'h10']);
    expect(ids(filterHistory(DEFAULT_ORDERS, { q: 'meer' }))).toEqual(['h04']);
    expect(filterHistory(DEFAULT_ORDERS, { q: 'Momo' }), 'an item name matches nothing')
      .toEqual([]);
    expect(filterHistory(DEFAULT_ORDERS, { q: '   ' }), 'a blank search matches everything')
      .toHaveLength(DEFAULT_ORDERS.length);
  });

  it('accepts the hash forms of "edited"', () => {
    for (const value of [true, '1', 'true']) {
      expect(ids(filterHistory(DEFAULT_ORDERS, { edited: value }))).toEqual(['h05', 'h10']);
    }
    expect(filterHistory(DEFAULT_ORDERS, { edited: false })).toHaveLength(DEFAULT_ORDERS.length);
  });

  it('lists cancelled orders like any other', () => {
    const all = filterHistory(DEFAULT_ORDERS, {});
    expect(ids(all), 'CLAUDE.md Phase VI 7: cancelled orders are listed').toContain('h02');
    expect(ids(all)).toContain('h08');
  });

  it('never throws, and never mutates or reorders its input', () => {
    for (const bad of [null, undefined, [], [null], 'nope', 42]) {
      expect(() => filterHistory(bad, {})).not.toThrow();
    }
    expect(() => filterHistory(DEFAULT_ORDERS)).not.toThrow();
    const before = JSON.stringify(DEFAULT_ORDERS);
    const snapshot = DEFAULT_ORDERS.slice();
    filterHistory(DEFAULT_ORDERS, { status: 'collected', q: 'a' });
    expect(JSON.stringify(DEFAULT_ORDERS), 'read-only screen: the orders are untouched').toBe(before);
    expect(DEFAULT_ORDERS).toEqual(snapshot);
  });
});

/* ================================================================ P6-U-03 */

describe('P6-U-03 groupByDay (CLAUDE.md Phase VI 6)', () => {
  const groups = groupByDay(filterHistory(DEFAULT_ORDERS, {}));

  it('puts the newest day first and the newest order first inside it', () => {
    expect(groups.map((g) => g.day)).toEqual(DAY_GROUPS.map((g) => g.day));
    expect(groups.map((g) => ids(g.orders))).toEqual(DAY_GROUPS.map((g) => g.ids));
  });

  it('labels each day "Sun 18 Oct 2026" style, with the year', () => {
    expect(groups.map((g) => g.label)).toEqual(DAY_GROUPS.map((g) => g.label));
  });

  it('gives each day its own count, total and cancelled clause', () => {
    expect(groups.map((g) => g.meta)).toEqual(DAY_GROUPS.map((g) => g.meta));
    expect(groups[0].count).toBe(3);
    expect(groups[0].total, 'the cancelled £5.00 is out of the day total').toBe(2000);
    expect(groups[0].cancelled).toBe(1);
    expect(groups[1].meta, 'no clause when nothing in the day is cancelled')
      .not.toMatch(/excludes/);
  });

  it('keeps a day whose only order is cancelled, totalling £0.00', () => {
    const only = groupByDay([byId('h02')]);
    expect(only).toHaveLength(1);
    expect(only[0].total).toBe(0);
    expect(only[0].meta).toBe('1 orders · £0.00 (excludes 1 cancelled)');
  });

  it('flattens back to the same order the screen shows', () => {
    const flat = logic.flattenHistory(groups);
    expect(ids(flat)).toEqual(DEFAULT_IDS);
  });

  it('does not throw on half-written orders', () => {
    expect(() => groupByDay([{ day: D.t }, { }, null])).not.toThrow();
    expect(() => logic.flattenHistory(null)).not.toThrow();
  });
});

/* ================================================================ P6-U-04 */

describe('P6-U-04 historySummary (CLAUDE.md Phase VI 5)', () => {
  it('matches the hand-calculated default view', () => {
    const s = historySummary(DEFAULT_ORDERS);
    expect(s.orders).toBe(DEFAULT_SUMMARY.orders);
    expect(s.tradingDays).toBe(DEFAULT_SUMMARY.tradingDays);
    expect(s.daysNote).toBe('across 4 trading days');
    expect(s.sales).toBe(DEFAULT_SUMMARY.sales);
    expect(s.cancelled).toBe(DEFAULT_SUMMARY.cancelled);
    expect(s.cancelledValue).toBe(DEFAULT_SUMMARY.cancelledValue);
    expect(s.cancelledNote).toBe('£10.00 not taken');
    expect(s.edited).toBe(DEFAULT_SUMMARY.edited);
    expect(s.text).toBe(DEFAULT_SUMMARY.text);
  });

  for (const c of RANGE_CASES) {
    it(`${c.label}: ${c.ids.length} orders, ${c.sales}p, ${c.days} trading days`, () => {
      const s = historySummary(inRange(c.from, c.to));
      expect(s.orders).toBe(c.ids.length);
      expect(s.sales).toBe(c.sales);
      expect(s.cancelled).toBe(c.cancelled);
      expect(s.tradingDays).toBe(c.days);
    });
  }

  for (const c of FILTER_CASES) {
    it(`${c.label}: the tiles follow the filter`, () => {
      const s = historySummary(filterHistory(DEFAULT_ORDERS, c.options));
      expect(s.orders).toBe(c.ids.length);
      expect(s.sales, 'cancelled orders never add to Sales').toBe(c.sales);
      expect(s.cancelled).toBe(c.cancelled);
    });
  }

  it('drops the "(excludes …)" clause when nothing in view is cancelled', () => {
    const collected = filterHistory(DEFAULT_ORDERS, { status: 'collected' });
    expect(historySummary(collected).text).toBe('5 orders · £60.00');
    const cancelled = filterHistory(DEFAULT_ORDERS, { status: 'cancelled' });
    expect(historySummary(cancelled).text, 'the rows count, the money does not')
      .toBe('2 orders · £0.00 (excludes 2 cancelled)');
  });

  it('gives zeroes, never NaN, for an empty list', () => {
    const s = historySummary([]);
    expect(s.orders).toBe(0);
    expect(s.sales).toBe(0);
    expect(s.cancelled).toBe(0);
    expect(s.tradingDays).toBe(0);
    expect(s.text).toBe('0 orders · £0.00');
    expect(s.daysNote).toBe('across 0 trading days');
    expect(JSON.stringify(s)).not.toMatch(/NaN|Infinity/);
  });

  it('counts a single trading day in the singular', () => {
    expect(historySummary(inRange(D.t, D.t)).daysNote).toBe('across 1 trading day');
  });
});

/* ------------------------------------- the Till and Item lists, Phase VI 4 */

describe('P6-U-04b the filter option lists are built from the loaded orders', () => {
  it('offers every till letter in range, and only those', () => {
    expect(historyTills(DEFAULT_ORDERS).map((t) => t.key)).toEqual(['all', 'A', 'B', 'C']);
    expect(historyTills(inRange(D.t, D.t)).map((t) => t.key), 'only till A traded today')
      .toEqual(['all', 'A']);
    expect(historyTills([])).toEqual([{ key: 'all', label: 'All tills' }]);
  });

  it('offers the menu plus any other id found on a line, by its stored name', () => {
    const narrow = historyItems(DEFAULT_ORDERS).map((i) => i.key);
    expect(narrow[0]).toBe('all');
    expect(narrow, 'the whole menu is always offered').toContain('samosa_chat');
    expect(narrow, 'nothing in the default range carries the retired id').not.toContain('fountain');

    const wide = historyItems(inRange(D.t29, D.t));
    const found = wide.find((i) => i.key === 'fountain');
    expect(found, 'CLAUDE.md Phase VI 4: "any other item id found on loaded order lines"').toBeTruthy();
    expect(found.label, 'shown by its stored name').toBe('Chocolate Fountain');
  });

  it('counts the active filters for the phone Filters button', () => {
    expect(historyFilterCount({})).toBe(0);
    expect(historyFilterCount({ status: 'all', pay: 'all', till: 'all', item: 'all', edited: false, q: 'x' }))
      .toBe(0);
    expect(historyFilterCount({ status: 'collected', till: 'B', edited: true })).toBe(3);
  });
});

/* ================================================================ P6-U-05 */

describe('P6-U-05 orderChanges / historyEdits (CLAUDE.md Phase VI 7)', () => {
  it('builds one box for a single edit, with no money difference', () => {
    const boxes = historyEdits(byId('h05'));
    expect(boxes).toHaveLength(1);
    expect(boxes[0].head).toBe('Edited 15:13 at till A while Preparing');
    expect(boxes[0].beforeText).toBe('2× Momo, 1× Papri Chat · £15.00');
    expect(boxes[0].afterText).toBe('3× Momo · £15.00');
    expect(boxes[0].money).toBe('No payment change');
  });

  it('chains two edits, the last one ending at the order as stored', () => {
    const boxes = historyEdits(byId('h10'));
    expect(boxes, 'oldest first').toHaveLength(2);
    expect(boxes[0].head).toBe('Edited 16:33 at till B while New');
    expect(boxes[0].beforeText).toBe('1× Sweet Box · £5.00');
    expect(boxes[0].afterText, 'the "after" of one edit is the "before" of the next')
      .toBe('3× Sweet Box · £15.00');
    expect(boxes[0].money).toBe('Took £10.00 more');

    expect(boxes[1].head).toBe('Edited 16:36 at till A while Preparing');
    expect(boxes[1].beforeText).toBe('3× Sweet Box · £15.00');
    expect(boxes[1].afterText, 'the last "after" is the order as it stands').toBe('2× Sweet Box · £10.00');
    expect(boxes[1].money).toBe('Gave back £5.00');
  });

  it('gives nothing for an unedited order and for a pre-Phase-V order', () => {
    expect(historyEdits(byId('h01')), 'never edited').toEqual([]);
    const old = byId('h11');
    expect(old.history, 'the Phase I fixture really has no history field').toBeUndefined();
    expect(old.tendered, 'and really does carry the Phase I field').toBe(2000);
    expect(historyEdits(old), 'CLAUDE.md Phase VI 7: no Changes section, no error').toEqual([]);
    expect(() => orderChanges(old)).not.toThrow();
    expect(() => orderChanges(null)).not.toThrow();
    expect(() => orderChanges({ history: 'rubbish' })).not.toThrow();
  });

  it('does not count a cancel entry as an edit', () => {
    const cancelled = byId('h02');
    expect(orderChanges(cancelled).map((c) => c.action)).toEqual(['cancel']);
    expect(historyEdits(cancelled), 'Changes lists edits only').toEqual([]);
  });

  it('builds the cancelled box line, with the status before', () => {
    expect(historyCancelLine(byId('h08')))
      .toBe('Cancelled 11:23 · Not collected · was Ready');
    expect(historyCancelLine(byId('h02')))
      .toBe('Cancelled 13:09 · Placed by mistake · was New');
    expect(historyCancelLine(byId('h01')), 'nothing for an order that was not cancelled').toBe('');
  });

  it('adds an Edited step per edit to the timeline, in time order', () => {
    const steps = logic.orderTimeline(byId('h10'));
    expect(steps.map((s) => s.label))
      .toEqual(['Placed', 'Edited', 'Started', 'Edited', 'Ready', 'Collected']);
    expect(steps.map((s) => s.time))
      .toEqual(['16:31', '16:33', '16:34', '16:36', '16:37', '16:39']);
    expect(steps.map((s) => s.key))
      .toEqual(['placed', 'edited-1', 'started', 'edited-2', 'ready', 'collected']);

    const cancelled = logic.orderTimeline(byId('h08'));
    expect(cancelled.map((s) => s.label)).toEqual(['Placed', 'Cancelled']);
    expect(cancelled[1].note, 'the cancel step carries its reason').toBe('Not collected');

    const plain = logic.orderTimeline(byId('h11'));
    expect(plain.map((s) => s.label), 'a pre-Phase-V order keeps the Phase IV timeline')
      .toEqual(['Placed', 'Started', 'Ready', 'Collected']);

    const open = logic.orderTimeline(byId('h09'));
    expect(open.filter((s) => s.reached).map((s) => s.label)).toEqual(['Placed']);
    expect(open.filter((s) => !s.reached).every((s) => s.time === '—')).toBe(true);
  });
});

/* ================================================================ P6-U-06 */

describe('P6-U-06 historyHash / parseHistoryHash (CLAUDE.md Phase VI 2)', () => {
  const full = {
    from: D.t6, to: D.t, status: 'open', pay: 'card', till: 'B',
    item: 'momo', edited: true, q: 'a-001', order: 'h10'
  };

  it('writes every parameter the brief names', () => {
    const hash = historyHash(full);
    expect(hash.startsWith('#/reports/history?')).toBe(true);
    for (const [key, value] of Object.entries({
      from: D.t6, to: D.t, status: 'open', pay: 'card', till: 'B', item: 'momo', edited: '1', q: 'a-001', order: 'h10'
    })) {
      expect(hash, `the hash carries ${key}`).toContain(`${key}=${encodeURIComponent(value)}`);
    }
  });

  it('round trips every parameter', () => {
    const back = parseHistoryHash(historyHash(full));
    expect(back).toMatchObject(full);
    expect(historyHash(back), 'a canonical hash is stable').toBe(historyHash(full));
  });

  it('round trips a search that needs encoding', () => {
    for (const q of ['two words', 'a&b', 'c#d', 'Śiva', '50% off']) {
      const back = parseHistoryHash(historyHash({ ...full, q }));
      expect(back.q).toBe(q);
    }
  });

  it('leaves defaults out of the hash but keeps the range', () => {
    const hash = historyHash({ from: D.t6, to: D.t });
    expect(hash).toBe(`#/reports/history?from=${D.t6}&to=${D.t}`);
    expect(hash).not.toMatch(/status|pay|till|item|edited|q=|order/);
  });

  it('falls back to the defaults for anything unusable', () => {
    const bare = parseHistoryHash('#/reports/history');
    expect(bare).toEqual({
      from: '', to: '', status: 'all', pay: 'all', till: 'all',
      item: 'all', edited: false, q: '', order: null
    });
    expect(parseHistoryHash('#/reports/history?status=nonsense').status).toBe('all');
    expect(parseHistoryHash('#/reports/history?pay=bitcoin').pay).toBe('all');
    expect(parseHistoryHash('#/reports/history?from=yesterday&to=2026-13-45').from).toBe('');
    expect(parseHistoryHash('#/reports/history?from=2026-10-14&zzz=1&from2=x').from).toBe(D.t6);
    for (const bad of [null, undefined, '', '#', '??', 123]) {
      expect(() => parseHistoryHash(bad)).not.toThrow();
    }
  });

  it('reads a bare query string and a URLSearchParams too', () => {
    expect(parseHistoryHash(`from=${D.t6}&to=${D.t}&till=B`).till).toBe('B');
    expect(parseHistoryHash(new URLSearchParams({ order: 'h10' })).order).toBe('h10');
  });
});

/* ================================================================ P6-U-07 */

describe('P6-U-07 the history CSV (CLAUDE.md Phase VI 8)', () => {
  const HEADER = 'day,orderNo,till,name,item,qty,price,lineTotal,payment,status,'
    + 'createdAt,readyAt,waitSeconds,edited,cancelReason';
  const rowsOf = (orders) => parseCsv(historyToCsv(orders));
  const col = (name) => HEADER.split(',').indexOf(name);

  it('names the file after the range', () => {
    expect(historyCsvFilename(D.t6, D.t)).toBe(`nba-food-stall_history_${D.t6}_${D.t}.csv`);
  });

  it('uses the Orders columns, including edited and cancelReason', () => {
    expect(rowsOf(DEFAULT_ORDERS)[0].join(',')).toBe(HEADER);
  });

  it('writes one row per order line of every matched order, newest first', () => {
    const flat = logic.flattenHistory(groupByDay(filterHistory(DEFAULT_ORDERS, {})));
    const rows = rowsOf(flat).slice(1);
    const expectedLines = flat.reduce((n, o) => n + o.items.length, 0);
    expect(expectedLines, 'the hand-counted line count of the default range').toBe(15);
    expect(rows).toHaveLength(expectedLines);
    expect(rows.every((r) => r.length === 15)).toBe(true);
    expect(rows.map((r) => r[col('orderNo')]).filter((no, i, all) => all.indexOf(no) === i))
      .toEqual(['A-003', 'A-002', 'A-001', 'B-012', 'A-031', 'A-030', 'A-012', 'C-001', 'B-002']);
    for (const r of rows) {
      expect(Number(r[col('lineTotal')])).toBe(Number(r[col('qty')]) * Number(r[col('price')]));
    }
  });

  it('marks edited orders and carries each cancel reason', () => {
    const rows = rowsOf(DEFAULT_ORDERS).slice(1);
    const edited = (no) => rows.filter((r) => r[col('orderNo')] === no).map((r) => r[col('edited')]);
    expect(edited('A-031')).toEqual(['yes']);
    expect(edited('B-002')).toEqual(['yes']);
    expect(edited('A-003')).toEqual(['no']);
    const reason = (no) => rows.find((r) => r[col('orderNo')] === no)[col('cancelReason')];
    expect(reason('A-002')).toBe('mistake');
    expect(reason('C-001')).toBe('not_collected');
    expect(reason('A-003'), 'blank unless the order is cancelled').toBe('');
  });

  it('exports cancelled orders, with "cancelled" in the status column', () => {
    const only = rowsOf(filterHistory(DEFAULT_ORDERS, { status: 'cancelled' })).slice(1);
    expect(only, 'a Cancelled-only view exports its rows, not an empty file').toHaveLength(2);
    expect(only.every((r) => r[col('status')] === 'cancelled')).toBe(true);
  });

  it('writes an unknown item under the name stored on the line, and never the tendered value', () => {
    const wide = rowsOf(inRange(D.t29, D.t));
    const text = wide.map((r) => r.join(',')).join('\n');
    expect(text).toContain('Chocolate Fountain');
    expect(text, 'CLAUDE.md Phase III 10: the Phase I field is ignored everywhere').not.toContain('2000');
    expect(wide[0]).not.toContain('tendered');
  });

  it('quotes a name containing a comma, and survives rubbish', () => {
    const odd = [{ ...byId('h01'), name: 'Smith, Priya' }];
    const raw = historyToCsv(odd);
    expect(raw).toContain('"Smith, Priya"');
    expect(parseCsv(raw)[1][col('name')]).toBe('Smith, Priya');
    expect(parseCsv(historyToCsv([]))).toHaveLength(1);
    expect(() => historyToCsv(null)).not.toThrow();
  });
});

/* ========================================================= P6-U-08..P6-U-10 */

describe('P6-U-08 the history helpers are pure', () => {
  it('leaves every order byte-identical', () => {
    const before = JSON.stringify(HISTORY_ORDERS);
    const rows = filterHistory(HISTORY_ORDERS, { status: 'collected' });
    const groups = groupByDay(rows);
    historySummary(rows);
    logic.flattenHistory(groups);
    orderChanges(byId('h10'));
    historyCancelLine(byId('h08'));
    historyToCsv(rows);
    historyHash({ from: D.t6, to: D.t, order: 'h10' });
    expect(JSON.stringify(HISTORY_ORDERS)).toBe(before);
  });

  it('logic.js still imports nothing from Firebase', async () => {
    const src = await readFile(resolve(ROOT, 'public/js/logic.js'), 'utf8');
    expect(src).not.toMatch(/from\s+['"].*firebase/i);
  });
});

describe('P6-U-09 the version in package.json', () => {
  it('is on 1.5.0, the Phase VI release', async () => {
    const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
    expect(
      pkg.version,
      'CLAUDE.md -> Phase VI 10: "package.json version 1.5.0", and the version table lists '
      + '1.5.0 as Phase VI ("Order history in Reports"). package.json is the single source of '
      + 'truth for every version label, so this is the one place the number is pinned.'
    ).toBe('1.5.0');
  });
});

describe('P6-U-10 the large-range note (CLAUDE.md Phase VI 9)', () => {
  it('fires above 5,000 orders in range and not below', () => {
    expect(logic.HISTORY_LARGE_COUNT).toBe(5000);
    expect(isLargeHistory(0)).toBe(false);
    expect(isLargeHistory(4999)).toBe(false);
    expect(isLargeHistory(5000), 'the brief says "passes 5,000"').toBe(false);
    expect(isLargeHistory(5001)).toBe(true);
    expect(isLargeHistory(50000)).toBe(true);
  });

  it('never throws on rubbish, and the message is the brief\'s', () => {
    for (const bad of [null, undefined, NaN, 'lots', {}]) expect(isLargeHistory(bad)).toBe(false);
    expect(logic.HISTORY_LARGE_MESSAGE).toBe('Large range: narrow it to load faster');
  });

  it('pins the other screen strings the brief fixes', () => {
    expect(logic.HISTORY_PAGE_SIZE, 'CLAUDE.md Phase VI 6: the first 100 orders').toBe(100);
    expect(logic.HISTORY_EMPTY_MESSAGE).toBe('No orders match these filters.');
    expect(logic.HISTORY_LOADING_MESSAGE).toBe('Loading orders…');
    expect(logic.HISTORY_ERROR_MESSAGE.replace(/[’']/g, "'"))
      .toBe("Couldn't load orders. Check the connection and tap Refresh.");
    expect(logic.HISTORY_STATUS_FILTERS.map((s) => s.key)).toEqual(['all', 'collected', 'cancelled', 'open']);
    expect(logic.HISTORY_STATUS_FILTERS.map((s) => s.label))
      .toEqual(['All', 'Collected', 'Cancelled', 'Not finished']);
    expect(logic.HISTORY_PAY_FILTERS.map((p) => p.label)).toEqual(['All', 'Cash', 'Card']);
  });
});
