import type { AttributionPolicy, ExpectedAttribution, ExpectedIdentity, LedgerEntry, SyntheticCustomer } from '../domain/types.ts';
import { allocateCredit, splitEligibility } from '../attribution/reference.ts';

/**
 * Derive the ground truth ledger's *expectations* from what was actually executed:
 * which cookie jars a correct attribution system should link, and what credit each
 * conversion should receive under the project's attribution policy.
 */
export function computeExpectedIdentity(customer: SyntheticCustomer, identifiedSessionIds: Set<string>): ExpectedIdentity {
  const sessions = customer.sessions.map((s) => ({
    sessionId: s.id,
    cookieJarId: s.cookieJarId,
    contextId: s.contextId,
    identifiedWithEmail: identifiedSessionIds.has(s.id),
  }));
  const linkGroups = computeLinkGroups(sessions);
  const jars = new Set(sessions.map((s) => s.cookieJarId));
  const stitchRequired = jars.size > 1 && linkGroups.some((g) => g.length > 1);
  return { email: customer.email, sessions, linkGroups, stitchRequired };
}

/** Cookie jars are linked when they share an identified email. */
export function computeLinkGroups(sessions: ExpectedIdentity['sessions']): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const s of sessions) {
    find(s.cookieJarId);
    if (s.identifiedWithEmail) union(s.cookieJarId, '__email__');
  }
  const groups = new Map<string, string[]>();
  for (const key of parent.keys()) {
    if (key === '__email__') continue;
    const root = find(key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(key);
  }
  return Array.from(groups.values());
}

export function linkGroupFor(identity: ExpectedIdentity, cookieJarId: string): string[] {
  return identity.linkGroups.find((g) => g.includes(cookieJarId)) ?? [cookieJarId];
}

export function computeExpectedAttribution(entry: LedgerEntry, policy: AttributionPolicy): ExpectedAttribution[] {
  const out: ExpectedAttribution[] = [];
  for (const conversion of entry.conversions) {
    const group = new Set(linkGroupFor(entry.identity, conversion.cookieJarId));
    const linkable = entry.touchpoints.filter((tp) => group.has(tp.cookieJarId));
    const unlinkable = entry.touchpoints.filter((tp) => !group.has(tp.cookieJarId));
    const { eligible, ineligible } = splitEligibility(
      linkable.map((tp) => ({ id: tp.id, channel: tp.channel, campaignId: tp.campaignId, ts: tp.ts })),
      { id: conversion.id, ts: conversion.ts, value: conversion.value },
      policy.lookbackDays,
    );
    const notes: string[] = [];
    if (unlinkable.length) notes.push(`${unlinkable.length} touchpoint(s) executed but not linkable by design (cookies cleared or device changed without identification).`);
    if (ineligible.length) notes.push(`${ineligible.length} touchpoint(s) outside the ${policy.lookbackDays}-day lookback window.`);
    if (!eligible.length) notes.push('No eligible touchpoints — expected result is direct.');
    for (const model of policy.models) {
      out.push({
        conversionId: conversion.id,
        model,
        lookbackDays: policy.lookbackDays,
        credits: allocateCredit(model, eligible, conversion.value),
        eligibleTouchpointIds: eligible.map((t) => t.id),
        ineligibleTouchpointIds: [...ineligible.map((t) => t.id), ...unlinkable.map((t) => t.id)],
        note: notes.join(' ') || undefined,
      });
    }
  }
  return out;
}
