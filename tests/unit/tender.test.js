// U-26, U-27 — Phase II pure logic for "Cash received (optional)".
// Spec: CLAUDE.md -> Cash counter 3 (the Other amount box "Accepts 17.50, 17.5,
// £17.50, 17, 1,000"; "Change to give" when received >= total) and Technical
// constraints ("Put all pure logic (money, …) in public/js/logic.js … so it is
// unit-testable").
//
// Requirement change 2026-10-18: Cash received is an on-screen calculator only.
// Nothing is persisted, so U-27 covers the *display* rule, not a stored field,
// and it only runs if the app exposes the calculation as a pure function.
import { describe, it, expect } from 'vitest';
import * as logic from '../../public/js/logic.js';

/** Pick the first export that exists, so the test pins behaviour, not a name. */
function pick(names) {
  for (const n of names) if (typeof logic[n] === 'function') return { name: n, fn: logic[n] };
  return null;
}

const PARSER_NAMES = [
  'parseAmountToPence', 'parseMoneyToPence', 'parsePence', 'parseAmountInput',
  'parseMoneyInput', 'parseCashInput', 'parseTenderInput', 'parsePounds',
  'parseAmount', 'parseMoney', 'parseTender', 'parseCashReceived', 'parseCashAmount'
];
const CHANGE_NAMES = ['changeGiven', 'computeChangeGiven', 'changeGivenFor', 'changeFor'];

describe('U-26 the Other amount box parser lives in logic.js', () => {
  const parser = pick(PARSER_NAMES);

  it(`exports a cash-input parser (one of: ${PARSER_NAMES.join(', ')})`, () => {
    expect(
      parser,
      'CLAUDE.md Technical constraints: all pure logic belongs in public/js/logic.js so it is unit-testable. ' +
      'No cash-input parser is exported; the Other amount parsing (CLAUDE.md Cash 3) cannot be unit-tested.'
    ).not.toBeNull();
  });

  const cases = [
    ['17.50', 1750],
    ['17.5', 1750],
    ['£17.50', 1750],
    ['17', 1700],
    ['1,000', 100000],
    [' 17.50 ', 1750],
    ['£1,000.05', 100005],
    ['0.05', 5]
  ];

  for (const [input, pence] of cases) {
    it(`parses ${JSON.stringify(input)} as ${pence}p`, () => {
      if (!parser) return expect(parser).not.toBeNull();
      expect(parser.fn(input)).toBe(pence);
    });
  }

  for (const bad of ['', '   ', 'abc', '--', '1.2.3', '£', '-5', 'ten pounds']) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      if (!parser) return expect(parser).not.toBeNull();
      const got = parser.fn(bad);
      expect(
        got === null || got === undefined || Number.isNaN(got),
        `${JSON.stringify(bad)} should not parse to a usable amount, got ${JSON.stringify(got)} ` +
        '(CLAUDE.md Cash 3: "Enter an amount like 17.50" when it cannot be parsed)'
      ).toBe(true);
    });
  }

  it('returns integer pence, never a float', () => {
    if (!parser) return expect(parser).not.toBeNull();
    for (const [input] of cases) {
      const v = parser.fn(input);
      expect(Number.isInteger(v), `${input} parsed to ${v}; money is integer pence everywhere`).toBe(true);
    }
  });
});

const change = pick(CHANGE_NAMES);

describe.skipIf(!change)('U-27 the on-screen change calculation', () => {
  // "Change to give: £x.xx when received >= total" (CLAUDE.md Cash 3). The
  // display behaviour itself is covered end to end by T-03/T-07; this pins the
  // arithmetic where the app exposes it as a pure function.
  const table = [
    [1500, 2000, 500],
    [1500, 1500, 0],
    [1500, 1000, null],
    [1500, null, null],
    [1500, undefined, null],
    [0, 0, 0],
    [500, 100000, 99500]
  ];

  for (const [total, tendered, want] of table) {
    it(`total ${total}, tendered ${JSON.stringify(tendered)} -> ${JSON.stringify(want)}`, () => {
      if (!change) return expect(change).not.toBeNull();
      expect(change.fn(total, tendered)).toBe(want);
    });
  }
});

describe('U-03b changeDue still never shows negative change', () => {
  it('a short tender never produces a negative display value', () => {
    const v = logic.changeDue(1500, 1000);
    expect(v === 0 || v === null || v === undefined || v < 0 === false).toBe(true);
  });
});
