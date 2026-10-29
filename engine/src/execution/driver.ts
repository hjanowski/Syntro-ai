import type { DeviceProfile } from '../domain/types.ts';

/**
 * Browser automation abstraction used by the journey executor.
 *
 * Implementations:
 *  - PlaywrightDriver (server/src/drivers/playwright-driver.ts): real headless Chromium,
 *    one isolated BrowserContext per synthetic customer, real UA/viewport emulation, screenshots.
 *  - IframeDriver (app/src/engine/iframe-driver.ts): browser-hosted mode for the static
 *    GitHub Pages deployment; one sandboxed iframe (opaque origin ⇒ isolated storage) per
 *    customer, driven through a postMessage harness agent embedded in the demo pages.
 */
export interface ContextOptions {
  contextId: string;
  device: DeviceProfile;
  label?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** Visible text excerpt, for DOM-level evidence. */
  text?: string;
  /** JPEG data URL when the driver supports screenshots. */
  screenshot?: string;
  ts: string;
}

export interface BrowserContextHandle {
  readonly id: string;
  goto(url: string, opts?: { timeoutMs?: number }): Promise<void>;
  click(selector: string, opts?: { expectNavigation?: boolean; timeoutMs?: number }): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  waitForSelector(selector: string, opts?: { timeoutMs?: number }): Promise<void>;
  url(): Promise<string>;
  title(): Promise<string>;
  text(selector: string): Promise<string | null>;
  /** Read a global JS value from the page by dotted path, e.g. "__prodAnalytics.length". */
  readGlobal(path: string): Promise<unknown>;
  /** Clear first-party cookies and web storage (simulates cookie loss / fresh browser). */
  clearStorage(): Promise<void>;
  reload(): Promise<void>;
  snapshot(opts?: { screenshot?: boolean }): Promise<PageSnapshot>;
  close(): Promise<void>;
}

export interface DriverCapabilities {
  screenshots: boolean;
  /** Process-level isolation with real cookie jars (Playwright) vs sandboxed-iframe isolation. */
  realIsolation: boolean;
  /** Real user-agent/viewport emulation. */
  deviceEmulation: boolean;
}

export interface BrowserDriver {
  readonly name: string;
  readonly capabilities: DriverCapabilities;
  newContext(opts: ContextOptions): Promise<BrowserContextHandle>;
  dispose(): Promise<void>;
}

export class DriverError extends Error {
  constructor(
    message: string,
    public readonly op: string,
    public readonly selector?: string,
  ) {
    super(message);
  }
}
