import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { BrowserContextHandle, BrowserDriver, ContextOptions, DriverCapabilities, PageSnapshot } from '@syntro/engine';
import { DriverError } from '@syntro/engine';

/**
 * Playwright execution worker: real headless Chromium, one isolated BrowserContext per
 * synthetic customer (own cookies, storage, user agent and viewport), JPEG screenshots as evidence.
 */
export class PlaywrightDriver implements BrowserDriver {
  readonly name = 'playwright-chromium';
  readonly capabilities: DriverCapabilities = { screenshots: true, realIsolation: true, deviceEmulation: true };

  private constructor(
    private readonly browser: Browser,
    private readonly opts: { screenshotQuality: number },
  ) {}

  static async launch(opts: { headless?: boolean; screenshotQuality?: number } = {}): Promise<PlaywrightDriver> {
    const browser = await chromium.launch({ headless: opts.headless ?? true });
    return new PlaywrightDriver(browser, { screenshotQuality: opts.screenshotQuality ?? 45 });
  }

  async newContext(options: ContextOptions): Promise<BrowserContextHandle> {
    const context = await this.browser.newContext({
      userAgent: options.device.userAgent,
      viewport: options.device.viewport,
      isMobile: options.device.kind === 'mobile',
      hasTouch: options.device.kind !== 'desktop',
      deviceScaleFactor: options.device.kind === 'desktop' ? 1 : 2,
      locale: 'en-US',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    return new PlaywrightContextHandle(options.contextId, context, page, this.opts.screenshotQuality);
  }

  async dispose(): Promise<void> {
    await this.browser.close();
  }
}

class PlaywrightContextHandle implements BrowserContextHandle {
  constructor(
    readonly id: string,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly screenshotQuality: number,
  ) {}

  async goto(url: string, opts: { timeoutMs?: number } = {}): Promise<void> {
    await this.page.goto(url, { waitUntil: 'load', timeout: opts.timeoutMs ?? 20_000 });
  }

  async click(selector: string, opts: { expectNavigation?: boolean; timeoutMs?: number } = {}): Promise<void> {
    const timeout = opts.timeoutMs ?? 10_000;
    try {
      if (opts.expectNavigation) {
        const before = this.page.url();
        await Promise.all([
          this.page.waitForURL((u) => u.toString() !== before, { timeout, waitUntil: 'load' }),
          this.page.click(selector, { timeout }),
        ]);
      } else {
        await this.page.click(selector, { timeout });
      }
    } catch (e) {
      throw new DriverError(`click ${selector} failed: ${(e as Error).message.split('\n')[0]}`, 'click', selector);
    }
  }

  async fill(selector: string, value: string): Promise<void> {
    try {
      await this.page.fill(selector, value);
    } catch (e) {
      throw new DriverError(`fill ${selector} failed: ${(e as Error).message.split('\n')[0]}`, 'fill', selector);
    }
  }

  async waitForSelector(selector: string, opts: { timeoutMs?: number } = {}): Promise<void> {
    try {
      await this.page.waitForSelector(selector, { state: 'visible', timeout: opts.timeoutMs ?? 10_000 });
    } catch (e) {
      throw new DriverError(`waitForSelector ${selector} failed: ${(e as Error).message.split('\n')[0]}`, 'waitForSelector', selector);
    }
  }

  async url(): Promise<string> {
    return this.page.url();
  }

  async title(): Promise<string> {
    return this.page.title();
  }

  async text(selector: string): Promise<string | null> {
    const el = await this.page.$(selector);
    if (!el) return null;
    const t = await el.textContent();
    return t?.trim() ?? null;
  }

  async readGlobal(path: string): Promise<unknown> {
    return this.page.evaluate((p: string) => {
      let cur: unknown = window as unknown;
      for (const key of p.split('.')) {
        if (cur == null) return undefined;
        cur = (cur as Record<string, unknown>)[key];
      }
      return cur;
    }, path);
  }

  async clearStorage(): Promise<void> {
    await this.context.clearCookies();
    await this.page
      .evaluate(() => {
        try {
          window.localStorage.clear();
          window.sessionStorage.clear();
        } catch {
          /* storage unavailable */
        }
        window.name = '';
      })
      .catch(() => undefined);
  }

  async reload(): Promise<void> {
    await this.page.reload({ waitUntil: 'load' });
  }

  async snapshot(opts: { screenshot?: boolean } = {}): Promise<PageSnapshot> {
    const [title, text] = await Promise.all([
      this.page.title().catch(() => ''),
      this.page.evaluate(() => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 600)).catch(() => ''),
    ]);
    let screenshot: string | undefined;
    if (opts.screenshot) {
      try {
        const buf = await this.page.screenshot({ type: 'jpeg', quality: this.screenshotQuality, fullPage: false });
        screenshot = `data:image/jpeg;base64,${buf.toString('base64')}`;
      } catch {
        screenshot = undefined;
      }
    }
    return { url: this.page.url(), title, text, screenshot, ts: new Date().toISOString() };
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}
