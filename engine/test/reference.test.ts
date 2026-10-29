import { describe, expect, it } from 'vitest';
import { allocateCredit, creditsEqual, mergeCredits, splitEligibility, type RefTouchpoint } from '../src/attribution/reference.ts';

const day = 24 * 3600 * 1000;
const base = Date.parse('2026-03-01T12:00:00Z');
const tp = (id: string, channel: RefTouchpoint['channel'], campaignId: string, daysBefore: number): RefTouchpoint => ({ id, channel, campaignId, ts: new Date(base - daysBefore * day).toISOString() });
const conversion = { id: 'c1', ts: new Date(base).toISOString(), value: 120 };

describe('reference attribution model', () => {
  const journey = [tp('a', 'email', 'em', 5), tp('b', 'google', 'g', 3), tp('c', 'meta', 'fb', 1)];

  it('splits eligibility by lookback window', () => {
    const { eligible, ineligible } = splitEligibility([...journey, tp('old', 'meta', 'fb_old', 45)], conversion, 30);
    expect(eligible.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(ineligible.map((t) => t.id)).toEqual(['old']);
  });

  it('first-touch credits the earliest eligible touchpoint', () => {
    expect(allocateCredit('first_touch', journey, 120)).toEqual([{ channel: 'email', campaignId: 'em', credit: 120, share: 1 }]);
  });

  it('last-touch credits the latest eligible touchpoint', () => {
    expect(allocateCredit('last_touch', journey, 120)).toEqual([{ channel: 'meta', campaignId: 'fb', credit: 120, share: 1 }]);
  });

  it('linear splits evenly and sums to the conversion value', () => {
    const credits = allocateCredit('linear', journey, 120);
    expect(credits).toHaveLength(3);
    for (const c of credits) expect(c.credit).toBe(40);
    const odd = allocateCredit('linear', journey, 100);
    expect(odd.reduce((s, c) => s + c.credit, 0)).toBeCloseTo(100, 2);
  });

  it('falls back to direct when nothing is eligible', () => {
    expect(allocateCredit('last_touch', [], 50)).toEqual([{ channel: 'direct', campaignId: '(none)', credit: 50, share: 1 }]);
  });

  it('merges repeated channel/campaign credits and compares with tolerance', () => {
    const merged = mergeCredits([
      { channel: 'meta', campaignId: 'fb', credit: 40, share: 1 / 3 },
      { channel: 'meta', campaignId: 'fb', credit: 40, share: 1 / 3 },
    ]);
    expect(merged).toEqual([{ channel: 'meta', campaignId: 'fb', credit: 80, share: 2 / 3 }]);
    expect(creditsEqual([{ channel: 'meta', campaignId: 'fb', credit: 40.004, share: 1 }], [{ channel: 'meta', campaignId: 'fb', credit: 40, share: 1 }])).toBe(true);
    expect(creditsEqual([{ channel: 'meta', campaignId: 'fb', credit: 40, share: 1 }], [{ channel: 'google', campaignId: 'g', credit: 40, share: 1 }])).toBe(false);
  });
});
