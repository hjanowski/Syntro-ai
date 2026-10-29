import type { AttributionFacingEvent, AttributionResult, PlatformRecord, SystemUnderTestConfig } from '../../domain/types.ts';
import { randomId } from '../../util/ids.ts';
import { nowIso } from '../../util/time.ts';
import { LocalAttributionSystem } from '../sut/local-attribution-system.ts';
import { isAttributionResult, type AdapterDescription, type AttributionAdapter } from './types.ts';

export * from './types.ts';

/** Functional: the bundled local attribution system, instantiated per run (isolated dataset). */
export class LocalAttributionAdapter implements AttributionAdapter {
  readonly id = 'local';
  private system: LocalAttributionSystem;

  constructor(
    private readonly config: SystemUnderTestConfig,
    runId: string,
  ) {
    this.system = new LocalAttributionSystem(config, runId);
  }

  describe(): AdapterDescription {
    return {
      id: 'local',
      name: 'Syntro local attribution system (system under test)',
      maturity: 'functional',
      notes: `identity=${this.config.identityResolution}, lookback=${this.config.lookbackDays}d, models=${this.config.models.join('/')}`,
    };
  }

  async ingest(events: AttributionFacingEvent[], platformRecords: PlatformRecord[]): Promise<{ accepted: number }> {
    return { accepted: this.system.ingest(events, platformRecords) };
  }

  async getResults(): Promise<AttributionResult[]> {
    return this.system.compute();
  }
}

/**
 * Prototype: file/document exchange. Events are exported for the external system; the
 * system's results are pasted/uploaded as a JSON document conforming to AttributionResult[].
 */
export class FileAttributionAdapter implements AttributionAdapter {
  readonly id = 'file';
  exportedEvents: AttributionFacingEvent[] = [];
  exportedPlatformRecords: PlatformRecord[] = [];

  constructor(
    private readonly config: SystemUnderTestConfig,
    private readonly runId: string,
  ) {}

  describe(): AdapterDescription {
    return {
      id: 'file',
      name: 'Generic file exchange adapter',
      maturity: 'prototype',
      notes: 'Exports attribution-facing events; reads results from a JSON document supplied by the external attribution team.',
    };
  }

  async ingest(events: AttributionFacingEvent[], platformRecords: PlatformRecord[]): Promise<{ accepted: number }> {
    this.exportedEvents = events;
    this.exportedPlatformRecords = platformRecords;
    return { accepted: events.length };
  }

  async getResults(): Promise<AttributionResult[] | 'pending'> {
    const doc = this.config.external?.resultsDocument?.trim();
    if (!doc) return 'pending';
    return parseResultsDocument(doc, this.runId);
  }
}

/** Prototype: HTTP exchange with an external system's test environment. Not verified against a real vendor. */
export class HttpAttributionAdapter implements AttributionAdapter {
  readonly id = 'http';

  constructor(
    private readonly config: SystemUnderTestConfig,
    private readonly runId: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  describe(): AdapterDescription {
    return {
      id: 'http',
      name: 'Generic HTTP adapter',
      maturity: 'prototype',
      notes: 'POSTs events to the configured ingest URL and GETs results from the results URL (AttributionResult[] JSON).',
    };
  }

  async ingest(events: AttributionFacingEvent[], platformRecords: PlatformRecord[]): Promise<{ accepted: number }> {
    const url = this.config.external?.ingestUrl;
    if (!url) throw new Error('HTTP adapter requires external.ingestUrl');
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ run_id: this.runId, events, platform_records: platformRecords }),
    });
    if (!res.ok) throw new Error(`Ingest failed: HTTP ${res.status}`);
    return { accepted: events.length };
  }

  async getResults(): Promise<AttributionResult[] | 'pending'> {
    const url = this.config.external?.resultsUrl;
    if (!url) throw new Error('HTTP adapter requires external.resultsUrl');
    const res = await this.fetchImpl(`${url}${url.includes('?') ? '&' : '?'}run_id=${encodeURIComponent(this.runId)}`);
    if (res.status === 202 || res.status === 404) return 'pending';
    if (!res.ok) throw new Error(`Results fetch failed: HTTP ${res.status}`);
    return parseResultsDocument(await res.text(), this.runId);
  }
}

export function parseResultsDocument(doc: string, runId: string): AttributionResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(doc);
  } catch (e) {
    throw new Error(`Results document is not valid JSON: ${(e as Error).message}`);
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { results?: unknown[] })?.results;
  if (!Array.isArray(list)) throw new Error('Results document must be an array (or { results: [...] })');
  return list.map((item, i) => {
    if (!isAttributionResult(item)) throw new Error(`Result #${i} does not match the AttributionResult contract`);
    return { ...item, id: item.id ?? randomId('attr'), runId, adapter: item.adapter ?? 'external', computedAt: item.computedAt ?? nowIso() };
  });
}

export function createAttributionAdapter(config: SystemUnderTestConfig, runId: string): AttributionAdapter {
  switch (config.adapter) {
    case 'file':
      return new FileAttributionAdapter(config, runId);
    case 'http':
      return new HttpAttributionAdapter(config, runId);
    case 'local':
    default:
      return new LocalAttributionAdapter(config, runId);
  }
}
