import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadMammoth, loadWordExtractor } from '../tools/doc/doc-loaders';

function ensureTitle(markdown: string, title: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return `# ${title}\n\n`;
  if (/^#\s/m.test(trimmed)) return `${trimmed}\n`;
  return `# ${title}\n\n${trimmed}\n`;
}

function plainTextToMarkdown(content: string, title: string): string {
  const trimmed = content.trim();
  if (!trimmed) return `# ${title}\n\n`;
  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return `# ${title}\n\n${paragraphs.join('\n\n')}\n`;
}

export async function convertDocxToMarkdown(
  absolutePath: string,
  title?: string,
): Promise<string> {
  const name = title ?? path.basename(absolutePath, path.extname(absolutePath));
  const mammoth = await loadMammoth();
  const result = await mammoth.extractRawText({ path: absolutePath });
  return plainTextToMarkdown(result.value, name);
}

export async function convertDocToMarkdown(
  absolutePath: string,
  title?: string,
): Promise<string> {
  const name = title ?? path.basename(absolutePath, path.extname(absolutePath));
  const WordExtractor = await loadWordExtractor();
  const extractor = new WordExtractor();
  const doc = await extractor.extract(absolutePath);
  return plainTextToMarkdown(doc.getBody(), name);
}

export interface PdfPageMarkdown {
  /** 从 1 开始的页码 */
  num: number;
  /** 本页正文（不含页码注释）：段落、Markdown 表格、图片引用 */
  markdown: string;
  /** 可见字符数（表格与自由文本合计） */
  visibleChars: number;
}

export interface PdfImageExtractionStats {
  extracted: number;
  failed: number;
}

export interface PdfDocumentExtraction {
  pages: PdfPageMarkdown[];
  total: number;
  tables: number;
  images: PdfImageExtractionStats;
}

/** 去掉空白后少于这个字数即视为没有文字层（扫描件或纯图片 PDF）。 */
export const PDF_MIN_TEXT_LAYER_CHARS = 20;
export const PDF_NO_TEXT_LAYER_MESSAGE =
  '这份 PDF 没有文字层（可能是扫描件），本版本未支持 OCR，无法读取内容';
const PDF_CANCELLED_MESSAGE = 'PDF 转换已取消';
export const PDF_NO_TEXT_LAYER_NOTICE =
  '> 这份 PDF 没有文字层（可能是扫描件），本版本未支持 OCR，未能识别文字；以下是各页抽出的图片。';

export interface PdfAssetsTarget {
  /** 图片落盘目录（绝对路径，调用方已确保在工作区内） */
  dir: string;
  /** Markdown 里引用图片时使用的目录前缀（相对 .md 文件所在目录） */
  relativePrefix: string;
}

export interface PdfToMarkdownOptions {
  /** 每页正文前插入 `<!-- page N -->`，便于回答时回指页码；知识库导入不插，免得注释进入检索切片。 */
  pageMarkers?: boolean;
  /** 给出目录则抽出页面上的图片并在 Markdown 里引用；知识库导入不抽。 */
  assets?: PdfAssetsTarget;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error(PDF_CANCELLED_MESSAGE);
}

async function writeAssetAtomically(absolutePath: string, bytes: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const temporary = `${absolutePath}.shorekeeper-${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, absolutePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * 逐页分析 PDF：重建表格、归位文字与图片，渲染成每页一段 Markdown。
 * 页面上的图片只有在给了 assets 时才落盘；抽图失败只影响图片，不影响正文。
 */
export async function extractPdfDocument(
  absolutePath: string,
  options: PdfToMarkdownOptions = {},
): Promise<PdfDocumentExtraction> {
  const [pdfjs, { analyzePdfPage, countVisibleChars }, { renderPdfPageMarkdown }, { renderPlacementImage }] =
    await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('../documents/pdf-layout'),
      import('../documents/pdf-markdown'),
      import('../documents/pdf-images'),
    ]);
  const buffer = await fs.readFile(absolutePath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  let doc: Awaited<typeof loadingTask.promise> | undefined;
  try {
    doc = await loadingTask.promise;
    const images: PdfImageExtractionStats = { extracted: 0, failed: 0 };
    const pages: PdfPageMarkdown[] = [];
    let tables = 0;
    // 图片像素挂在页面对象表上，page.cleanup() 之后就没了，所以抽图必须在同一页的分析之后立即做
    const canvasModule = options.assets ? await import('@napi-rs/canvas') : null;

    for (let num = 1; num <= doc.numPages; num += 1) {
      throwIfAborted(options.signal);
      const page = await doc.getPage(num);
      try {
        const layout = await analyzePdfPage(page);
        tables += layout.tables.length;
        const refs = new Map<string, string>();
        if (options.assets && canvasModule) {
          for (const placement of layout.images) {
            throwIfAborted(options.signal);
            try {
              const encoded = await renderPlacementImage(page, placement, canvasModule);
              const fileName = `${placement.id}.${encoded.ext}`;
              await writeAssetAtomically(path.join(options.assets.dir, fileName), encoded.bytes);
              refs.set(placement.id, `${options.assets.relativePrefix}/${fileName}`);
              images.extracted += 1;
            } catch (error) {
              images.failed += 1;
              console.warn(`[pdf] 第 ${num} 页图片 ${placement.id} 抽取失败:`, error instanceof Error ? error.message : error);
            }
          }
        }
        pages.push({
          num,
          markdown: renderPdfPageMarkdown(layout, refs),
          visibleChars: countVisibleChars(layout),
        });
      } finally {
        page.cleanup();
      }
    }

    return { total: doc.numPages, tables, images, pages };
  } catch (err) {
    if (err instanceof Error && err.message === PDF_CANCELLED_MESSAGE) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF 文本提取失败：${message}`);
  } finally {
    await (doc ? doc.destroy() : loadingTask.destroy()).catch((error) => {
      console.warn('[rag] PDF 解析器清理失败:', error);
    });
  }
}

export function hasPdfTextLayer(extraction: Pick<PdfDocumentExtraction, 'pages'>): boolean {
  const visible = extraction.pages.reduce((sum, page) => sum + page.visibleChars, 0);
  return visible >= PDF_MIN_TEXT_LAYER_CHARS;
}

export interface PdfMarkdownDocument {
  markdown: string;
  total: number;
  tables: number;
  images: PdfImageExtractionStats;
  /** false：没有文字层，Markdown 里只有图片与一条说明 */
  textLayer: boolean;
}

/**
 * PDF → Markdown。没有文字层时：抽到了图片就照常输出（正文开头写明未识别文字），
 * 一张图也没有才抛错——空文件会让调用方误以为“读到了、只是没内容”。
 */
export async function convertPdfToMarkdownDocument(
  absolutePath: string,
  title?: string,
  options: PdfToMarkdownOptions = {},
): Promise<PdfMarkdownDocument> {
  const name = title ?? path.basename(absolutePath, path.extname(absolutePath));
  const extraction = await extractPdfDocument(absolutePath, options);
  const textLayer = hasPdfTextLayer(extraction);
  if (!textLayer && extraction.images.extracted === 0) {
    throw new Error(PDF_NO_TEXT_LAYER_MESSAGE);
  }
  const body = extraction.pages
    .map((page) => {
      const text = page.markdown.trim();
      if (!options.pageMarkers) return text;
      return text ? `<!-- page ${page.num} -->\n\n${text}` : `<!-- page ${page.num} -->`;
    })
    .filter(Boolean)
    .join('\n\n');
  return {
    markdown: ensureTitle(textLayer ? body : `${PDF_NO_TEXT_LAYER_NOTICE}\n\n${body}`, name),
    total: extraction.total,
    tables: extraction.tables,
    images: extraction.images,
    textLayer,
  };
}

export async function convertPdfToMarkdown(
  absolutePath: string,
  title?: string,
  options: PdfToMarkdownOptions = {},
): Promise<string> {
  return (await convertPdfToMarkdownDocument(absolutePath, title, options)).markdown;
}

export async function convertBinaryToMarkdown(
  absolutePath: string,
): Promise<string> {
  const ext = path.extname(absolutePath).toLowerCase();
  const title = path.basename(absolutePath, ext);

  if (ext === '.docx') return convertDocxToMarkdown(absolutePath, title);
  if (ext === '.doc') return convertDocToMarkdown(absolutePath, title);
  if (ext === '.pdf') return convertPdfToMarkdown(absolutePath, title);

  throw new Error(`不支持的格式：${ext || '未知'}`);
}
