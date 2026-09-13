import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../types';
import { WORKSPACE_WRITE_CONTRACT } from '../contract';
import { withFileArtifact, writeWorkspaceFileAtomically } from '../file/artifact';
import { resolveWorkspacePath } from '../file/workspace-path';
import { loadMammoth, loadWordExtractor } from './doc-loaders';
import { loadExcelJS } from './exceljs-loader';

const DOCX_EXT = new Set(['.docx']);
const DOC_EXT = new Set(['.doc']);
const PLAIN_TEXT_EXT = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.log',
  '.xml',
  '.yaml',
  '.yml',
  '.ini',
  '.html',
  '.htm',
]);

function defaultOutputPath(sourcePath: string): string {
  const parsed = path.parse(sourcePath);
  const relative = path.join(parsed.dir, `${parsed.name}.md`);
  return relative.replace(/\\/g, '/');
}

function ensureTitle(markdown: string, title: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return `# ${title}\n\n`;
  if (/^#\s/m.test(trimmed)) return `${trimmed}\n`;
  return `# ${title}\n\n${trimmed}\n`;
}

function escapeTableCell(value: string): string {
  return value.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim();
}

function decodeHtmlEntities(value: string): string {
  const decodeCodePoint = (code: number, fallback: string): string => {
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return fallback;
    }
    return String.fromCodePoint(code);
  };
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (match, code: string) => decodeCodePoint(Number(code), match))
    .replace(/&#x([0-9a-f]+);/gi, (match, code: string) => decodeCodePoint(Number.parseInt(code, 16), match));
}

function htmlInlineToText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  ).trim();
}

/** Convert the common structural HTML emitted by Mammoth into Markdown. */
export function htmlToMarkdown(html: string): string {
  let value = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_table, body: string) => {
      const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map((match) => [...match[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
          .map((cell) => escapeTableCell(htmlInlineToText(cell[1]))))
        .filter((row) => row.length > 0);
      if (!rows.length) return '';
      const width = Math.max(...rows.map((row) => row.length));
      const normalized = rows.map((row) => [
        ...row,
        ...Array.from({ length: width - row.length }, () => ''),
      ]);
      return `\n\n| ${normalized[0].join(' | ')} |\n| ${normalized[0].map(() => '---').join(' | ')} |\n${normalized
        .slice(1)
        .map((row) => `| ${row.join(' | ')} |`)
        .join('\n')}\n\n`;
    });

  value = value
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, body: string) =>
      `\n\n${'#'.repeat(Number(level))} ${htmlInlineToText(body)}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, body: string) =>
      `\n- ${htmlInlineToText(body)}`)
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href: string, body: string) => `[${htmlInlineToText(body)}](${href})`)
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, body: string) =>
      `**${htmlInlineToText(body)}**`)
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, body: string) =>
      `*${htmlInlineToText(body)}*`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|ul|ol)>/gi, '\n\n')
    .replace(/<(p|div|ul|ol)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '');

  return decodeHtmlEntities(value)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function plainTextToMarkdown(content: string, title: string, ext: string): string {
  const trimmed = content.trim();
  if (!trimmed) return `# ${title}\n\n`;
  if (ext === '.md' || ext === '.markdown') {
    return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
  }

  if (ext === '.html' || ext === '.htm') {
    return ensureTitle(htmlToMarkdown(trimmed), title);
  }

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return `# ${title}\n\n${paragraphs.join('\n\n')}\n`;
}

async function convertDocx(absolute: string, title: string): Promise<string> {
  const mammoth = await loadMammoth();
  const result = await mammoth.convertToHtml({ path: absolute });
  return ensureTitle(htmlToMarkdown(result.value), title);
}

async function convertDoc(absolute: string, title: string): Promise<string> {
  const WordExtractor = await loadWordExtractor();
  const extractor = new WordExtractor();
  const doc = await extractor.extract(absolute);
  const body = doc.getBody().trim();
  return plainTextToMarkdown(body, title, '.txt');
}

async function convertCsv(absolute: string, title: string): Promise<string> {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  const sheet = await workbook.csv.readFile(absolute);
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push(values.map((cell) => escapeTableCell(cell == null ? '' : String(cell))));
  });
  if (!rows.length) return `# ${title}\n\n`;
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => '')]);
  return `# ${title}\n\n| ${normalized[0].join(' | ')} |\n| ${normalized[0].map(() => '---').join(' | ')} |\n${normalized
    .slice(1)
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n')}\n`;
}

export const convertToMarkdownTool: ToolDefinition = {
  name: 'convert_to_markdown',
  description:
    '将工作区内的 Word（.doc/.docx）或文本类文件（txt/md/csv/html 等）转换为 Markdown 并保存',
  category: 'doc',
  requiresPermission: ['filesystem:read', 'filesystem:write'],
  sideEffects: WORKSPACE_WRITE_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      source_path: {
        type: 'string',
        description: '源文件相对路径，如 docs/report.docx',
      },
      output_path: {
        type: 'string',
        description: '输出 .md 路径；省略则与源文件同目录、同名 .md',
      },
    },
    required: ['source_path'],
  },
  async execute(args, ctx) {
    const { source_path, output_path } = args as {
      source_path?: string;
      output_path?: string;
    };

    if (!source_path?.trim()) {
      return { success: false, output: '', error: '缺少 source_path 参数' };
    }

    const sourcePath = source_path.trim().replace(/\\/g, '/');
    const ext = path.extname(sourcePath).toLowerCase();
    const supported = DOCX_EXT.has(ext) || DOC_EXT.has(ext) || PLAIN_TEXT_EXT.has(ext);
    if (!supported) {
      return {
        success: false,
        output: '',
        error: `不支持 ${ext || '该'} 格式；支持 .doc、.docx 及常见文本文件（txt/md/csv/html 等）`,
      };
    }

    const outPath = (output_path?.trim() || defaultOutputPath(sourcePath)).replace(/\\/g, '/');
    if (!outPath.toLowerCase().endsWith('.md')) {
      return { success: false, output: '', error: 'output_path 须为 .md 文件' };
    }

    try {
      const absolute = resolveWorkspacePath(ctx.workspaceRoot, sourcePath);
      const title = path.basename(sourcePath, ext);
      let markdown: string;

      if (DOCX_EXT.has(ext)) {
        markdown = await convertDocx(absolute, title);
      } else if (DOC_EXT.has(ext)) {
        markdown = await convertDoc(absolute, title);
      } else if (ext === '.csv') {
        markdown = await convertCsv(absolute, title);
      } else {
        const content = await fs.readFile(absolute, 'utf-8');
        markdown = plainTextToMarkdown(content, title, ext);
      }

      const artifact = await writeWorkspaceFileAtomically(
        ctx.workspaceRoot,
        outPath,
        (temporaryPath) => fs.writeFile(temporaryPath, markdown, 'utf-8'),
      );
      return withFileArtifact(
        {
          success: true,
          output: `已转换 ${sourcePath} → ${outPath}（${markdown.length} 字符）`,
        },
        artifact,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};
