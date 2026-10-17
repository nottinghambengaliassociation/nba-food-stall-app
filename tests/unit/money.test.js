// U-01, U-02, U-03 — money formatting, order total, change due.
// Spec: CLAUDE.md "Money is integer pence everywhere; format as £ only for display",
// Cash counter FR 2 and FR 3.
import { describe, it, expect } from 'vitest';
import { formatPence, orderTotal, changeDue } from '../../public/js/logic.js';

describe('U-01 formatPence', () => {
  it('renders integer pence as pounds with exactly two decimals', () => {
    expect(formatPence(0)).toBe('£0.00');
    expect(formatPence(5)).toBe('£0.05');
    expect(formatPence(50)).toBe('£0.50');
    expect(formatPence(500)).toBe('£5.00');
    expect(formatPence(1500)).toBe('£15.00');
  });

  it('formats large amounts with two decimals (thousands separator optional)', () => {
    const out = formatPence(123456);
    expect(out.replace(/,/g, '')).toBe('£1234.56');
    expect(out).toMatch(/\.\d{2}$/);
  });

  it('does not produce float artefacts', () => {
    // 0.1 + 0.2 territory: every value must come out clean.
    for (let p = 0; p <= 2000; p += 7) {
      expect(formatPence(p)).toMatch(/^£\d+\.\d{2}$/);
    }
    expect(formatPence(1070)).toBe('£10.70');
    expect(formatPence(2999)).toBe('£29.99');
  });

  it('marks negative amounts and never prints NaN', () => {
    expect(formatPence(-100)).toMatch(/^-?£-?1\.00$/);
    expect(formatPence(undefined)).toBe('£0.00');
    expect(formatPence('nonsense')).toBe('£0.00');
  });
});

describe('U-02 orderTotal', () => {
  const l = (qty, price = 500) => ({ id: 'x', name: 'X', qty, price });

  it('is 0 for an empty order', () => {
    expect(orderTotal([])).toBe(0);
    expect(orderTotal(undefined)).toBe(0);
  });

  it('sums qty x price in pence', () => {
    expect(orderTotal([l(1)])).toBe(500);
    expect(orderTotal([l(2), l(1), l(3)])).toBe(3000);
  });

  it('returns an integer', () => {
    expect(Number.isInteger(orderTotal([l(3), l(7)]))).toBe(true);
  });

  it('handles mixed prices', () => {
    expect(orderTotal([l(2, 500), l(1, 250), l(3, 125)])).toBe(1625);
  });
});

describe('U-03 changeDue', () => {
  it('gives the difference when enough is tendered', () => {
    expect(changeDue(1500, 2000)).toBe(500);
    expect(changeDue(1500, 1500)).toBe(0);
    expect(changeDue(500, 5000)).toBe(4500);
  });

  it('never returns a negative amount for a short tender', () => {
    // CLAUDE.md gives no figure for a short tender; the till must not show
    // a negative "Change to give" (qa/test-plan.md section 15.1).
    expect(changeDue(1500, 1000)).toBeLessThanOrEqual(0);
    expect(Number.isNaN(changeDue(1500, 1000))).toBe(false);
  });

  it('is 0, not NaN, when nothing has been tendered', () => {
    expect(changeDue(1500, null)).toBe(0);
    expect(changeDue(1500, undefined)).toBe(0);
    expect(changeDue(0, null)).toBe(0);
  });
});
