import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { normalizeErpOrigin } from '../../src/erp/contracts';

export type ErpBrowserChannel = 'msedge' | 'chrome';
type PersistentContextOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

interface ChromiumLauncher {
  launchPersistentContext(userDataDir: string, options: PersistentContextOptions): Promise<BrowserContext>;
}

export interface ErpBrowserRuntimeOptions {
  userDataRoot: string;
  channel?: ErpBrowserChannel;
  launcher?: ChromiumLauncher;
}

export interface ErpBrowserSessionInfo {
  origin: string;
  channel: ErpBrowserChannel;
  profilePath: string;
  pageUrl: string;
}

export function erpBrowserProfilePath(userDataRoot: string, origin: string, channel: ErpBrowserChannel): string {
  const digest = createHash('sha256').update(`${channel}:${normalizeErpOrigin(origin)}`).digest('hex').slice(0, 24);
  return path.join(userDataRoot, 'erp-browser', `${channel}-${digest}`);
}

export function erpBrowserLaunchOptions(channel: ErpBrowserChannel): PersistentContextOptions {
  return { channel, headless: false, chromiumSandbox: true, acceptDownloads: false, viewport: null };
}

/** ERP 专用浏览器生命周期；业务点击由站点 adapter 完成。 */
export class ErpBrowserRuntime {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private origin: string | null = null;
  private active: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly channel: ErpBrowserChannel;
  private readonly launcher: ChromiumLauncher;

  constructor(private readonly options: ErpBrowserRuntimeOptions) {
    this.channel = options.channel ?? 'msedge';
    this.launcher = options.launcher ?? chromium;
  }

  async connect(originInput: string, signal?: AbortSignal): Promise<ErpBrowserSessionInfo> {
    if (this.closed) throw new Error('ERP 浏览器运行时已关闭');
    if (signal?.aborted) throw new Error('ERP 浏览器连接已取消');
    const origin = normalizeErpOrigin(originInput);
    if (this.context && this.origin !== origin) throw new Error('已有其他 ERP 站点占用当前浏览器会话');
    if (!this.context) {
      const profilePath = erpBrowserProfilePath(this.options.userDataRoot, origin, this.channel);
      this.context = await this.launcher.launchPersistentContext(profilePath, erpBrowserLaunchOptions(this.channel));
      this.origin = origin;
      this.context.once('close', () => {
        this.context = null; this.page = null; this.origin = null;
      });
    }
    const pages = this.context.pages();
    this.page = this.page && !this.page.isClosed() ? this.page : pages.find((item) => !item.isClosed()) ?? await this.context.newPage();
    const currentUrl = this.page.url();
    if (!currentUrl || currentUrl === 'about:blank' || new URL(currentUrl).origin !== origin) {
      await this.page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    await this.page.bringToFront();
    return { origin, channel: this.channel, profilePath: erpBrowserProfilePath(this.options.userDataRoot, origin, this.channel), pageUrl: this.page.url() };
  }

  async runExclusive<T>(operation: (page: Page, context: BrowserContext) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.active;
    this.active = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (!this.context || !this.page || this.page.isClosed()) throw new Error('ERP 浏览器尚未连接');
      return await operation(this.page, this.context);
    } finally {
      release();
    }
  }

  async bringToFront(): Promise<void> {
    if (!this.page || this.page.isClosed()) throw new Error('ERP 浏览器尚未连接');
    await this.page.bringToFront();
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.active;
    const context = this.context;
    this.context = null; this.page = null; this.origin = null;
    if (context) await context.close();
  }
}
