// U-08..U-11 — the Europe/London day string.
// Spec: CLAUDE.md Data model: day "2026-10-17"  Europe/London date.
import { describe, it, expect } from 'vitest';
import { dayString, londonMinutes, hhmm, slotLabel } from '../../public/js/logic.js';

describe('U-08 / U-09 London day string in BST and GMT', () => {
  it('uses British Summer Time (UTC+1) in July', () => {
    expect(dayString(new Date('2026-07-15T23:30:00Z'))).toBe('2026-07-16');
    expect(dayString(new Date('2026-07-15T12:00:00Z'))).toBe('2026-07-15');
  });

  it('uses GMT (UTC+0) in January', () => {
    expect(dayString(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-15');
    expect(dayString(new Date('2026-01-16T00:01:00Z'))).toBe('2026-01-16');
  });
});

describe('U-10 either side of London midnight', () => {
  it('rolls over at 00:00 London, not 00:00 UTC', () => {
    // During BST London is UTC+1, so 23:00Z is already the next London day.
    expect(dayString(new Date('2026-10-17T22:59:59Z'))).toBe('2026-10-17');
    expect(dayString(new Date('2026-10-17T23:00:00Z'))).toBe('2026-10-18');
  });

  it('rolls over at 00:00Z in winter', () => {
    expect(dayString(new Date('2026-12-17T23:59:59Z'))).toBe('2026-12-17');
    expect(dayString(new Date('2026-12-18T00:00:00Z'))).toBe('2026-12-18');
  });
});

describe('U-11 across the BST change', () => {
  it('holds the date through the autumn clock change (25 Oct 2026)', () => {
    expect(dayString(new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-25'); // 01:30 BST
    expect(dayString(new Date('2026-10-25T01:30:00Z'))).toBe('2026-10-25'); // 01:30 GMT after the change
    expect(dayString(new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-25'); // 23:30 GMT
    expect(dayString(new Date('2026-10-26T00:00:00Z'))).toBe('2026-10-26');
  });

  it('holds the date through the spring clock change (29 Mar 2026)', () => {
    expect(dayString(new Date('2026-03-29T00:30:00Z'))).toBe('2026-03-29'); // 00:30 GMT
    expect(dayString(new Date('2026-03-29T01:30:00Z'))).toBe('2026-03-29'); // 02:30 BST
    expect(dayString(new Date('2026-03-29T22:59:00Z'))).toBe('2026-03-29');
    expect(dayString(new Date('2026-03-29T23:00:00Z'))).toBe('2026-03-30');
  });

  it('returns YYYY-MM-DD for every hour of the clock-change days', () => {
    for (const base of ['2026-03-29', '2026-10-25']) {
      for (let h = 0; h < 24; h++) {
        const d = new Date(`${base}T${String(h).padStart(2, '0')}:00:00Z`);
        expect(dayString(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('accepts a Date and defaults to now without throwing', () => {
    expect(dayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('London wall-clock helpers used by the 30-minute buckets', () => {
  it('londonMinutes reads the London clock, not UTC', () => {
    // 11:05Z on 17 Oct 2026 (BST) is 12:05 in London.
    expect(londonMinutes(Date.UTC(2026, 9, 17, 11, 5))).toBe(12 * 60 + 5);
    // 12:05Z on 17 Jan 2026 (GMT) is 12:05 in London.
    expect(londonMinutes(Date.UTC(2026, 0, 17, 12, 5))).toBe(12 * 60 + 5);
  });

  it('hhmm and slotLabel render half-hour slots', () => {
    expect(hhmm(0)).toBe('00:00');
    expect(hhmm(12 * 60 + 30)).toBe('12:30');
    expect(slotLabel(24)).toMatch(/^12:00.12:30$/);
  });
});
