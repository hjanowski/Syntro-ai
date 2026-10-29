import type {
  AttributedTouchpoint,
  AttributionFacingEvent,
  AttributionModel,
  AttributionResult,
  Channel,
  Credit,
  PlatformRecord,
  SystemUnderTestConfig,
} from '../../domain/types.ts';
import { randomId } from '../../util/ids.ts';
import { DAY_MS, ms, nowIso } from '../../util/time.ts';

/**
 * Local attribution system under test (SUT).
 *
 * A deliberately *separate* implementation from the reference model. It behaves like a
 * typical attribution tool: it only sees attribution-facing events (anonymous ids,
 * hashed user keys, URLs, UTMs, click ids, revenue), resolves identities, classifies
 * touchpoints with configurable rules, and allocates credit. Its configuration can be
 * wrong on purpose (cookie-only identity, wrong lookback, missing click-id mappings,
 * dropped channels, mis-mapped campaigns) so Syntro can prove it detects the damage.
 */
interface SutTouchpoint {
  id: string;
  anonymousId: string;
  channel: Channel;
  campaignId: string;
  ts: number;
}

interface SutConversion {
  id: string;
  anonymousId: string;
  type: string;
  value: number;
  ts: number;
  orderId?: string;
  userKey?: string;
}

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  members(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(key);
    }
    return groups;
  }
}

export class LocalAttributionSystem {
  private events: AttributionFacingEvent[] = [];
  private platformRecords: PlatformRecord[] = [];

  constructor(
    private readonly config: SystemUnderTestConfig,
    private readonly runId: string,
  ) {}

  ingest(events: AttributionFacingEvent[], platformRecords: PlatformRecord[] = []): number {
    this.events.push(...events);
    this.platformRecords.push(...platformRecords);
    return events.length;
  }

  compute(): AttributionResult[] {
    const identities = this.resolveIdentities();
    const touchpoints = this.extractTouchpoints();
    const conversions = this.extractConversions();
    const results: AttributionResult[] = [];
    const now = nowIso();

    const groups = identities.members();
    const rootOf = (anonymousId: string) => identities.find(anonymousId);

    for (const conversion of conversions) {
      const identityId = rootOf(conversion.anonymousId);
      const memberKeys = groups.get(identityId) ?? [conversion.anonymousId];
      const anonymousIds = memberKeys.filter((k) => !k.startsWith('user:'));
      const userKey = memberKeys.find((k) => k.startsWith('user:'))?.slice(5);
      const identityTouchpoints = touchpoints.filter((tp) => rootOf(tp.anonymousId) === identityId).sort((a, b) => a.ts - b.ts);

      for (const model of this.config.models) {
        const lookbackMs = this.config.lookbackDays * DAY_MS;
        const journey: AttributedTouchpoint[] = identityTouchpoints
          .filter((tp) => tp.ts <= conversion.ts)
          .map((tp) => {
            const withinWindow = conversion.ts - tp.ts <= lookbackMs;
            return {
              touchpointId: tp.id,
              channel: tp.channel,
              campaignId: tp.campaignId,
              ts: new Date(tp.ts).toISOString(),
              anonymousId: tp.anonymousId,
              eligible: withinWindow,
              reason: withinWindow ? undefined : `outside ${this.config.lookbackDays}-day lookback`,
            };
          });
        const eligible = journey.filter((j) => j.eligible);
        results.push({
          id: randomId('attr'),
          runId: this.runId,
          adapter: 'local',
          model,
          lookbackDays: this.config.lookbackDays,
          conversion: {
            id: conversion.id,
            orderId: conversion.orderId,
            type: conversion.type,
            value: conversion.value,
            ts: new Date(conversion.ts).toISOString(),
            anonymousId: conversion.anonymousId,
          },
          identity: { id: identityId, anonymousIds, userKey },
          journey,
          credits: this.allocate(model, eligible, conversion.value),
          computedAt: now,
        });
      }
    }
    return results;
  }

  // -- identity resolution ---------------------------------------------------

  private resolveIdentities(): UnionFind {
    const uf = new UnionFind();
    for (const e of this.events) {
      uf.find(e.anonymousId);
      if (this.config.identityResolution === 'cookie_and_email' && e.userKey) {
        uf.union(e.anonymousId, `user:${e.userKey}`);
      }
    }
    return uf;
  }

  // -- touchpoint classification --------------------------------------------

  private extractTouchpoints(): SutTouchpoint[] {
    const out: SutTouchpoint[] = [];
    const ignore = new Set(this.config.faults.ignoreChannels ?? []);
    for (const e of this.events) {
      if (e.type !== 'page_view') continue;
      const classified = this.classify(e);
      if (!classified) continue;
      let { channel, campaignId } = classified;
      if (ignore.has(channel)) continue;
      const swap = this.config.faults.misattributeCampaign;
      if (swap && swap.from && campaignId === swap.from) campaignId = swap.to;
      out.push({ id: `tp_${e.eventId}`, anonymousId: e.anonymousId, channel, campaignId, ts: ms(e.ts) });
    }
    return out;
  }

  private classify(e: AttributionFacingEvent): { channel: Channel; campaignId: string } | null {
    const source = (e.utm.utm_source ?? '').toLowerCase();
    const medium = (e.utm.utm_medium ?? '').toLowerCase();
    const campaign = e.utm.utm_campaign;

    if (source) {
      const mapped = this.config.utmSourceMappings[source];
      if (mapped) return { channel: mapped, campaignId: campaign ?? `${mapped}_unknown_campaign` };
      if (medium === 'email') return { channel: 'email', campaignId: campaign ?? 'email_unknown_campaign' };
      return { channel: 'referral', campaignId: campaign ?? source };
    }

    for (const [param, clickId] of Object.entries(e.clickIds)) {
      const mapped = this.config.clickIdMappings[param];
      if (mapped) {
        const record = this.config.usePlatformClickRecords ? this.platformRecords.find((r) => r.clickId === clickId) : undefined;
        return { channel: mapped, campaignId: campaign ?? record?.campaignId ?? `${mapped}_unknown_campaign` };
      }
      if (this.config.usePlatformClickRecords) {
        const record = this.platformRecords.find((r) => r.clickId === clickId);
        if (record) return { channel: record.channel, campaignId: record.campaignId };
      }
    }

    // A landing with an unknown click id and no UTMs looks like a plain visit.
    if (Object.keys(e.clickIds).length > 0) return { channel: 'unknown', campaignId: 'unclassified_click' };

    if (e.referrer) {
      try {
        const host = new URL(e.referrer).host;
        const own = new URL(e.url).host;
        if (host && host !== own) return { channel: 'referral', campaignId: host };
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  // -- conversions -------------------------------------------------------------

  private extractConversions(): SutConversion[] {
    const out: SutConversion[] = [];
    const seenOrders = new Set<string>();
    for (const e of this.events) {
      if (!['purchase', 'lead', 'signup', 'quote_request'].includes(e.type) && !(e.type.startsWith('conversion:'))) continue;
      if (e.type === 'purchase' && e.orderId && this.config.dedupeConversionsByOrderId) {
        if (seenOrders.has(e.orderId)) continue;
        seenOrders.add(e.orderId);
      }
      out.push({
        id: `conv_${e.eventId}`,
        anonymousId: e.anonymousId,
        type: e.type.replace(/^conversion:/, ''),
        value: typeof e.revenue === 'number' ? e.revenue : 0,
        ts: ms(e.ts),
        orderId: e.orderId,
        userKey: e.userKey,
      });
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  // -- credit allocation (independent implementation) -------------------------

  private allocate(model: AttributionModel, eligible: AttributedTouchpoint[], value: number): Credit[] {
    const n = eligible.length;
    if (n === 0) return [{ channel: 'direct', campaignId: '(none)', credit: round2(value), share: 1 }];
    const weights = new Array<number>(n).fill(0);
    if (model === 'first_touch') weights[0] = 1;
    else if (model === 'last_touch') weights[n - 1] = 1;
    else for (let i = 0; i < n; i++) weights[i] = 1 / n;

    const byKey = new Map<string, Credit>();
    let allocated = 0;
    eligible.forEach((tp, i) => {
      if (weights[i] === 0) return;
      const key = `${tp.channel}|${tp.campaignId}`;
      const amount = round2(value * weights[i]);
      allocated += amount;
      const existing = byKey.get(key);
      if (existing) {
        existing.credit = round2(existing.credit + amount);
        existing.share += weights[i];
      } else byKey.set(key, { channel: tp.channel, campaignId: tp.campaignId, credit: amount, share: weights[i] });
    });
    const credits = Array.from(byKey.values());
    const residue = round2(round2(value) - round2(allocated));
    if (residue !== 0 && credits.length) credits[credits.length - 1].credit = round2(credits[credits.length - 1].credit + residue);
    return credits;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
