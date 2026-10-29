import express from 'express';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineService, MemoryStore, StoreLogger, defaultEngineConfig, type BrowserDriver } from '@syntro/engine';
import { corsMiddleware, mountEngineApi } from './api/http.ts';
import { PlaywrightDriver } from './drivers/playwright-driver.ts';
import { attachJsonPersistence } from './store/json-persistence.ts';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SITES_DIR = path.join(REPO_ROOT, 'sites');
export const SDK_DIR = path.join(REPO_ROOT, 'sdk');
export const APP_DIST_DIR = path.join(REPO_ROOT, 'app', 'dist');

export interface NodeEngineOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  persist?: boolean;
  headless?: boolean;
  secret?: string;
  concurrency?: number;
  screenshots?: boolean;
  verbose?: boolean;
  /** Override the browser driver factory (tests). */
  driverFactory?: () => Promise<BrowserDriver>;
}

export interface NodeEngine {
  engine: EngineService;
  store: MemoryStore;
  server: Server;
  baseUrl: string;
  flush: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Boot the Node host: static demo sites + SDK, the HTTP API with the collector endpoint,
 * JSON persistence and Playwright execution workers. The app's production build is served
 * from "/" when it exists, so the whole product runs from a single local port.
 */
export async function createNodeEngine(opts: NodeEngineOptions = {}): Promise<NodeEngine> {
  const port = opts.port ?? Number(process.env.PORT ?? 4100);
  const host = opts.host ?? '127.0.0.1';
  const baseUrl = `http://localhost:${port}`;
  const store = new MemoryStore();
  let flush = async () => {};
  if (opts.persist ?? true) {
    const persistence = await attachJsonPersistence(store, opts.dataDir ?? path.join(REPO_ROOT, 'server', 'data'));
    flush = persistence.flush;
  }

  const config = defaultEngineConfig({
    siteBaseUrl: `${baseUrl}/sites`,
    collectorEndpoint: `${baseUrl}/v1/collect`,
    secret: opts.secret ?? process.env.SYNTRO_SECRET ?? 'syntro-dev-secret-change-me',
    defaultConcurrency: opts.concurrency ?? 3,
    captureScreenshots: opts.screenshots ?? true,
  });

  const logger = new StoreLogger(store, opts.verbose ? (e) => console.log(`[${e.level}] ${e.customerId ? e.customerId + ' ' : ''}${e.message}`) : null);
  const driverFactory = opts.driverFactory ?? (() => PlaywrightDriver.launch({ headless: opts.headless ?? true }));

  const engine = new EngineService({
    store,
    config,
    driverFactory,
    host: 'node',
    driverName: 'playwright-chromium',
    driverCapabilities: { screenshots: true, realIsolation: true, deviceEmulation: true },
    persistent: opts.persist ?? true,
    logger,
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(corsMiddleware);
  app.use(express.json({ limit: '8mb' }));
  app.use('/sites', express.static(SITES_DIR, { etag: false, cacheControl: false }));
  app.use('/sdk', express.static(SDK_DIR, { etag: false, cacheControl: false }));
  mountEngineApi(app, engine);

  if (existsSync(path.join(APP_DIST_DIR, 'index.html'))) {
    app.use(express.static(APP_DIST_DIR));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/v1') || req.path.startsWith('/sites') || req.path.startsWith('/sdk')) return next();
      res.sendFile(path.join(APP_DIST_DIR, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.type('html').send(devLandingPage(baseUrl));
    });
  }

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  return {
    engine,
    store,
    server,
    baseUrl,
    flush,
    close: async () => {
      await flush();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function devLandingPage(baseUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Syntro Engine</title>
<style>body{font-family:ui-sans-serif,system-ui;max-width:720px;margin:48px auto;padding:0 24px;color:#0f172a;line-height:1.5}code{background:#f1f5f9;padding:2px 6px;border-radius:6px}a{color:#4f46e5}</style></head>
<body><h1>Syntro Engine — developer interface</h1>
<p>Layer 1 is running. The Layer 2 app has not been built yet (run <code>npm run build</code> and restart to serve it here).</p>
<ul>
<li>API: <a href="${baseUrl}/v1/health">${baseUrl}/v1/health</a></li>
<li>Demo store: <a href="${baseUrl}/sites/store/index.html">${baseUrl}/sites/store/index.html</a></li>
<li>Simulated Meta environment: <a href="${baseUrl}/sites/channels/meta.html?campaign_id=demo&dest=${encodeURIComponent(baseUrl + '/sites/store/index.html')}">meta.html</a></li>
<li>SDK: <a href="${baseUrl}/sdk/syntro.js">${baseUrl}/sdk/syntro.js</a></li>
</ul>
<p>CLI: <code>npm run demo</code> runs the investor demonstration end to end from the terminal.</p>
</body></html>`;
}
