import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { genPdfTool, MAX_PDF_BODY_CHARS } from '../gen-tools';
import {
  MAX_PDF_HTML_CHARS,
  renderHtmlToPdf,
  setPdfRenderer,
  type PdfRenderRequest,
} from '../../../documents/pdf-renderer';

const FAKE_PDF = Buffer.from('%PDF-1.7\n%fake\n%%EOF\n');

function context(root: string, signal = new AbortController().signal) {
  return { sessionId: 's1', workspaceRoot: root, signal };
}

afterEach(() => {
  setPdfRenderer(null);
});

describe('gen_pdf via injected renderer', () => {
  it('fails closed when no renderer has been injected', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-pdf-'));
    const result = await genPdfTool.execute({ path: 'a.pdf', title: 't', body: '正文' }, context(root));
    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('internal_error');
    expect(result.error).toContain('PDF 渲染器未就绪');
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('renders markdown to escaped HTML, hands it to the renderer and writes the bytes atomically', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-pdf-'));
    const requests: PdfRenderRequest[] = [];
    setPdfRenderer(async (request) => {
      requests.push(request);
      return new Uint8Array(FAKE_PDF);
    });

    const result = await genPdfTool.execute(
      {
        path: 'reports/季度.pdf',
        title: '季度<总结>',
        body: '## 收入\n\n| 项目 | 金额 |\n| --- | --- |\n| 甲 | 1 |\n\n- **要点** & 备注',
      },
      context(root),
    );

    expect(result.success).toBe(true);
    expect(result.artifacts?.[0]?.relativePath).toBe('reports/季度.pdf');
    expect(requests).toHaveLength(1);
    expect(requests[0].title).toBe('季度<总结>');
    expect(requests[0].html).toContain('<h1 class="doc-title">季度&lt;总结&gt;</h1>');
    expect(requests[0].html).toContain('<h2>收入</h2>');
    expect(requests[0].html).toContain('<td>甲</td>');
    expect(requests[0].html).toContain('<li><strong>要点</strong> &amp; 备注</li>');
    await expect(fs.readFile(path.join(root, 'reports/季度.pdf'))).resolves.toEqual(FAKE_PDF);
  });

  it('rejects bad arguments before touching the renderer', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-pdf-'));
    const renderer = vi.fn(async () => new Uint8Array(FAKE_PDF));
    setPdfRenderer(renderer);

    const notPdf = await genPdfTool.execute({ path: 'a.txt', title: 't', body: 'x' }, context(root));
    expect(notPdf).toMatchObject({ success: false, errorCategory: 'invalid_arguments' });
    expect(notPdf.error).toContain('.pdf');

    const tooLong = await genPdfTool.execute(
      { path: 'a.pdf', title: 't', body: 'x'.repeat(MAX_PDF_BODY_CHARS + 1) },
      context(root),
    );
    expect(tooLong).toMatchObject({ success: false, errorCategory: 'invalid_arguments' });
    expect(tooLong.error).toContain('正文过长');

    expect(renderer).not.toHaveBeenCalled();
  });

  it('does not leave a file behind when the renderer fails or returns something that is not a PDF', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-pdf-'));
    setPdfRenderer(async () => {
      throw new Error('printToPDF 超时');
    });
    const failed = await genPdfTool.execute({ path: 'a.pdf', title: 't', body: 'x' }, context(root));
    expect(failed.success).toBe(false);
    expect(failed.error).toContain('printToPDF 超时');

    setPdfRenderer(async () => new Uint8Array(Buffer.from('<html>not a pdf</html>')));
    const invalid = await genPdfTool.execute({ path: 'b.pdf', title: 't', body: 'x' }, context(root));
    expect(invalid.success).toBe(false);
    expect(invalid.error).toContain('不是 PDF 文件');

    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('refuses to start when the run has already been cancelled', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-pdf-'));
    const renderer = vi.fn(async () => new Uint8Array(FAKE_PDF));
    setPdfRenderer(renderer);
    const controller = new AbortController();
    controller.abort();

    const result = await genPdfTool.execute({ path: 'a.pdf', title: 't', body: 'x' }, context(root, controller.signal));
    expect(result.success).toBe(false);
    expect(result.error).toContain('已取消');
    expect(renderer).not.toHaveBeenCalled();
  });
});

describe('renderHtmlToPdf guard rails', () => {
  it('caps the HTML size before invoking the renderer', async () => {
    const renderer = vi.fn(async () => new Uint8Array(FAKE_PDF));
    setPdfRenderer(renderer);
    await expect(renderHtmlToPdf({ html: 'x'.repeat(MAX_PDF_HTML_CHARS + 1), title: 't' })).rejects.toThrow('文档过长');
    expect(renderer).not.toHaveBeenCalled();
  });
});
