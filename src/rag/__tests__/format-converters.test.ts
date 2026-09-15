import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  convertPdfToMarkdown,
  convertPdfToMarkdownDocument,
  extractPdfDocument,
  PDF_NO_TEXT_LAYER_MESSAGE,
} from '../format-converters';

const PDF_TIMEOUT_MS = 30_000;
const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-pdf-conv-'));
  temporaryDirs.push(dir);
  return dir;
}

/** 用 pdf-lib 现生成样本：Helvetica 只能画英文，足以验证分页与文字层判断。 */
async function writeTextPdf(file: string, pages: string[][]): Promise<void> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = pdf.addPage([595, 842]);
    let y = 780;
    for (const line of lines) {
      page.drawText(line, { x: 60, y, size: 14, font });
      y -= 24;
    }
  }
  await fs.writeFile(file, await pdf.save());
}

describe('PDF → Markdown (text pages)', () => {
  it(
    'joins pages without markers for knowledge import by default',
    async () => {
      const dir = await tempDir();
      const file = path.join(dir, 'k.pdf');
      await writeTextPdf(file, [['First page sentence for the knowledge base'], ['Second page sentence for retrieval']]);

      const markdown = await convertPdfToMarkdown(file, '知识');
      expect(markdown).toBe('# 知识\n\nFirst page sentence for the knowledge base\n\nSecond page sentence for retrieval\n');
    },
    PDF_TIMEOUT_MS,
  );

  it(
    'inserts a page marker before every page when asked, including empty pages',
    async () => {
      const dir = await tempDir();
      const file = path.join(dir, 'm.pdf');
      await writeTextPdf(file, [['Only the first page carries text here'], [], ['Last page']]);

      const result = await convertPdfToMarkdownDocument(file, '回指', { pageMarkers: true });
      expect(result.total).toBe(3);
      expect(result.tables).toBe(0);
      expect(result.images).toEqual({ extracted: 0, failed: 0 });
      expect(result.markdown).toBe(
        '# 回指\n\n<!-- page 1 -->\n\nOnly the first page carries text here\n\n<!-- page 2 -->\n\n<!-- page 3 -->\n\nLast page\n',
      );
    },
    PDF_TIMEOUT_MS,
  );

  it(
    'rejects a PDF without a text layer instead of returning an empty document',
    async () => {
      const dir = await tempDir();
      const file = path.join(dir, 'scan.pdf');
      await writeTextPdf(file, [[], []]);

      await expect(convertPdfToMarkdown(file, '扫描件')).rejects.toThrow(PDF_NO_TEXT_LAYER_MESSAGE);
    },
    PDF_TIMEOUT_MS,
  );

  it(
    'wraps parser failures with a stable prefix',
    async () => {
      const dir = await tempDir();
      const file = path.join(dir, 'broken.pdf');
      await fs.writeFile(file, 'not a pdf at all');

      await expect(extractPdfDocument(file)).rejects.toThrow(/^PDF 文本提取失败：/);
    },
    PDF_TIMEOUT_MS,
  );

  it(
    'stops early when the signal is already aborted',
    async () => {
      const dir = await tempDir();
      const file = path.join(dir, 'abort.pdf');
      await writeTextPdf(file, [['Some text that would otherwise be extracted']]);
      const controller = new AbortController();
      controller.abort();

      await expect(extractPdfDocument(file, { signal: controller.signal })).rejects.toThrow('PDF 转换已取消');
    },
    PDF_TIMEOUT_MS,
  );
});
