import type { Channel, PlatformRecord } from '../domain/types.ts';
import { randomId } from '../util/ids.ts';

/**
 * Synthetic source-platform data adapter.
 *
 * Simulated ad clicks are *website* click events; they do not reproduce genuine platform
 * click identifiers or API behaviour. Where an attribution system needs source-platform
 * data (click logs, segment membership, message delivery), the engine emits approved
 * synthetic records through this adapter so they can be sent to the system's test
 * ingestion pipeline alongside the website events.
 */
export function platformRecord(input: {
  runId: string;
  customerId: string;
  kind: PlatformRecord['kind'];
  channel: Channel;
  campaignId: string;
  creativeId?: string;
  clickId?: string;
  ts: string;
  contactHash?: string;
  segmentId?: string;
}): PlatformRecord {
  return { id: randomId('plat'), ...input };
}
