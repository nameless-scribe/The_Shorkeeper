import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument, rgb, StandardFonts, type PDFPage } from 'pdf-lib';
import { convertToMarkdownTool } from '../convert-markdown';
import { PDF_NO_TEXT_LAYER_MESSAGE } from '../../../rag/format-converters';

const PDF_TIMEOUT_MS = 30_000;

function context(root: string) {
  return { sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal };
}

/** 用 pdf-lib 现生成样本：Helvetica 只能画英文，但足以验证文字层与分页。 */
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

interface GridOptions {
  /** 'fill' 用底色画格子（WPS 导出的样子），'stroke' 用边框线 */
  style: 'fill' | 'stroke';
  columns: number[];
  rowHeight: number;
  top: number;
  left: number;
}

/** 在页面上画一个网格并把文字放进格子；返回每个格子的左下角，供测试再放图片。 */
function drawGrid(page: PDFPage, font: Awaited<ReturnType<PDFDocument['embedFont']>>, cells: string[][], options: GridOptions) {
  const boxes: Array<Array<{ x: number; y: number; width: number; height: number }>> = [];
  let y = options.top;
  for (const row of cells) {
    y -= options.rowHeight;
    let x = options.left;
    const rowBoxes = [];
    for (let c = 0; c < options.columns.length; c += 1) {
      const width = options.columns[c];
      const box = { x, y, width, height: options.rowHeight };
      if (options.style === 'fill') {
        page.drawRectangle({ ...box, color: c % 2 ? rgb(0.9, 0.9, 1) : rgb(1, 0.95, 0.9) });
      } else {
        page.drawRectangle({ ...box, borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 1 });
      }
      const lines = (row[c] ?? '').split('\n');
      lines.forEach((line, index) => {
        page.drawText(line, { x: x + 6, y: y + options.rowHeight - 16 - index * 14, size: 11, font });
      });
      rowBoxes.push(box);
      x += width;
    }
    boxes.push(rowBoxes);
  }
  return boxes;
}

const TABLE_CELLS = [
  ['Item', 'Brand', 'Range'],
  ['Coordinate\nmeasuring machine', 'Mitutoyo', '700*1000*600'],
  ['Tool microscope', 'KEYENCE', 'range 225*125\naccuracy 0.5um'],
];

async function writeTablePdf(file: string, style: 'fill' | 'stroke', pngBytes?: Uint8Array): Promise<void> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText('Equipment list of the workshop', { x: 60, y: 790, size: 16, font });
  const boxes = drawGrid(page, font, TABLE_CELLS, { style, columns: [180, 120, 180], rowHeight: 44, top: 740, left: 60 });
  page.drawText('Prepared by the quality team', { x: 60, y: 520, size: 11, font });
  if (pngBytes) {
    const image = await pdf.embedPng(pngBytes);
    // 一张放在第二行第一格里，一张放在表格下面的自由区域
    const cell = boxes[1][0];
    page.drawImage(image, { x: cell.x + 100, y: cell.y + 4, width: 60, height: 36 });
    page.drawImage(image, { x: 60, y: 380, width: 200, height: 120 });
  }
  await fs.writeFile(file, await pdf.save());
}

async function makePng(width = 120, height = 72): Promise<Uint8Array> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#c0392b';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#2980b9';
  context.fillRect(Math.round(width / 6), Math.round(height / 4), Math.round(width / 2), Math.round(height / 2.4));
  return new Uint8Array(canvas.toBuffer('image/png'));
}

async function imageSize(file: string): Promise<{ width: number; height: number }> {
  const { loadImage } = await import('@napi-rs/canvas');
  const image = await loadImage(file);
  return { width: image.width, height: image.height };
}

/** 扫描件：整页就是一张图，没有任何文字 */
async function writeScannedPdf(file: string, pngBytes: Uint8Array, pages: number): Promise<void> {
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(pngBytes);
  for (let i = 0; i < pages; i += 1) {
    const page = pdf.addPage([595, 842]);
    page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  }
  await fs.writeFile(file, await pdf.save());
}

describe('convert_to_markdown with PDF', () => {
  it(
    'extracts the text layer page by page and marks each page',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-pdf-read-'));
      await writeTextPdf(path.join(root, 'brief.pdf'), [
        ['Quarterly brief for the team', 'Revenue grew twelve percent'],
        ['Second page starts here', 'Headcount stayed flat'],
      ]);

      const result = await convertToMarkdownTool.execute({ source_path: 'brief.pdf' }, context(root));
      expect(result.success).toBe(true);
      expect(result.artifacts?.[0]?.relativePath).toBe('brief.md');
      expect(result.output).toContain('2 页');
      expect(result.metadata).toMatchObject({ pages: 2, tables: 0, imagesExtracted: 0 });

      const markdown = await fs.readFile(path.join(root, 'brief.md'), 'utf-8');
      expect(markdown.startsWith('# brief\n')).toBe(true);
      expect(markdown).toContain('<!-- page 1 -->');
      expect(markdown).toContain('<!-- page 2 -->');
      expect(markdown).toContain('Quarterly brief for the team');
      expect(markdown).toContain('Second page starts here');
      expect(markdown.indexOf('<!-- page 1 -->')).toBeLessThan(markdown.indexOf('Revenue grew'));
      expect(markdown.indexOf('Revenue grew')).toBeLessThan(markdown.indexOf('<!-- page 2 -->'));
      // 没有图片就不建 .assets 目录
      await expect(fs.readdir(root)).resolves.toEqual(['brief.md', 'brief.pdf']);
    },
    PDF_TIMEOUT_MS,
  );

  it(
    'reports a PDF with neither text nor images instead of writing an empty file',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-pdf-scan-'));
      await writeTextPdf(path.join(root, 'scan.pdf'), [[], []]);

      const result = await convertToMarkdownTool.execute({ source_path: 'scan.pdf' }, context(root));
      expect(result.success).toBe(false);
      expect(result.error).toBe(PDF_NO_TEXT_LAYER_MESSAGE);
      await expect(fs.readdir(root)).resolves.toEqual(['scan.pdf']);
    },
    PDF_TIMEOUT_MS,
  );

  it(
    'keeps scanned pages as full-resolution images and says plainly that no text was recognised',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-pdf-scanimg-'));
      // 整页一张高于旧上限（1280）的图，必须原样保留；尺寸取 1600×1200 是为了让样本编解码在并发跑测试时也够快
      await writeScannedPdf(path.join(root, 'drawings.pdf'), await makePng(1600, 1200), 2);

      const result = await convertToMarkdownTool.execute({ source_path: 'drawings.pdf' }, context(root));
      expect(result.success).toBe(true);
      expect(result.output).toContain('没有文字层');
      expect(result.output).toContain('抽出 2 张图片');
      expect(result.metadata).toMatchObject({ textLayer: false, imagesExtracted: 2 });

      const markdown = await fs.readFile(path.join(root, 'drawings.md'), 'utf-8');
      expect(markdown).toContain('未支持 OCR，未能识别文字');
      expect(markdown).toContain('<!-- page 1 -->\n\n![第 1 页图 1](drawings.assets/p1-1.jpg)');
      expect(markdown).toContain('<!-- page 2 -->\n\n![第 2 页图 1](drawings.assets/p2-1.jpg)');
      await expect(imageSize(path.join(root, 'drawings.assets', 'p1-1.jpg'))).resolves.toEqual({ width: 1600, height: 1200 });
    },
    PDF_TIMEOUT_MS * 2,
  );

  it.each(['fill', 'stroke'] as const)(
    'rebuilds a %s-drawn table into a Markdown table and keeps surrounding text in order',
    async (style) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `sk-pdf-table-${style}-`));
      await writeTablePdf(path.join(root, 'list.pdf'), style);

      const result = await convertToMarkdownTool.execute({ source_path: 'list.pdf' }, context(root));
      expect(result.success).toBe(true);
      expect(result.metadata).toMatchObject({ tables: 1 });

      const markdown = await fs.readFile(path.join(root, 'list.md'), 'utf-8');
      expect(markdown).toContain('| Item | Brand | Range |');
      expect(markdown).toContain('| --- | --- | --- |');
      // 格内换行保留为 <br>，不会被拆成新行
      expect(markdown).toContain('| Coordinate<br>measuring machine | Mitutoyo | 700*1000*600 |');
      expect(markdown).toContain('| Tool microscope | KEYENCE | range 225*125<br>accuracy 0.5um |');
      // 表格前后的自由文本按位置排序
      expect(markdown.indexOf('Equipment list of the workshop')).toBeLessThan(markdown.indexOf('| Item |'));
      expect(markdown.indexOf('| Tool microscope')).toBeLessThan(markdown.indexOf('Prepared by the quality team'));
    },
    PDF_TIMEOUT_MS,
  );

  it(
    'extracts images into a sibling .assets folder and references them from cells and free text',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-pdf-img-'));
      await fs.mkdir(path.join(root, 'docs'));
      await writeTablePdf(path.join(root, 'docs', 'photos.pdf'), 'fill', await makePng());

      const result = await convertToMarkdownTool.execute({ source_path: 'docs/photos.pdf' }, context(root));
      expect(result.success).toBe(true);
      expect(result.metadata).toMatchObject({ tables: 1, imagesExtracted: 2, imagesFailed: 0, assetsDir: 'docs/photos.assets' });
      expect(result.output).toContain('抽出 2 张图片到 docs/photos.assets/');

      const markdown = await fs.readFile(path.join(root, 'docs', 'photos.md'), 'utf-8');
      expect(markdown).toContain('| ![第 1 页图 1](photos.assets/p1-1.jpg) Coordinate<br>measuring machine | Mitutoyo | 700*1000*600 |');
      expect(markdown).toContain('![第 1 页图 2](photos.assets/p1-2.jpg)');
      expect(markdown.indexOf('Prepared by the quality team')).toBeLessThan(markdown.indexOf('![第 1 页图 2]'));

      const assets = await fs.readdir(path.join(root, 'docs', 'photos.assets'));
      expect(assets.sort()).toEqual(['p1-1.jpg', 'p1-2.jpg']);
      const jpeg = await fs.readFile(path.join(root, 'docs', 'photos.assets', 'p1-2.jpg'));
      expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      expect(jpeg.length).toBeGreaterThan(500);
    },
    PDF_TIMEOUT_MS,
  );

  it('still rejects formats outside the whitelist and names PDF in the hint', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-pdf-ext-'));
    const result = await convertToMarkdownTool.execute({ source_path: 'deck.pptx' }, context(root));
    expect(result.success).toBe(false);
    expect(result.error).toContain('.pdf');
  });
});
