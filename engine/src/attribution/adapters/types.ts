import type { AttributionFacingEvent, AttributionResult, IntegrationMaturity, PlatformRecord } from '../../domain/types.ts';

/**
 * Attribution adapter contract.
 *
 * An adapter connects Syntro to an attribution system: it pushes attribution-facing
 * events (and optional source-platform records) into the system's *test* ingestion
 * pipeline and retrieves the journeys/credits the system produced. Results must come
 * from the system itself — adapters never compute attribution.
 */
export interface AdapterDescription {
  id: string;
  name: string;
  maturity: IntegrationMaturity;
  notes: string;
}

export interface AttributionAdapter {
  readonly id: string;
  describe(): AdapterDescription;
  /** Deliver events to the system under test. Idempotent per run. */
  ingest(events: AttributionFacingEvent[], platformRecords: PlatformRecord[]): Promise<{ accepted: number }>;
  /** Retrieve results; 'pending' when the external system has not produced them yet. */
  getResults(): Promise<AttributionResult[] | 'pending'>;
}

/** Shape external systems must return (one entry per conversion × model). See docs/API.md. */
export function isAttributionResult(value: unknown): value is AttributionResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.model === 'string' &&
    typeof v.conversion === 'object' &&
    v.conversion !== null &&
    Array.isArray(v.credits) &&
    Array.isArray(v.journey) &&
    typeof v.identity === 'object'
  );
}
