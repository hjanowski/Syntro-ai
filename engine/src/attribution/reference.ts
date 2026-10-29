import type { AttributionModel, Channel, Credit } from '../domain/types.ts';
import { DAY_MS, ms } from '../util/time.ts';

/**
 * Independent reference attribution model.
 *
 * Computes the attribution a *correct* system should produce from ground-truth
 * touchpoints. It never looks at observed events or at the system under test, so a
 * validation pass is a genuine comparison of two independently derived results.
 */
export interface RefTouchpoint {
  id: string;
  channel: Channel;
  campaignId: string;
  ts: string;
}

export interface RefConversion {
  id: string;
  ts: string;
  value: number;
}

export const DIRECT_CAMPAIGN = '(none)';

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function splitEligibility(touchpoints: RefTouchpoint[], conversion: RefConversion, lookbackDays: number): { eligible: RefTouchpoint[]; ineligible: RefTouchpoint[] } {
  const convTs = ms(conversion.ts);
  const windowStart = convTs - lookbackDays * DAY_MS;
  const eligible: RefTouchpoint[] = [];
  const ineligible: RefTouchpoint[] = [];
  for (const tp of touchpoints) {
    const t = ms(tp.ts);
    if (t <= convTs && t >= windowStart) eligible.push(tp);
    else ineligible.push(tp);
  }
  eligible.sort((a, b) => ms(a.ts) - ms(b.ts));
  return { eligible, ineligible };
}

export function directCredit(value: number): Credit[] {
  return [{ channel: 'direct', campaignId: DIRECT_CAMPAIGN, credit: roundMoney(value), share: 1 }];
}

/** Allocate conversion credit across eligible touchpoints (already sorted by time ascending). */
export function allocateCredit(model: AttributionModel, eligible: RefTouchpoint[], value: number): Credit[] {
  if (eligible.length === 0) return directCredit(value);
  switch (model) {
    case 'first_touch': {
      const tp = eligible[0];
      return [{ channel: tp.channel, campaignId: tp.campaignId, credit: roundMoney(value), share: 1 }];
    }
    case 'last_touch': {
      const tp = eligible[eligible.length - 1];
      return [{ channel: tp.channel, campaignId: tp.campaignId, credit: roundMoney(value), share: 1 }];
    }
    case 'linear': {
      const share = 1 / eligible.length;
      const credits: Credit[] = eligible.map((tp) => ({ channel: tp.channel, campaignId: tp.campaignId, credit: roundMoney(value * share), share }));
      // Push rounding residue onto the last touchpoint so credits sum to the conversion value.
      const allocated = credits.reduce((sum, c) => sum + c.credit, 0);
      credits[credits.length - 1].credit = roundMoney(credits[credits.length - 1].credit + (roundMoney(value) - roundMoney(allocated)));
      return mergeCredits(credits);
    }
  }
}

/** Merge credits that land on the same channel+campaign (e.g. two Meta clicks in a linear model). */
export function mergeCredits(credits: Credit[]): Credit[] {
  const map = new Map<string, Credit>();
  for (const c of credits) {
    const key = creditKey(c);
    const existing = map.get(key);
    if (existing) {
      existing.credit = roundMoney(existing.credit + c.credit);
      existing.share += c.share;
    } else {
      map.set(key, { ...c });
    }
  }
  return Array.from(map.values());
}

export function creditKey(c: Pick<Credit, 'channel' | 'campaignId'>): string {
  return `${c.channel}|${c.campaignId}`;
}

export function creditsEqual(expected: Credit[], actual: Credit[], tolerance = 0.011): boolean {
  const a = mergeCredits(expected);
  const b = mergeCredits(actual);
  if (a.length !== b.length) return false;
  const byKey = new Map(b.map((c) => [creditKey(c), c]));
  for (const c of a) {
    const other = byKey.get(creditKey(c));
    if (!other) return false;
    if (Math.abs(other.credit - c.credit) > tolerance) return false;
    if (Math.abs(other.share - c.share) > 0.001) return false;
  }
  return true;
}

export function describeCredits(credits: Credit[]): string {
  if (!credits.length) return '—';
  return mergeCredits(credits)
    .map((c) => `${c.channel}${c.campaignId !== DIRECT_CAMPAIGN ? ` (${c.campaignId})` : ''}: ${formatMoney(c.credit)} · ${Math.round(c.share * 100)}%`)
    .join(', ');
}

export function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}
