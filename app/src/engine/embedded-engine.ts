import { COLLECTION_NAMES, EngineService, MemoryStore, defaultEngineConfig, randomHex, type StoreSnapshot } from '@syntro/engine';
import { IframeDriver, browserHost } from './iframe-driver.ts';

const STORE_KEY = 'syntro.store.v1';
const SECRET_KEY = 'syntro.secret.v1';

export interface EmbeddedEngine {
  service: EngineService;
  store: MemoryStore;
  siteBaseUrl: string;
  persistenceWarning: string | null;
}

let singleton: EmbeddedEngine | null = null;

/**
 * Boot the Layer 1 engine inside the browser tab: in-memory store persisted to localStorage,
 * postMessage collector bridge, and the sandboxed-iframe execution driver. Used by the static
 * GitHub Pages deployment (no server) and by local development without the Node host.
 */
export function getEmbeddedEngine(): EmbeddedEngine {
  if (singleton) return singleton;

  const store = new MemoryStore();
  let persistenceWarning: string | null = null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) store.load(JSON.parse(raw) as StoreSnapshot);
  } catch (e) {
    persistenceWarning = `Stored data could not be loaded: ${(e as Error).message}`;
  }

  const base = new URL(import.meta.env.BASE_URL, window.location.origin).toString().replace(/\/$/, '');
  const siteBaseUrl = `${base}/sites`;
  // Bundled-demo projects follow the deployment: keep their website URL in sync with where the app is served.
  for (const project of store.projects.list()) {
    if (project.website.kind === 'bundled_demo_store' && project.website.baseUrl !== `${siteBaseUrl}/store`) {
      project.website.baseUrl = `${siteBaseUrl}/store`;
      store.projects.put(project);
    }
  }
  for (const run of store.runs.list()) {
    if (run.status === 'running' || run.status === 'queued' || run.status === 'finalizing') {
      run.status = 'failed';
      run.error = 'Interrupted: the browser tab was closed while the simulation was executing.';
      store.runs.put(run);
    }
  }

  let secret = localStorage.getItem(SECRET_KEY);
  if (!secret) {
    secret = randomHex(24);
    try {
      localStorage.setItem(SECRET_KEY, secret);
    } catch {
      /* ephemeral */
    }
  }

  const config = defaultEngineConfig({
    siteBaseUrl,
    collectorEndpoint: 'postmessage',
    secret,
    defaultConcurrency: 3,
    captureScreenshots: false,
    navigationTimeoutMs: 15_000,
    actionTimeoutMs: 10_000,
  });

  const service = new EngineService({
    store,
    config,
    driverFactory: async () => new IframeDriver(),
    host: 'browser',
    driverName: 'browser-iframe',
    driverCapabilities: { screenshots: false, realIsolation: false, deviceEmulation: false },
    persistent: true,
  });

  // Collector bridge: the SDK inside each sandboxed frame posts { __syntroCollect, token, events }.
  window.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as { __syntroCollect?: boolean; token?: string; events?: unknown[] } | null;
    if (!msg || msg.__syntroCollect !== true) return;
    if (!browserHost.ownsWindow(ev.source)) return;
    service.collect({ token: String(msg.token ?? ''), events: (msg.events ?? []) as never[] }).catch((e: Error) => console.warn('[syntro] collector rejected batch:', e.message));
  });

  // Debounced persistence.
  let timer: number | null = null;
  const dirty = new Set<string>();
  store.onChange((name) => {
    dirty.add(name);
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = null;
      dirty.clear();
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(store.snapshot(COLLECTION_NAMES)));
        singleton!.persistenceWarning = null;
      } catch (e) {
        singleton!.persistenceWarning = `Browser storage is full or unavailable; results stay in memory for this tab only (${(e as Error).message}).`;
      }
    }, 400);
  });

  singleton = { service, store, siteBaseUrl, persistenceWarning };
  return singleton;
}

export function clearEmbeddedStorage(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}
