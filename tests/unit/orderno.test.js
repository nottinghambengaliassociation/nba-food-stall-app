// U-04..U-07 — order numbers. Spec: CLAUDE.md Data model
// ("orderNo 'A-043'  till letter + 3-digit daily sequence") and
// ("Order numbers are generated on the device: localStorage['seq:<till>:<day>']").
import { describe, it, expect } from 'vitest';
import { nextOrderNo, peekOrderNo, formatOrderNo } from '../../public/js/logic.js';
import { memoryStorage } from './fixtures.js';

const DAY = '2026-10-17';

describe('U-04 order number format and sequence', () => {
  it('starts at 001 and counts up', () => {
    const s = memoryStorage();
    expect(nextOrderNo('A', DAY, s)).toBe('A-001');
    expect(nextOrderNo('A', DAY, s)).toBe('A-002');
    expect(nextOrderNo('A', DAY, s)).toBe('A-003');
  });

  it('zero-pads to three digits at 10 and 100', () => {
    const s = memoryStorage();
    let last = '';
    for (let i = 0; i < 100; i++) last = nextOrderNo('A', DAY, s);
    expect(last).toBe('A-100');

    const s2 = memoryStorage();
    for (let i = 0; i < 9; i++) nextOrderNo('A', DAY, s2);
    expect(nextOrderNo('A', DAY, s2)).toBe('A-010');
  });

  it('always matches <till>-<3 digits>', () => {
    const s = memoryStorage();
    for (let i = 0; i < 20; i++) expect(nextOrderNo('A', DAY, s)).toMatch(/^A-\d{3}$/);
  });

  it('formatOrderNo pads a raw sequence', () => {
    expect(formatOrderNo('A', 43)).toBe('A-043');
    expect(formatOrderNo('B', 1)).toBe('B-001');
    expect(formatOrderNo('a', 7)).toBe('A-007');
  });
});

describe('U-05 sequence is per till', () => {
  it('keeps A and B independent on the same day', () => {
    const s = memoryStorage();
    expect(nextOrderNo('A', DAY, s)).toBe('A-001');
    expect(nextOrderNo('B', DAY, s)).toBe('B-001');
    expect(nextOrderNo('A', DAY, s)).toBe('A-002');
    expect(nextOrderNo('B', DAY, s)).toBe('B-002');
  });

  it('produces no duplicate numbers across two tills', () => {
    const s = memoryStorage();
    const seen = new Set();
    for (let i = 0; i < 25; i++) {
      seen.add(nextOrderNo('A', DAY, s));
      seen.add(nextOrderNo('B', DAY, s));
    }
    expect(seen.size).toBe(50);
  });
});

describe('U-06 sequence resets on a new day', () => {
  it('restarts at 001 the next day', () => {
    const s = memoryStorage();
    nextOrderNo('A', DAY, s);
    nextOrderNo('A', DAY, s);
    nextOrderNo('A', DAY, s);
    expect(peekOrderNo('A', DAY, s)).toBe('A-004');
    expect(nextOrderNo('A', '2026-10-18', s)).toBe('A-001');
  });

  it('does not disturb the previous day counter', () => {
    const s = memoryStorage();
    nextOrderNo('A', DAY, s);
    nextOrderNo('A', '2026-10-18', s);
    expect(nextOrderNo('A', DAY, s)).toBe('A-002');
  });
});

describe('U-07 localStorage key shape', () => {
  it('stores the counter under seq:<till>:<day>', () => {
    const s = memoryStorage();
    nextOrderNo('A', DAY, s);
    nextOrderNo('B', DAY, s);
    nextOrderNo('A', '2026-10-18', s);
    expect(s.keys().sort()).toEqual(['seq:A:2026-10-17', 'seq:A:2026-10-18', 'seq:B:2026-10-17']);
  });

  it('stores the last issued sequence number', () => {
    const s = memoryStorage();
    nextOrderNo('A', DAY, s);
    nextOrderNo('A', DAY, s);
    expect(Number(s.getItem(`seq:A:${DAY}`))).toBe(2);
  });

  it('peek does not consume a number', () => {
    const s = memoryStorage();
    expect(peekOrderNo('A', DAY, s)).toBe('A-001');
    expect(peekOrderNo('A', DAY, s)).toBe('A-001');
    expect(nextOrderNo('A', DAY, s)).toBe('A-001');
  });
});
