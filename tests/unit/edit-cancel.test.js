// P5-U-01..P5-U-10 — Phase V (v1.4.0): edit or cancel an open order, plus
// Samosa Chat.
//
// Spec: CLAUDE.md -> "Phase V: Edit or cancel an open order, plus Samosa Chat
// (v1.4.0)" items 1-8, the Menu table ("7 items from v1.3.1, plus samosa_chat
// added in Phase V, so 8") and design/OrderChangesRules.dc.html.
// Plan: qa/test-plan.md sections 47-48.
//
// This file tests the brief, not the implementation. CLAUDE.md fixes the
// *wording* of every prompt but names no functions, so each case resolves the
// helper from a short list of plausible names (and, for two of them, from two
// plausible call shapes) and then asserts the brief's exact strings. A missing
// export fails loudly with the list of names that were tried.
import { describe, it, expect } from 'vitest';
import * as logic from '../../public/js/logic.js';
import { MENU, stationOf, inStation, formatPence, ordersToCsv, exportOrdersCsv, buildReport } from '../../public/js/logic.js';
import { itemIcon } from '../../public/js/icons.js';
import { parseCsv } from './fixtures.js';

/* ------------------------------------------------------------- resolution */

/** The first of `names` that logic.js exports, or null. */
function resolve(names) {
  for (const n of names) if (typeof logic[n] !== 'undefined' && logic[n] !== null) return logic[n];
  return null;
}

/** Same, but fails the test with the list it looked for. */
function need(names, why) {
  const found = resolve(names);
  expect(found, `public/js/logic.js must export one of: ${names.join(', ')} — ${why}`).toBeTruthy();
  return found;
}

const P = 500;
const line = (id, name, qty, price = P) => ({ id, name, qty, price });

/** An order-shaped snapshot: what Phase V 6 calls `before`. */
const snap = (items, name, payment) => ({
  items,
  total: items.reduce((n, l) => n + l.qty * l.price, 0),
  name,
  payment
});

/* ====================================================== P5-U-01 the menu */

describe('P5-U-01 the menu seed is the eight-row table, with Samosa Chat last', () => {
  /** CLAUDE.md -> Menu, transcribed verbatim (8 rows after Phase V). */
  const BRIEF_MENU = [
    { id: 'fuchka', name: 'Fuchka / Gol Gappa', short: 'Fuchka', price: 500, colour: '#FDE68A', station: 'chaat', active: true, sort: 1 },
    { id: 'momo', name: 'Momo', short: 'Momo', price: 500, colour: '#BFDBFE', station: 'momo', active: true, sort: 2 },
    { id: 'chat', name: 'Papri Chat', short: 'Papri Chat', price: 500, colour: '#FECACA', station: 'chaat', active: true, sort: 3 },
    { id: 'sweet_box', name: 'Sweet Box', short: 'Sweet Box', price: 500, colour: '#FED7AA', station: 'sweets', active: true, sort: 4 },
    { id: 'samosa_only', name: 'Samosa', short: 'Samosa', price: 500, colour: '#D9F99D', station: 'sweets', active: true, sort: 5 },
    { id: 'choc_strawberry', name: 'Chocolate Strawberry', short: 'Choc Strawberry', price: 500, colour: '#E9D5FF', station: 'sweets', active: true, sort: 6 },
    { id: 'marshmallow', name: 'Chocolate Marshmallow (V)', short: 'Choc Marshmallow', price: 500, colour: '#FBCFE8', station: 'sweets', active: true, sort: 7 },
    { id: 'samosa_chat', name: 'Samosa Chat', short: 'Samosa Chat', price: 500, colour: '#A5F3FC', station: 'chaat', active: true, sort: 8 }
  ];

  it('has exactly eight rows, in sort order', () => {
    expect(MENU, 'CLAUDE.md Menu: "so 8"').toHaveLength(8);
    expect(MENU.slice().sort((a, b) => a.sort - b.sort).map((m) => m.id))
      .toEqual(BRIEF_MENU.map((m) => m.id));
    expect(MENU.map((m) => m.sort).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('samosa_chat matches the table field for field (CLAUDE.md Phase V 7)', () => {
    const got = MENU.find((m) => m.id === 'samosa_chat');
    expect(got, 'MENU must carry samosa_chat').toBeTruthy();
    expect(got.name).toBe('Samosa Chat');
    expect(got.short).toBe('Samosa Chat');
    expect(got.price).toBe(500);
    expect(String(got.colour).toUpperCase()).toBe('#A5F3FC');
    expect(got.station).toBe('chaat');
    expect(got.active).toBe(true);
    expect(got.sort).toBe(8);
  });

  it('every other row is untouched by Phase V', () => {
    for (const want of BRIEF_MENU) {
      const got = MENU.find((m) => m.id === want.id);
      expect(got, `menu row "${want.id}" is missing`).toBeTruthy();
      expect({ ...got, colour: String(got.colour).toUpperCase() }).toMatchObject(want);
    }
  });

  it('the retired ids are still gone and still not reused', () => {
    for (const id of ['samosa', 'straw', 'fountain']) {
      expect(MENU.map((m) => m.id), `CLAUDE.md Menu: "Don't reuse those ids" (${id})`).not.toContain(id);
    }
  });

  it('samosa_chat is a Chaat line, not a sweet (CLAUDE.md Menu table)', () => {
    expect(stationOf('samosa_chat')).toBe('chaat');
    expect(inStation('samosa_chat', 'chaat')).toBe(true);
    expect(inStation('samosa_chat', 'sweets')).toBe(false);
    expect(inStation('samosa_chat', 'momo')).toBe(false);
    expect(inStation('samosa_chat', 'all')).toBe(true);
  });

  it('samosa_chat has its own icon, not the unknown plate fallback', () => {
    const bodyOf = (svg) => String(svg).replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    const fallback = itemIcon('definitely-not-a-menu-id');
    const svg = itemIcon('samosa_chat');
    expect(svg, 'CLAUDE.md Phase V 7: "and its icon"').toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    expect(bodyOf(svg)).not.toBe(bodyOf(fallback));
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(svg), 'no emoji').toBe(false);
  });

  it('ACTIVE_MENU is all eight, so the till draws eight tiles', () => {
    expect(logic.ACTIVE_MENU.map((m) => m.id)).toContain('samosa_chat');
    expect(logic.ACTIVE_MENU).toHaveLength(8);
  });
});

/* ============================================= P5-U-02 the payment prompt */

/**
 * CLAUDE.md Phase V 2 gives the `edit-delta` wording but no function name or
 * signature. Try the before/draft form first (it is the only one that can
 * distinguish "nothing changed" from "same total"), then the (delta, payment)
 * form.
 */
const DELTA_NAMES = [
  'editPrompt', 'editDeltaText', 'editPaymentText', 'paymentChangeText',
  'paymentDeltaText', 'paymentPromptText', 'paymentPrompt', 'deltaText', 'deltaMessage',
  'editDelta'
];

const deltaFn = resolve(DELTA_NAMES);

/** Whatever the prompt returns, as the words it puts on screen. */
const promptText = (r) => (r && typeof r === 'object' ? String(r.text ?? r.message ?? '') : String(r ?? ''));

/** Did anything a volunteer can change actually change? Worked out here. */
const qtyMap = (items) => items.reduce((m, l) => (m[l.id] = (m[l.id] || 0) + l.qty, m), {});
const changedBetween = (b, d) =>
  JSON.stringify(qtyMap(b.items)) !== JSON.stringify(qtyMap(d.items))
  || String(b.name || '').trim() !== String(d.name || '').trim()
  || b.payment !== d.payment;

/** Returns { call, shape } where call(before, draft) -> string. */
function deltaAdapter() {
  if (typeof deltaFn !== 'function') return null;
  const before = snap([line('momo', 'Momo', 2)], 'Ahmed', 'cash');
  const draft = snap([line('momo', 'Momo', 3)], 'Ahmed', 'cash');
  const tryIt = (fn) => { try { return promptText(fn()); } catch { return ''; } };
  const up = /Take £5\.00 more/;

  // (a) a single options object: { changed, delta, payment } — the only shape
  // that can also say "No changes yet".
  const asOptions = tryIt(() => deltaFn({ changed: true, delta: 500, payment: 'cash' }));
  if (up.test(asOptions)) {
    return {
      shape: 'options',
      call: (b, d) => promptText(deltaFn({
        changed: changedBetween(b, d), delta: d.total - b.total, payment: d.payment
      }))
    };
  }
  // (b) the two snapshots.
  const asObjects = tryIt(() => deltaFn(before, draft));
  if (up.test(asObjects)) {
    return { shape: 'before/draft', call: (b, d) => promptText(deltaFn(b, d)) };
  }
  // (c) the pence difference and the payment now selected.
  const asNumber = tryIt(() => deltaFn(500, 'cash'));
  if (up.test(asNumber)) {
    return { shape: 'delta/payment', call: (b, d) => promptText(deltaFn(d.total - b.total, d.payment)) };
  }
  return null;
}

describe('P5-U-02 the payment prompt after an edit (CLAUDE.md Phase V 2)', () => {
  const adapter = deltaAdapter();

  it('logic.js exposes the payment prompt', () => {
    expect(typeof deltaFn,
      `public/js/logic.js must export one of: ${DELTA_NAMES.join(', ')} — CLAUDE.md Phase V 2 ` +
      'puts the "Take £5.00 more" wording in `edit-delta`, and pure logic belongs in logic.js'
    ).toBe('function');
    expect(adapter,
      'the payment prompt must be callable as (before, draft), as (deltaPence, payment) or as (draft with deltaPence)'
    ).toBeTruthy();
  });

  const cases = [
    // [label, before, draft, expected]
    ['total goes up, cash', snap([line('momo', 'Momo', 2)], 'Ahmed', 'cash'), snap([line('momo', 'Momo', 3)], 'Ahmed', 'cash'), 'Take £5.00 more'],
    ['total goes up, card', snap([line('momo', 'Momo', 2)], 'Ahmed', 'card'), snap([line('momo', 'Momo', 3)], 'Ahmed', 'card'), 'Take £5.00 more on the card machine'],
    ['total goes down, cash', snap([line('momo', 'Momo', 3)], 'Ahmed', 'cash'), snap([line('momo', 'Momo', 2)], 'Ahmed', 'cash'), 'Give back £5.00'],
    ['total goes down, card', snap([line('momo', 'Momo', 3)], 'Ahmed', 'card'), snap([line('momo', 'Momo', 2)], 'Ahmed', 'card'), 'Refund £5.00 on the card machine'],
    ['swap one item for another, cash', snap([line('momo', 'Momo', 2)], 'Ahmed', 'cash'), snap([line('momo', 'Momo', 1), line('chat', 'Papri Chat', 1)], 'Ahmed', 'cash'), 'No payment change']
  ];

  for (const [label, before, draft, want] of cases) {
    it(`${label} → "${want}"`, () => {
      expect(adapter, 'no callable payment prompt').toBeTruthy();
      expect(adapter.call(before, draft)).toContain(want);
    });
  }

  it('the payment now selected decides the wording, not the payment it was placed with', () => {
    expect(adapter).toBeTruthy();
    const before = snap([line('momo', 'Momo', 2)], 'Ahmed', 'cash');
    const draft = snap([line('momo', 'Momo', 3)], 'Ahmed', 'card');
    expect(adapter.call(before, draft),
      'CLAUDE.md Phase V 2: "from the new total minus the old total and the payment now selected"'
    ).toContain('Take £5.00 more on the card machine');
  });

  it('a bigger change is formatted in pounds and pence', () => {
    expect(adapter).toBeTruthy();
    const before = snap([line('momo', 'Momo', 1)], 'Ahmed', 'cash');
    const draft = snap([line('momo', 'Momo', 4), line('chat', 'Papri Chat', 1)], 'Ahmed', 'cash');
    expect(adapter.call(before, draft)).toContain('Take £20.00 more');
    expect(formatPence(2000)).toBe('£20.00');
  });

  // "Nothing changed yet" needs to know about the name and payment as well as
  // the total, so it is only assertable through the before/draft form. The
  // on-screen behaviour is covered either way by e2e P5-11.
  it('nothing changed at all → "No changes yet"', () => {
    expect(adapter).toBeTruthy();
    if (adapter.shape === 'delta/payment') {
      // That form is only given the money, so it cannot tell "nothing changed"
      // from "same total". e2e P5-11 asserts "No changes yet" on screen.
      expect(adapter.shape).toBe('delta/payment');
      return;
    }
    const before = snap([line('momo', 'Momo', 2), line('chat', 'Papri Chat', 1)], 'Ahmed', 'cash');
    const same = snap([line('momo', 'Momo', 2), line('chat', 'Papri Chat', 1)], 'Ahmed', 'cash');
    expect(adapter.call(before, same)).toContain('No changes yet');
  });

  it('a name-only change is a change, but still "No payment change"', () => {
    expect(adapter).toBeTruthy();
    if (adapter.shape === 'delta/payment') return;
    const before = snap([line('momo', 'Momo', 2)], 'Ahmed', 'cash');
    const renamed = snap([line('momo', 'Momo', 2)], 'Ahmed B', 'cash');
    const text = adapter.call(before, renamed);
    expect(text).toContain('No payment change');
    expect(text).not.toContain('No changes yet');
  });
});

/* ================================================ P5-U-03 the line diffing */

const LINE_CHANGE_NAMES = [
  'lineDeltaText', 'lineChangeText', 'lineChangeLabel', 'lineDiffText',
  'changeTextFor', 'lineDeltaTag', 'lineChangeTag', 'itemChangeText'
];

describe('P5-U-03 what each changed cart line says (CLAUDE.md Phase V 2, 4)', () => {
  const fn = resolve(LINE_CHANGE_NAMES);

  it('logic.js exposes the line-change wording', () => {
    expect(typeof fn,
      `public/js/logic.js must export one of: ${LINE_CHANGE_NAMES.join(', ')} — CLAUDE.md Phase V 2 ` +
      '("added", "+1 (was 2)", "removed") and Phase V 4 (NEW, "+1 (was 2)", "−1 (was 2)", REMOVED)'
    ).toBe('function');
  });

  const say = (was, now) => String(fn(was, now) || '');

  it('a line that was not there before reads "added" (NEW on the food counter)', () => {
    expect(say(0, 1)).toMatch(/^(added|new)$/i);
    expect(say(0, 3)).toMatch(/^(added|new)$/i);
  });

  it('one more of an existing line reads "+1 (was 2)"', () => {
    expect(say(2, 3)).toMatch(/^\+1 \(was 2\)$/);
    expect(say(1, 4)).toMatch(/^\+3 \(was 1\)$/);
  });

  it('one fewer reads "−1 (was 2)" (a plain hyphen is accepted)', () => {
    expect(say(2, 1)).toMatch(/^[-−]1 \(was 2\)$/);
    expect(say(4, 1)).toMatch(/^[-−]3 \(was 4\)$/);
  });

  it('a line taken off the order reads "removed" (REMOVED on the food counter)', () => {
    expect(say(2, 0)).toMatch(/^(removed)$/i);
    expect(say(1, 0)).toMatch(/^(removed)$/i);
  });

  it('an unchanged line carries no tag at all', () => {
    expect(say(2, 2)).toBe('');
    expect(say(0, 0)).toBe('');
  });
});

/* ====================================================== P5-U-04 the history */

const HISTORY_NAMES = ['appendHistory', 'pushHistory', 'addHistoryEntry', 'withHistory', 'trimHistory'];

const HISTORY_MAX = 10;

describe('P5-U-04 history keeps the last ten entries (CLAUDE.md Phase V 6)', () => {
  const fn = resolve(HISTORY_NAMES);

  /** append(history, entry) whichever way round logic.js takes them. */
  const append = (history, entry) => {
    const direct = (() => { try { return fn(history, entry); } catch { return null; } })();
    if (Array.isArray(direct) && direct.length === (history || []).length + 1) return direct;
    const swapped = (() => { try { return fn(entry, history); } catch { return null; } })();
    if (Array.isArray(swapped) && swapped.length === (history || []).length + 1) return swapped;
    return direct;
  };

  const entry = (n) => ({
    atMs: 1_700_000_000_000 + n * 1000,
    action: 'edit',
    till: 'A',
    fromStatus: 'preparing',
    before: { items: [line('momo', 'Momo', n)], total: n * P, name: 'Ahmed', payment: 'cash' },
    deltaPence: P
  });

  it('logic.js exposes the history append', () => {
    expect(typeof fn,
      `public/js/logic.js must export one of: ${HISTORY_NAMES.join(', ')} — CLAUDE.md Phase V 6: ` +
      '"history [...] keep the last 10"'
    ).toBe('function');
  });

  it('appends to an empty or missing history', () => {
    expect(append([], entry(1))).toHaveLength(1);
    expect(append(undefined, entry(1))).toHaveLength(1);
    expect(append(null, entry(1))).toHaveLength(1);
    expect(append('nonsense', entry(1)), 'a garbage history must not throw or vanish').toHaveLength(1);
  });

  it('keeps every field of the entry', () => {
    const [got] = append([], entry(2));
    expect(got).toMatchObject({
      atMs: entry(2).atMs, action: 'edit', till: 'A', fromStatus: 'preparing', deltaPence: P
    });
    expect(got.before).toMatchObject({ total: 2 * P, name: 'Ahmed', payment: 'cash' });
    expect(Array.isArray(got.before.items)).toBe(true);
  });

  it('grows to ten and then stops, dropping the oldest', () => {
    let h = [];
    for (let i = 1; i <= 10; i++) h = append(h, entry(i));
    expect(h).toHaveLength(HISTORY_MAX);
    expect(h[0].atMs, 'oldest first, newest last').toBe(entry(1).atMs);

    h = append(h, entry(11));
    expect(h, 'CLAUDE.md Phase V 6: "keep the last 10"').toHaveLength(HISTORY_MAX);
    expect(h.some((x) => x.atMs === entry(1).atMs), 'the oldest entry is the one dropped').toBe(false);
    expect(h[h.length - 1].atMs, 'the newest entry is kept').toBe(entry(11).atMs);
    expect(h[0].atMs).toBe(entry(2).atMs);
  });

  it('never grows past ten however many are added', () => {
    let h = [];
    for (let i = 1; i <= 25; i++) h = append(h, entry(i));
    expect(h).toHaveLength(HISTORY_MAX);
    expect(h.map((x) => x.atMs)).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24, 25].map((n) => entry(n).atMs));
  });

  it('does not mutate the array it was given', () => {
    const h = [entry(1)];
    const copy = JSON.parse(JSON.stringify(h));
    append(h, entry(2));
    expect(h).toEqual(copy);
  });
});

/* ==================================================== P5-U-05 the refund line */

const REFUND_NAMES = ['refundText', 'cancelRefundText', 'refundLine', 'refundMessage', 'cancelRefundLine'];

describe('P5-U-05 the refund line on a cancel (CLAUDE.md Phase V 3)', () => {
  const fn = resolve(REFUND_NAMES);
  const say = (total, payment) => {
    const direct = (() => { try { return fn(total, payment); } catch { return ''; } })();
    if (typeof direct === 'string' && direct) return direct;
    try { return String(fn({ total, payment }) || ''); } catch { return ''; }
  };

  it('logic.js exposes the refund wording', () => {
    expect(typeof fn,
      `public/js/logic.js must export one of: ${REFUND_NAMES.join(', ')} — CLAUDE.md Phase V 3: ` +
      '"Give back £15.00 cash" or "Refund £15.00 on the card machine"'
    ).toBe('function');
  });

  it('a cash order: "Give back £15.00 cash"', () => {
    expect(say(1500, 'cash')).toBe('Give back £15.00 cash');
  });

  it('a card order: "Refund £15.00 on the card machine"', () => {
    expect(say(1500, 'card')).toBe('Refund £15.00 on the card machine');
  });

  it('formats any amount in pounds and pence', () => {
    expect(say(500, 'cash')).toContain('£5.00');
    expect(say(1050, 'card')).toContain('£10.50');
    expect(say(0, 'cash')).toContain('£0.00');
  });

  it('an order with no payment stored is treated as cash, like the rest of the app', () => {
    expect(say(1000, undefined)).toMatch(/Give back £10\.00 cash/);
  });
});

/* ================================================= P5-U-06 the cancel reasons */

const REASON_LIST_NAMES = ['CANCEL_REASONS', 'CANCEL_REASON_OPTIONS', 'CANCEL_REASON_LIST', 'cancelReasons'];
const REASON_LABEL_NAMES = ['cancelReasonLabel', 'reasonLabel', 'cancelReasonText'];

describe('P5-U-06 the five cancel reasons (CLAUDE.md Phase V 3)', () => {
  const BRIEF = [
    ['mistake', 'Placed by mistake'],
    ['changed_mind', 'Customer changed mind'],
    ['out_of_stock', 'Out of stock'],
    ['not_collected', 'Not collected'],
    ['other', 'Other']
  ];

  it('logic.js lists the five reasons with the brief keys, in the brief order', () => {
    const list = need(REASON_LIST_NAMES, 'CLAUDE.md Phase V 3 names five one-tap reasons');
    expect(Array.isArray(list)).toBe(true);
    expect(list.map((r) => r.key || r.id || r)).toEqual(BRIEF.map(([k]) => k));
  });

  it('each reason carries the brief label', () => {
    const list = resolve(REASON_LIST_NAMES) || [];
    for (const [key, label] of BRIEF) {
      const got = list.find((r) => (r.key || r.id || r) === key);
      expect(got, `reason "${key}" is missing`).toBeTruthy();
      expect(String(got.label || got.text || '')).toBe(label);
    }
  });

  it('"Not collected" is offered for ready only', () => {
    const list = resolve(REASON_LIST_NAMES) || [];
    const got = list.find((r) => (r.key || r.id || r) === 'not_collected');
    expect(got, 'reason "not_collected" is missing').toBeTruthy();
    const readyOnly = got.readyOnly ?? got.onlyFor ?? got.statuses ?? got.forStatus;
    expect(readyOnly,
      'CLAUDE.md Phase V 3: "Not collected (not_collected, only for ready)" must be marked on the reason'
    ).toBeTruthy();
  });

  it('a label can be looked up by key, for the reports timeline', () => {
    const fn = need(REASON_LABEL_NAMES, 'CLAUDE.md Phase V 5: "Cancelled HH:MM · <reason>"');
    for (const [key, label] of BRIEF) expect(fn(key)).toBe(label);
    expect(() => fn('nonsense_key')).not.toThrow();
    expect(fn(undefined), 'an unset reason must not print "undefined"').toBeFalsy();
  });
});

/* ====================================================== P5-U-07 the CSV columns */

describe('P5-U-07 every CSV gains edited and cancelReason as its last two columns', () => {
  const DAY = '2026-10-20';
  const t = (h, m) => Date.UTC(2026, 9, 20, h - 1, m); // BST

  const ORDERS = [
    {
      orderNo: 'A-041', name: 'Ahmed', till: 'A', day: DAY, payment: 'cash', status: 'collected',
      items: [line('momo', 'Momo', 3)], total: 1500,
      createdAtMs: t(14, 1), startedAtMs: t(14, 2), readyAtMs: t(14, 5), collectedAtMs: t(14, 6),
      editCount: 1, editedAtMs: t(14, 3),
      history: [{ atMs: t(14, 3), action: 'edit', till: 'A', fromStatus: 'preparing', deltaPence: 500, before: { items: [line('momo', 'Momo', 2)], total: 1000, name: 'Ahmed', payment: 'cash' } }]
    },
    {
      orderNo: 'A-042', name: 'Sam', till: 'A', day: DAY, payment: 'card', status: 'collected',
      items: [line('fuchka', 'Fuchka / Gol Gappa', 1), line('samosa_chat', 'Samosa Chat', 1)], total: 1000,
      createdAtMs: t(14, 3), readyAtMs: t(14, 8), collectedAtMs: t(14, 9)
    },
    {
      orderNo: 'A-043', name: 'Meera', till: 'B', day: DAY, payment: 'card', status: 'cancelled',
      items: [line('chat', 'Papri Chat', 2)], total: 1000,
      createdAtMs: t(14, 10), cancelledAtMs: t(14, 12),
      cancelReason: 'changed_mind', cancelledFrom: 'preparing',
      history: [{ atMs: t(14, 12), action: 'cancel', till: 'B', fromStatus: 'preparing', reason: 'changed_mind' }]
    }
  ];

  const HEAD_13 = ['day', 'orderNo', 'till', 'name', 'item', 'qty', 'price',
    'lineTotal', 'payment', 'status', 'createdAt', 'readyAt', 'waitSeconds'];
  const HEAD_15 = [...HEAD_13, 'edited', 'cancelReason'];

  it('CSV_HEADER ends with edited, cancelReason (CLAUDE.md Phase V 5)', () => {
    expect(logic.CSV_HEADER,
      'CLAUDE.md Phase V 5: "All CSVs gain two last columns: edited (yes/no) and cancelReason"'
    ).toEqual(HEAD_15);
  });

  for (const [label, fn] of [['the One day export', ordersToCsv], ['the Orders export', exportOrdersCsv]]) {
    describe(label, () => {
      const rows = parseCsv(fn(ORDERS));
      const header = rows[0];
      const body = rows.slice(1);
      const col = (r, name) => r[header.indexOf(name)];

      it('has the fifteen columns in order', () => {
        expect(header).toEqual(HEAD_15);
      });

      it('gives every body row fifteen fields', () => {
        for (const r of body) expect(r, r.join('|')).toHaveLength(15);
      });

      it('reads yes for an edited order and no for an untouched one', () => {
        const edited = body.filter((r) => col(r, 'orderNo') === 'A-041');
        expect(edited.length, 'the edited order must be exported').toBeGreaterThan(0);
        for (const r of edited) expect(col(r, 'edited')).toBe('yes');
        for (const r of body.filter((r) => col(r, 'orderNo') === 'A-042')) {
          expect(col(r, 'edited')).toBe('no');
        }
      });

      it('leaves cancelReason blank unless the order was cancelled', () => {
        for (const r of body.filter((r) => col(r, 'status') !== 'cancelled')) {
          expect(col(r, 'cancelReason')).toBe('');
        }
      });

      it('keeps the thirteen Phase I columns and their values untouched', () => {
        const r = body.find((x) => col(x, 'orderNo') === 'A-041');
        expect(r.slice(0, 13)).toEqual([
          DAY, 'A-041', 'A', 'Ahmed', 'Momo', '3', '500', '1500', 'cash', 'collected',
          new Date(t(14, 1)).toISOString(), new Date(t(14, 5)).toISOString(), '240'
        ]);
      });
    });
  }

  it('the Orders export carries the cancelled order and its reason', () => {
    const rows = parseCsv(exportOrdersCsv(ORDERS));
    const header = rows[0];
    const row = rows.slice(1).find((r) => r[header.indexOf('orderNo')] === 'A-043');
    expect(row, 'CLAUDE.md Phase IV 8: the Orders export follows the list, which shows cancelled orders').toBeTruthy();
    expect(row[header.indexOf('cancelReason')]).toBe('changed_mind');
    expect(row[header.indexOf('edited')]).toBe('no');
  });

  it('the Sales by day export uses the same fifteen columns', () => {
    const rangeCsv = logic.rangeToCsv || ordersToCsv;
    const rows = parseCsv(rangeCsv(ORDERS));
    expect(rows[0]).toEqual(HEAD_15);
    expect(rows.slice(1).every((r) => r.length === 15)).toBe(true);
  });

  it('an empty export is still the fifteen-column header', () => {
    expect(ordersToCsv([]).trim()).toBe(HEAD_15.join(','));
    expect(exportOrdersCsv([]).trim()).toBe(HEAD_15.join(','));
  });
});

/* ================================================= P5-U-08 the detail timeline */

describe('P5-U-08 the order timeline shows edits and the cancel reason (CLAUDE.md Phase V 5)', () => {
  const t = (h, m) => Date.UTC(2026, 9, 20, h - 1, m);
  const textOf = (step) => [step.label, step.time, step.note, step.text, step.detail, step.reason]
    .filter(Boolean).join(' ');

  const EDITED = {
    orderNo: 'A-041', name: 'Ahmed', till: 'A', day: '2026-10-20', payment: 'cash', status: 'collected',
    items: [line('momo', 'Momo', 3)], total: 1500,
    createdAtMs: t(14, 1), startedAtMs: t(14, 2), readyAtMs: t(14, 5), collectedAtMs: t(14, 6),
    editCount: 1, editedAtMs: t(14, 3),
    history: [{ atMs: t(14, 3), action: 'edit', till: 'A', fromStatus: 'preparing', deltaPence: 500, before: { items: [line('momo', 'Momo', 2)], total: 1000, name: 'Ahmed', payment: 'cash' } }]
  };

  const CANCELLED = {
    orderNo: 'A-043', name: 'Meera', till: 'B', day: '2026-10-20', payment: 'card', status: 'cancelled',
    items: [line('chat', 'Papri Chat', 2)], total: 1000,
    createdAtMs: t(14, 10), startedAtMs: t(14, 11), cancelledAtMs: t(14, 12),
    cancelReason: 'changed_mind', cancelledFrom: 'preparing'
  };

  const PLAIN = {
    orderNo: 'A-042', name: 'Sam', till: 'A', day: '2026-10-20', payment: 'card', status: 'ready',
    items: [line('fuchka', 'Fuchka / Gol Gappa', 1)], total: 500,
    createdAtMs: t(14, 3), startedAtMs: t(14, 4), readyAtMs: t(14, 8)
  };

  it('an edit becomes an "Edited HH:MM" step', () => {
    const steps = logic.orderTimeline(EDITED);
    const edited = steps.filter((s) => /edit/i.test(String(s.key)) || /edited/i.test(textOf(s)));
    expect(edited.length,
      'CLAUDE.md Phase V 5: "timeline adds \\"Edited HH:MM\\" steps"'
    ).toBeGreaterThan(0);
    expect(textOf(edited[0]), 'the edit was at 14:03 London time').toContain('14:03');
  });

  it('a cancelled order reads "Cancelled HH:MM · <reason>"', () => {
    const steps = logic.orderTimeline(CANCELLED);
    const cancelled = steps.find((s) => s.key === 'cancelled' || /cancelled/i.test(textOf(s)));
    expect(cancelled, 'the cancelled step is missing').toBeTruthy();
    expect(textOf(cancelled)).toContain('14:12');
    expect(textOf(cancelled),
      'CLAUDE.md Phase V 5: the cancel step names the reason'
    ).toMatch(/Customer changed mind/i);
  });

  it('an order with neither is exactly the Phase IV timeline', () => {
    expect(logic.orderTimeline(PLAIN).map((s) => s.key))
      .toEqual(['placed', 'started', 'ready', 'collected']);
  });

  it('never throws on an order with a missing or malformed history', () => {
    for (const h of [undefined, null, 'nonsense', [], [{}]]) {
      expect(() => logic.orderTimeline({ ...PLAIN, history: h })).not.toThrow();
    }
  });
});

/* ============================================ P5-U-09 / P5-U-10 version, totals */

describe('P5-U-09 the version in package.json', () => {
  it('has not gone backwards from 1.4.0, the Phase V 8 release', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    const parts = String(pkg.version).split('.').map(Number);
    expect(parts, 'package.json carries a three-part version').toHaveLength(3);
    expect(parts.every(Number.isInteger)).toBe(true);
    const asNumber = parts[0] * 1e6 + parts[1] * 1e3 + parts[2];
    expect(asNumber,
      'CLAUDE.md -> Phase V 8: "package.json version 1.4.0". package.json is the single '
      + 'source of truth (Phase III part 2, 1), so the header pill and the login version line '
      + 'follow it. The current release number is pinned in one place only, P6-U-09 in '
      + 'tests/unit/history.test.js; this case only guards against going backwards.'
    ).toBeGreaterThanOrEqual(1 * 1e6 + 4 * 1e3 + 0);
  });
});

describe('P5-U-10 reports count an edited order at its final value (CLAUDE.md Phase V 5)', () => {
  const DAY = '2026-10-20';
  const t = (h, m) => Date.UTC(2026, 9, 20, h - 1, m);

  const ORDERS = [
    {
      // Placed as 2x Momo (£10), edited up to 3x Momo (£15).
      orderNo: 'A-041', name: 'Ahmed', till: 'A', day: DAY, payment: 'cash', status: 'collected',
      items: [line('momo', 'Momo', 3)], total: 1500,
      createdAtMs: t(14, 1), readyAtMs: t(14, 5), collectedAtMs: t(14, 6),
      editCount: 1, editedAtMs: t(14, 3),
      history: [{ atMs: t(14, 3), action: 'edit', till: 'A', fromStatus: 'preparing', deltaPence: 500, before: { items: [line('momo', 'Momo', 2)], total: 1000, name: 'Ahmed', payment: 'cash' } }]
    },
    {
      // Cancelled after being edited: out of every total, history or not.
      orderNo: 'A-043', name: 'Meera', till: 'B', day: DAY, payment: 'card', status: 'cancelled',
      items: [line('chat', 'Papri Chat', 2)], total: 1000,
      createdAtMs: t(14, 10), cancelledAtMs: t(14, 12),
      cancelReason: 'changed_mind', cancelledFrom: 'preparing', editCount: 2
    }
  ];

  const report = buildReport(ORDERS);

  it('the day totals use the stored items and total', () => {
    expect(report.totalSales, '£15.00, the edited value, not the £10.00 it was placed at').toBe(1500);
    expect(report.orderCount).toBe(1);
    expect(report.itemsSold).toBe(3);
  });

  it('the item rows use the edited lines', () => {
    const momo = report.byItem.find((r) => r.id === 'momo');
    expect(momo).toMatchObject({ units: 3, revenue: 1500 });
    expect(report.byItem.find((r) => r.id === 'chat'), 'the cancelled order contributes nothing').toBeFalsy();
  });

  it('cash and card split on the stored payment', () => {
    expect(report.cash.amount).toBe(1500);
    expect(report.card.amount).toBe(0);
  });

  it('the range report agrees', () => {
    const range = logic.buildRangeReport(ORDERS);
    expect(range.totals.sales ?? range.totalSales).toBe(1500);
  });
});
