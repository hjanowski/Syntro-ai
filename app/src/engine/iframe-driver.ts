import type { BrowserContextHandle, BrowserDriver, ContextOptions, DeviceProfile, DriverCapabilities, PageSnapshot } from '@syntro/engine';
import { DriverError, randomId } from '@syntro/engine';

/**
 * Browser-hosted execution driver.
 *
 * Each synthetic customer gets a sandboxed <iframe> (no `allow-same-origin` ⇒ opaque origin ⇒
 * its own isolated storage, no shared cookies). Pages are driven through the harness agent
 * embedded in the demo sites over postMessage, which plays the role Playwright plays on the
 * Node host. The website SDK inside the frame posts events back to the parent, where the
 * embedded collector verifies the signed token. Screenshots are not available in this mode;
 * DOM snapshots are captured instead.
 */
export interface LiveContext {
  id: string;
  label: string;
  device: DeviceProfile;
  url: string;
  status: 'open' | 'closed';
}

type Listener = () => void;

class BrowserHostRegistry {
  element: HTMLElement | null = null;
  /** How frames are isolated in this browser: opaque origin (real) or shared origin with window.name confinement. */
  isolation: 'opaque' | 'shared' | 'unknown' = 'unknown';
  private contexts = new Map<string, LiveContext>();
  private windows = new Set<Window>();
  private listeners = new Set<Listener>();

  attach(el: HTMLElement | null) {
    this.element = el;
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): LiveContext[] {
    return Array.from(this.contexts.values());
  }

  /** @internal */
  register(ctx: LiveContext, win: Window | null) {
    this.contexts.set(ctx.id, ctx);
    if (win) this.windows.add(win);
    this.notify();
  }

  /** @internal */
  update(id: string, patch: Partial<LiveContext>) {
    const ctx = this.contexts.get(id);
    if (!ctx) return;
    Object.assign(ctx, patch);
    this.notify();
  }

  /** @internal */
  unregister(id: string, win: Window | null) {
    this.contexts.delete(id);
    if (win) this.windows.delete(win);
    this.notify();
  }

  ownsWindow(win: unknown): boolean {
    return this.windows.has(win as Window);
  }

  private notify() {
    for (const l of this.listeners) l();
  }
}

export const browserHost = new BrowserHostRegistry();

export type FrameIsolation = 'opaque' | 'shared';

let isolationProbe: Promise<FrameIsolation> | null = null;

/**
 * Opaque-origin sandboxed frames give real storage isolation, but some browsers refuse to load
 * subresources (scripts, styles) into opaque frames from local/private hosts (local-network access
 * policies). Probe once: load the SDK file into a sandboxed srcdoc frame and see whether it executes.
 * If not, fall back to same-origin frames whose state is confined to window.name by the harness.
 */
export function detectFrameIsolation(): Promise<FrameIsolation> {
  if (isolationProbe) return isolationProbe;
  isolationProbe = new Promise<FrameIsolation>((resolve) => {
    const base = new URL(import.meta.env.BASE_URL, window.location.origin).toString().replace(/\/$/, '');
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.display = 'none';
    const done = (mode: FrameIsolation) => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      frame.remove();
      browserHost.isolation = mode;
      resolve(mode);
    };
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== frame.contentWindow) return;
      const d = ev.data as { __syntroProbe?: string } | null;
      if (d?.__syntroProbe === 'ok') done('opaque');
      if (d?.__syntroProbe === 'fail') done('shared');
    };
    const timer = window.setTimeout(() => done('shared'), 4000);
    window.addEventListener('message', onMessage);
    frame.srcdoc = `<script src="${base}/sites/shared/name-storage.js" onload="parent.postMessage({__syntroProbe: window.SyntroStorage ? 'ok' : 'fail'}, '*')" onerror="parent.postMessage({__syntroProbe:'fail'}, '*')"></script>`;
    document.body.appendChild(frame);
  });
  return isolationProbe;
}

export class IframeDriver implements BrowserDriver {
  readonly name = 'browser-iframe';
  readonly capabilities: DriverCapabilities = { screenshots: false, realIsolation: false, deviceEmulation: false };
  private handles = new Set<IframeContextHandle>();

  constructor(private readonly timeouts = { navigation: 15_000, action: 10_000 }) {}

  async newContext(opts: ContextOptions): Promise<BrowserContextHandle> {
    const host = browserHost.element;
    if (!host) throw new DriverError('Live browser host is not mounted', 'newContext');
    const isolation = await detectFrameIsolation();
    const handle = new IframeContextHandle(opts, host, this.timeouts, isolation);
    this.handles.add(handle);
    return handle;
  }

  async dispose(): Promise<void> {
    for (const h of this.handles) await h.close().catch(() => undefined);
    this.handles.clear();
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: number;
}

class IframeContextHandle implements BrowserContextHandle {
  readonly id: string;
  private readonly wrapper: HTMLDivElement;
  private readonly iframe: HTMLIFrameElement;
  private readonly pending = new Map<string, Pending>();
  private readyWaiters: { resolve: () => void; reject: (e: Error) => void; timer: number }[] = [];
  private lastReady: { url: string; title: string } | null = null;
  private closed = false;

  constructor(
    opts: ContextOptions,
    host: HTMLElement,
    private readonly timeouts: { navigation: number; action: number },
    isolation: FrameIsolation,
  ) {
    this.id = opts.contextId;
    const { width, height } = opts.device.viewport;
    const scale = Math.min(232 / width, 150 / height);

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'syntro-browser';
    const label = document.createElement('div');
    label.className = 'syntro-browser-label';
    label.innerHTML = `<strong></strong><span></span>`;
    (label.firstChild as HTMLElement).textContent = opts.label ?? opts.contextId;
    (label.lastChild as HTMLElement).textContent = `${opts.device.kind} · ${width}×${height}`;
    const screen = document.createElement('div');
    screen.className = 'syntro-browser-screen';
    this.iframe = document.createElement('iframe');
    if (isolation === 'opaque') {
      this.iframe.setAttribute('sandbox', 'allow-scripts allow-forms');
    } else {
      // Same-origin fallback: the harness confines all page state to this frame's window.name.
      this.iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
      this.iframe.name = JSON.stringify({ __syntro_frame: 'shared' });
    }
    this.iframe.setAttribute('title', `Synthetic browser ${opts.label ?? opts.contextId}`);
    this.iframe.width = String(width);
    this.iframe.height = String(height);
    this.iframe.style.width = `${width}px`;
    this.iframe.style.height = `${height}px`;
    this.iframe.style.transform = `scale(${scale})`;
    screen.appendChild(this.iframe);
    this.wrapper.appendChild(label);
    this.wrapper.appendChild(screen);
    host.appendChild(this.wrapper);
    window.addEventListener('message', this.onMessage);
    browserHost.register({ id: this.id, label: opts.label ?? opts.contextId, device: opts.device, url: 'about:blank', status: 'open' }, this.iframe.contentWindow);
  }

  private onMessage = (ev: MessageEvent) => {
    if (ev.source !== this.iframe.contentWindow) return;
    const msg = ev.data as { __syntroAgent?: boolean; kind?: string; id?: string; ok?: boolean; result?: unknown; error?: string; url?: string; title?: string };
    if (!msg || msg.__syntroAgent !== true) return;
    if (msg.kind === 'ready') {
      this.lastReady = { url: msg.url ?? '', title: msg.title ?? '' };
      browserHost.update(this.id, { url: msg.url ?? '' });
      const waiters = this.readyWaiters;
      this.readyWaiters = [];
      for (const w of waiters) {
        clearTimeout(w.timer);
        w.resolve();
      }
      return;
    }
    if (msg.kind === 'result' && msg.id) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new DriverError(msg.error ?? 'Agent error', 'op'));
    }
  };

  private waitForReady(timeoutMs: number, label: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((w) => w.timer !== timer);
        reject(new DriverError(`Timed out after ${timeoutMs}ms waiting for page load (${label})`, 'navigation'));
      }, timeoutMs);
      this.readyWaiters.push({ resolve, reject, timer });
    });
  }

  private send<T = unknown>(op: string, params: Record<string, unknown> = {}, timeoutMs = this.timeouts.action): Promise<T> {
    if (this.closed) return Promise.reject(new DriverError('Context is closed', op));
    const id = randomId('op');
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new DriverError(`${op} timed out after ${timeoutMs}ms${params.selector ? ` (${params.selector})` : ''}`, op, params.selector as string | undefined));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.iframe.contentWindow?.postMessage({ __syntroDrive: true, id, op, ...params }, '*');
    });
  }

  async goto(url: string, opts: { timeoutMs?: number } = {}): Promise<void> {
    const ready = this.waitForReady(opts.timeoutMs ?? this.timeouts.navigation, url);
    this.iframe.src = url;
    await ready;
  }

  async click(selector: string, opts: { expectNavigation?: boolean; timeoutMs?: number } = {}): Promise<void> {
    if (!opts.expectNavigation) {
      await this.send('click', { selector });
      return;
    }
    const timeout = opts.timeoutMs ?? this.timeouts.navigation;
    const ready = this.waitForReady(timeout, `after click ${selector}`);
    const clickP = this.send('click', { selector }, timeout);
    // The page unloads right after the click, so the reply may never arrive: the new document's
    // ready signal is the success condition; an explicit agent error is the failure condition.
    await Promise.race([clickP.then(() => ready), ready]);
    clickP.catch(() => undefined);
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.send('fill', { selector, value });
  }

  async waitForSelector(selector: string, opts: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? this.timeouts.action;
    await this.send('waitFor', { selector, timeoutMs }, timeoutMs + 500);
  }

  url(): Promise<string> {
    return this.send<string>('url');
  }

  title(): Promise<string> {
    return this.send<string>('title');
  }

  text(selector: string): Promise<string | null> {
    return this.send<string | null>('text', { selector });
  }

  readGlobal(path: string): Promise<unknown> {
    return this.send('readGlobal', { path });
  }

  async clearStorage(): Promise<void> {
    await this.send('clearStorage');
  }

  async reload(): Promise<void> {
    const ready = this.waitForReady(this.timeouts.navigation, 'reload');
    await this.send('reload');
    await ready;
  }

  async snapshot(): Promise<PageSnapshot> {
    try {
      const snap = await this.send<{ url: string; title: string; text: string }>('snapshot');
      return { ...snap, ts: new Date().toISOString() };
    } catch {
      return { url: this.lastReady?.url ?? '', title: this.lastReady?.title ?? '', ts: new Date().toISOString() };
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('message', this.onMessage);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new DriverError('Context closed', 'close'));
    }
    this.pending.clear();
    browserHost.unregister(this.id, this.iframe.contentWindow);
    this.wrapper.classList.add('closed');
    // Keep the final page visible briefly so the live view reads naturally, then remove.
    window.setTimeout(() => this.wrapper.remove(), 1500);
  }
}
