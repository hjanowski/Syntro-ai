import type { ExecutionLogEntry } from '../domain/types.ts';
import type { Store } from '../store/store.ts';
import { randomId } from '../util/ids.ts';
import { nowIso } from '../util/time.ts';

export interface EngineConfig {
  /** Root of the static demo sites: `${siteBaseUrl}/store` and `${siteBaseUrl}/channels`. */
  siteBaseUrl: string;
  /** Absolute collector URL for HTTP transport, or "postmessage" for the browser-hosted engine. */
  collectorEndpoint: string;
  /** HMAC secret for synthetic session tokens. */
  secret: string;
  defaultConcurrency: number;
  captureScreenshots: boolean;
  actionTimeoutMs: number;
  navigationTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  maxRealWaitSeconds: number;
}

export function defaultEngineConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    siteBaseUrl: 'http://localhost:4100/sites',
    collectorEndpoint: 'http://localhost:4100/v1/collect',
    secret: 'syntro-dev-secret-change-me',
    defaultConcurrency: 3,
    captureScreenshots: true,
    actionTimeoutMs: 10_000,
    navigationTimeoutMs: 20_000,
    retryAttempts: 2,
    retryBackoffMs: 400,
    maxRealWaitSeconds: 60,
    ...overrides,
  };
}

export type LogLevel = ExecutionLogEntry['level'];

export interface EngineLogger {
  log(level: LogLevel, message: string, data?: Record<string, unknown>, ctx?: { runId?: string; customerId?: string }): void;
}

/** Logger that persists execution logs in the store (and optionally echoes to the console). */
export class StoreLogger implements EngineLogger {
  constructor(
    private readonly store: Store,
    private readonly echo: ((entry: ExecutionLogEntry) => void) | null = null,
    private readonly minLevel: LogLevel = 'info',
  ) {}

  log(level: LogLevel, message: string, data?: Record<string, unknown>, ctx?: { runId?: string; customerId?: string }): void {
    const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    if (order.indexOf(level) < order.indexOf(this.minLevel)) return;
    const entry: ExecutionLogEntry = { id: randomId('log'), runId: ctx?.runId ?? '', customerId: ctx?.customerId, ts: nowIso(), level, message, data };
    this.store.logs.put(entry);
    this.echo?.(entry);
  }
}
