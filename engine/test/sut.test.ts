import { describe, expect, it } from 'vitest';
import { LocalAttributionSystem } from '../src/attribution/sut/local-attribution-system.ts';
import { defaultSutConfig } from '../src/service/engine-service.ts';
import type { AttributionFacingEvent, PlatformRecord } from '../src/domain/types.ts';

const day = 24 * 3600 * 1000;
const base = Date.parse('2026-03-01T12:00:00Z');
const at = (daysBefore: number) => new Date(base - daysBefore * day).toISOString();

function pageView(id: string, anonymousId: string, ts: string, utm: Record<string, string>, clickIds: Record<string, string> = {}, userKey?: string): AttributionFacingEvent {
  return { eventId: id, ts, type: 'page_view', anonymousId, userKey, url: 'http://store/index.html', path: '/index.html', referrer: '', utm, clickIds };
}
function purchase(id: string, anonymousId: string, ts: string, orderId: string, revenue: number, userKey?: string): AttributionFacingEvent {
  return { eventId: id, ts, type: 'purchase', anonymousId, userKey, url: 'http://store/order.html', path: '/order.html', referrer: '', utm: {}, clickIds: {}, revenue, orderId };
}
function identify(id: string, anonymousId: string, ts: string, userKey: string): AttributionFacingEvent {
  return { eventId: id, ts, type: 'identify', anonymousId, userKey, url: 'http://store/account.html', path: '/account.html', referrer: '', utm: {}, clickIds: {} };
}

describe('local attribution system under test', () => {
  const singleDevice = [
    pageView('e1', 'A', at(5), { utm_source: 'email', utm_medium: 'email', utm_campaign: 'em' }),
    pageView('e2', 'A', at(3), { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'g' }, { gclid: 'syn_g' }),
    pageView('e3', 'A', at(1), { utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'fb' }, { fbclid: 'syn_fb' }),
    purchase('e4', 'A', at(0), 'ORD-1', 120, 'hash'),
  ];

  it('attributes a single-cookie journey under every model', () => {
    const sut = new LocalAttributionSystem(defaultSutConfig(), 'run');
    sut.ingest(singleDevice);
    const results = sut.compute();
    expect(results).toHaveLength(3);
    const by = Object.fromEntries(results.map((r) => [r.model, r]));
    expect(by.first_touch.credits).toEqual([{ channel: 'email', campaignId: 'em', credit: 120, share: 1 }]);
    expect(by.last_touch.credits).toEqual([{ channel: 'meta', campaignId: 'fb', credit: 120, share: 1 }]);
    expect(by.linear.credits.map((c) => c.credit)).toEqual([40, 40, 40]);
    expect(by.last_touch.journey).toHaveLength(3);
  });

  it('cookie-only identity resolution does not stitch devices; email stitching does', () => {
    const crossDevice = [
      pageView('e1', 'A', at(5), { utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'fb' }),
      identify('e2', 'A', at(5), 'hash'),
      identify('e3', 'B', at(0), 'hash'),
      purchase('e4', 'B', at(0), 'ORD-2', 100, 'hash'),
    ];
    const cookieOnly = new LocalAttributionSystem(defaultSutConfig({ models: ['last_touch'], identityResolution: 'cookie_only' }), 'run');
    cookieOnly.ingest(crossDevice);
    expect(cookieOnly.compute()[0].credits[0].channel).toBe('direct');

    const stitched = new LocalAttributionSystem(defaultSutConfig({ models: ['last_touch'], identityResolution: 'cookie_and_email' }), 'run');
    stitched.ingest(crossDevice);
    const result = stitched.compute()[0];
    expect(result.credits[0].channel).toBe('meta');
    expect(result.identity.anonymousIds.sort()).toEqual(['A', 'B']);
  });

  it('respects its configured lookback window', () => {
    const sut = new LocalAttributionSystem(defaultSutConfig({ models: ['last_touch'], lookbackDays: 30 }), 'run');
    sut.ingest([pageView('e1', 'A', at(45), { utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'fb' }), purchase('e2', 'A', at(0), 'ORD-3', 85)]);
    const r = sut.compute()[0];
    expect(r.credits[0].channel).toBe('direct');
    expect(r.journey[0].eligible).toBe(false);
  });

  it('counts duplicate purchases unless deduplication by order id is enabled', () => {
    const events = [pageView('e1', 'A', at(1), { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'g' }), purchase('e2', 'A', at(0), 'ORD-4', 120), purchase('e3', 'A', at(0), 'ORD-4', 120)];
    const noDedupe = new LocalAttributionSystem(defaultSutConfig({ models: ['last_touch'], dedupeConversionsByOrderId: false }), 'run');
    noDedupe.ingest(events);
    expect(noDedupe.compute()).toHaveLength(2);
    const dedupe = new LocalAttributionSystem(defaultSutConfig({ models: ['last_touch'], dedupeConversionsByOrderId: true }), 'run');
    dedupe.ingest(events);
    expect(dedupe.compute()).toHaveLength(1);
  });

  it('cannot classify a landing without UTMs and without a mapped click id, unless platform records are joined', () => {
    const events = [pageView('e1', 'A', at(1), {}, { li_fat_id: 'syn_li' }), purchase('e2', 'A', at(0), 'ORD-5', 160)];
    const plain = new LocalAttributionSystem(defaultSutConfig({ models: ['last_touch'] }), 'run');
    plain.ingest(events);
    expect(plain.compute()[0].credits[0].channel).toBe('unknown');

    const record: PlatformRecord = { id: 'p1', runId: 'run', customerId: 'c', kind: 'ad_click', channel: 'linkedin', campaignId: 'li_abm_q4', clickId: 'syn_li', ts: at(1) };
    const joined = new LocalAttributionSystem(defaultSutConfig({ models: ['last_touch'], usePlatformClickRecords: true }), 'run');
    joined.ingest(events, [record]);
    expect(joined.compute()[0].credits[0]).toMatchObject({ channel: 'linkedin', campaignId: 'li_abm_q4' });
  });

  it('applies deliberate faults: ignored channels and mis-mapped campaigns', () => {
    const sut = new LocalAttributionSystem(defaultSutConfig({ models: ['last_touch'], faults: { ignoreChannels: ['meta'], misattributeCampaign: { from: 'g', to: 'g_old' } } }), 'run');
    sut.ingest(singleDevice);
    const r = sut.compute()[0];
    expect(r.credits[0]).toMatchObject({ channel: 'google', campaignId: 'g_old' });
  });
});
