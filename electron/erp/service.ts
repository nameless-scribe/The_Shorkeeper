import { resolveErpSettings } from '../../src/config/erp';
import { ErpReadClient, PlaywrightErpApiTransport, type ErpReadContext } from '../../src/erp/read-client';
import type { ErpConnectionInfo } from '../../src/shared/types';
import { setErpRuntime, type ErpSubmitDispatchResult, type ErpTimeEntryInput } from '../../src/erp/runtime';
import { ErpBrowserRuntime } from './browser-runtime';
import { cancelErpTimeEntryForm, closeErpTimeEntryList, ErpTimeEntrySubmissionError, openAndFillErpTimeEntryForm, submitFilledErpTimeEntryForm } from './taskboard-adapter';
import { tryAutomatedErpLogin } from './login-automation';

export class ErpConnectionService {
  private runtime: ErpBrowserRuntime | null = null;
  private connection: ErpConnectionInfo = {
    state: 'disconnected', origin: null, browserChannel: null, pageUrl: null,
    userId: null, userName: null, message: 'ERP 浏览器未连接',
  };

  constructor(private readonly userDataRoot: string) {}

  status(): ErpConnectionInfo { return { ...this.connection }; }

  async connect(): Promise<ErpConnectionInfo> {
    const settings = resolveErpSettings();
    if (!settings.enabled) throw new Error('ERP 报工功能尚未开启');
    if (!settings.origin) throw new Error('请先配置 ERP 站点地址');
    if (!this.runtime) this.runtime = new ErpBrowserRuntime({ userDataRoot: this.userDataRoot, channel: settings.browserChannel });
    const session = await this.runtime.connect(settings.origin);
    const loginResult = await this.runtime.runExclusive(async (page) => {
      if (!page.url().startsWith(`${settings.origin}/login`)) return;
      const username = page.getByPlaceholder('账号');
      const password = page.getByPlaceholder('密码');
      if (settings.username && await username.count() === 1) await username.fill(settings.username);
      if (settings.password && await password.count() === 1) await password.fill(settings.password);
      if (settings.username && settings.password) return tryAutomatedErpLogin(page);
      return undefined;
    });
    this.connection = {
      state: 'browser_open', origin: settings.origin, browserChannel: settings.browserChannel, pageUrl: session.pageUrl,
      userId: null, userName: null, message: loginResult?.message ?? (settings.password
        ? '账号密码已代填；请核对验证码并登录，然后点击“检测登录”'
        : '专用浏览器已打开；请完成登录后点击“检测登录”'),
    };
    const refreshed = await this.refresh();
    if (refreshed.state !== 'authenticated' && loginResult?.message) {
      this.connection = { ...this.connection, message: loginResult.message };
    }
    return this.status();
  }

  async refresh(): Promise<ErpConnectionInfo> {
    if (!this.runtime || !this.connection.origin) return this.status();
    const settings = resolveErpSettings();
    try {
      const result = await this.runtime.runExclusive(async (page) => {
        const identity = await new ErpReadClient(new PlaywrightErpApiTransport(page, this.connection.origin!, settings.apiPrefix)).getIdentity();
        return { identity, pageUrl: page.url() };
      });
      this.connection = {
        ...this.connection, state: 'authenticated', pageUrl: result.pageUrl,
        userId: result.identity.userId, userName: result.identity.userName,
        message: `已登录：${result.identity.userName}`,
      };
    } catch (error) {
      this.connection = {
        ...this.connection, state: 'browser_open', userId: null, userName: null,
        message: error instanceof Error ? error.message : '尚未检测到有效 ERP 登录',
      };
    }
    return this.status();
  }

  async bringToFront(): Promise<ErpConnectionInfo> {
    if (!this.runtime) return this.connect();
    await this.runtime.bringToFront();
    return this.status();
  }

  async readContext(workDate: string): Promise<ErpReadContext> {
    if (!this.runtime || this.connection.state !== 'authenticated' || !this.connection.origin) {
      throw new Error('ERP 尚未登录');
    }
    const settings = resolveErpSettings();
    return this.runtime.runExclusive(async (page) => {
      const context = await new ErpReadClient(new PlaywrightErpApiTransport(page, this.connection.origin!, settings.apiPrefix)).readContext(workDate);
      if (context.identity.userId !== this.connection.userId) throw new Error('ERP 登录身份已变化，请重新确认');
      return context;
    });
  }

  async submitTimeEntry(input: ErpTimeEntryInput, signal?: AbortSignal): Promise<ErpSubmitDispatchResult> {
    if (!this.runtime || this.connection.state !== 'authenticated' || !this.connection.origin) {
      throw new Error('ERP 尚未登录');
    }
    if (input.origin !== this.connection.origin) throw new Error('ERP 报工站点与当前连接不一致');
    return this.runtime.runExclusive(async (page) => {
      try {
        if (signal?.aborted) return { status: 'known_not_written', message: '提交已取消' };
        if (!page.url().startsWith(`${input.origin}/taskboard/index`)) {
          await page.goto(`${input.origin}/taskboard/index`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        }
        await page.locator(`[data-task-block="${input.taskId}"]`).waitFor({ state: 'visible', timeout: 20_000 });
        await openAndFillErpTimeEntryForm(page, input);
        if (signal?.aborted) {
          await cancelErpTimeEntryForm(page);
          return { status: 'known_not_written', message: '提交已取消' };
        }
        await submitFilledErpTimeEntryForm(page, input.origin);
        await closeErpTimeEntryList(page);
        return { status: 'accepted' };
      } catch (error) {
        return {
          status: error instanceof ErpTimeEntrySubmissionError && error.dispatched ? 'outcome_unknown' : 'known_not_written',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  async disconnect(): Promise<ErpConnectionInfo> {
    const runtime = this.runtime;
    this.runtime = null;
    if (runtime) await runtime.close();
    this.connection = {
      state: 'disconnected', origin: null, browserChannel: null, pageUrl: null,
      userId: null, userName: null, message: 'ERP 浏览器未连接',
    };
    return this.status();
  }
}

let service: ErpConnectionService | null = null;

export function configureErpConnectionService(userDataRoot: string): ErpConnectionService {
  service = new ErpConnectionService(userDataRoot);
  setErpRuntime(service);
  return service;
}

export function getErpConnectionService(): ErpConnectionService {
  if (!service) throw new Error('ERP 连接服务尚未初始化');
  return service;
}

export async function shutdownErpConnectionService(): Promise<void> {
  const current = service;
  service = null;
  setErpRuntime(null);
  if (current) await current.disconnect();
}
