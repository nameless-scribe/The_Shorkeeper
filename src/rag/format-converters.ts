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

export async function convertPdfToMarkdown(
  absolutePath: string,
  title?: string,
): Promise<string> {
  const name = title ?? path.basename(absolutePath, path.extname(absolutePath));
  try {
    const { PDFParse } = await import('pdf-parse');
    const buffer = await fs.readFile(absolutePath);
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return plainTextToMarkdown(result.text, name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF 文本提取失败：${message}`);
  }
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
