/**
 * `gen_pdf` 的主进程实现（P5.0）：隐藏 BrowserWindow 加载本地 HTML，`printToPDF` 输出。
 *
 * 安全约束（硬要求）：文档内容来自模型，窗口 `javascript: false`、沙箱、独立内存 session，
 * 且该 session 拦截一切非 data: 请求——即便 HTML 里混进了外链也发不出去。
 * 生命周期：用完即销毁；超时或取消时主动销毁窗口，让挂起的 loadURL / printToPDF 以错误结束；
 * 应用退出时 `shutdownPdfPrintRuntime()` 兜底销毁所有打印窗口。
 */

import { BrowserWindow, session, type PrintToPDFOptions } from 'electron';
import {
  PDF_RENDER_TIMEOUT_MS,
  setPdfRenderer,
  type PdfRenderRequest,
} from '../../src/documents/pdf-renderer';

/** 不带 persist: 前缀即内存 session，退出即清空，不与主窗口共享缓存与 cookie。 */
const PRINT_PARTITION = 'shorekeeper-print';

const cmToInches = (cm: number): number => Number((cm / 2.54).toFixed(3));

/** A4、打印背景色、页边距上下 1.5cm / 左右 1.6cm（Electron 的 margins 以英寸计）。 */
export const PDF_PRINT_OPTIONS: PrintToPDFOptions = {
  pageSize: 'A4',
  printBackground: true,
  preferCSSPageSize: false,
  margins: {
    top: cmToInches(1.5),
    bottom: cmToInches(1.5),
    left: cmToInches(1.6),
    right: cmToInches(1.6),
  },
};

const activeWindows = new Set<BrowserWindow>();

/**
 * 只拦带 scheme://host 的请求（http、https、ws、file、ftp…）。
 * 不能不带过滤器全拦：webRequest 一旦介入 data: 主框架导航，即便 callback 放行，
 * Chromium 也会以 ERR_FAILED 结束加载（实测 Electron 44）。data: 本身不出网，无需拦。
 */
const OUTBOUND_URL_FILTER = { urls: ['*://*/*'] };

function preparePrintSession(): Electron.Session {
  const ses = session.fromPartition(PRINT_PARTITION);
  // 同一 session 重复设置只会替换监听器，多次调用是幂等的
  ses.webRequest.onBeforeRequest(OUTBOUND_URL_FILTER, (_details, callback) => {
    callback({ cancel: true });
  });
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  return ses;
}

export async function renderHtmlToPdfWithElectron(
  request: PdfRenderRequest,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const win = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    title: `打印：${request.title}`,
    webPreferences: {
      session: preparePrintSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  activeWindows.add(win);

  let failure: Error | null = null;
  const fail = (reason: Error) => {
    if (!failure) failure = reason;
    if (!win.isDestroyed()) win.destroy();
  };
  const onAbort = () => fail(new Error('PDF 生成已取消'));
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(
    () => fail(new Error(`PDF 生成超时（${PDF_RENDER_TIMEOUT_MS / 1000} 秒），已放弃`)),
    PDF_RENDER_TIMEOUT_MS,
  );

  try {
    const dataUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(request.html, 'utf-8').toString('base64')}`;
    await win.loadURL(dataUrl);
    if (win.isDestroyed()) throw failure ?? new Error('打印窗口已关闭');
    const buffer = await win.webContents.printToPDF(PDF_PRINT_OPTIONS);
    return new Uint8Array(buffer);
  } catch (error) {
    if (failure) throw failure;
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    activeWindows.delete(win);
    if (!win.isDestroyed()) win.destroy();
  }
}

/** 启动时注入：`gen_pdf` 之后即通过 Electron 渲染。 */
export function installElectronPdfRenderer(): void {
  setPdfRenderer(renderHtmlToPdfWithElectron);
}

/** 退出时兜底：销毁仍在打印的隐藏窗口，让对应的 gen_pdf 调用以错误结束。 */
export function shutdownPdfPrintRuntime(): number {
  const count = activeWindows.size;
  for (const win of activeWindows) {
    if (!win.isDestroyed()) win.destroy();
  }
  activeWindows.clear();
  setPdfRenderer(null);
  return count;
}
