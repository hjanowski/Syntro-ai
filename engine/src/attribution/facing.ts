import type { AttributionFacingEvent, CollectedEvent } from '../domain/types.ts';

/**
 * Project collected events onto what the attribution system under test may see.
 * Synthetic customer / run / scenario identifiers are stripped so the SUT cannot
 * "cheat" by joining on Syntro's own ids — it must stitch identities like a real system.
 */
export function toAttributionFacing(events: CollectedEvent[]): AttributionFacingEvent[] {
  return events
    .filter((e) => e.source === 'website')
    .map((e) => ({
      eventId: e.id,
      ts: e.ts,
      type: e.eventType,
      anonymousId: e.anonymousId,
      userKey: e.userKey,
      url: e.url,
      path: e.path,
      referrer: e.referrer,
      utm: e.utm,
      clickIds: e.clickIds,
      revenue: e.revenue,
      orderId: e.orderId,
    }));
}
