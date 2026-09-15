/**
 * PDF 渲染器注入点（P5.0）。
 *
 * `src/tools` 不能引用 Electron，与权限确认（`setPermissionConfirmer`）同一做法：
 * 主进程在启动时用 `electron/print/markdown-to-pdf.ts` 注入 `printToPDF` 实现；
 * 测试注入假实现；没有注入时 fail closed，不退回到只会画英文的 pdf-lib。
 */

export interface PdfRenderRequest {
  /** 完整 HTML 文档字符串，内容已转义、不含脚本。 */
  html: string;
  /** 用于日志与窗口标题，不参与渲染。 */
  title: string;
}

export type PdfRenderer = (request: PdfRenderRequest, signal?: AbortSignal) => Promise<Uint8Array>;

/** 渲染总超时：隐藏窗口加载 + 打印。超过即销毁窗口并报错。 */
export const PDF_RENDER_TIMEOUT_MS = 30_000;
/** 单次渲染的 HTML 上限：data: URL 在 Chromium 里有 2MB 级上限，正文超限应让调用方分文件。 */
export const MAX_PDF_HTML_CHARS = 600_000;

const PDF_MAGIC = '%PDF';

let renderer: PdfRenderer | null = null;

export function setPdfRenderer(next: PdfRenderer | null): void {
  renderer = next;
}

export function hasPdfRenderer(): boolean {
  return renderer !== null;
}

export function isPdfBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_MAGIC.length) return false;
  for (let i = 0; i < PDF_MAGIC.length; i += 1) {
    if (bytes[i] !== PDF_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

export async function renderHtmlToPdf(request: PdfRenderRequest, signal?: AbortSignal): Promise<Uint8Array> {
  if (!renderer) {
    throw new Error('PDF 渲染器未就绪：当前运行环境没有注入 printToPDF 实现，无法生成 PDF');
  }
  if (request.html.length > MAX_PDF_HTML_CHARS) {
    throw new Error(`文档过长（${request.html.length} 字符，上限 ${MAX_PDF_HTML_CHARS}），请拆成多个文件生成`);
  }
  if (signal?.aborted) {
    throw new Error('PDF 生成已取消');
  }
  const bytes = await renderer(request, signal);
  if (!isPdfBytes(bytes)) {
    throw new Error('PDF 渲染结果无效：输出不是 PDF 文件');
  }
  return bytes;
}
