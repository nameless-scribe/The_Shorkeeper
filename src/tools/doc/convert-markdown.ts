import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../types';
import { buildFileArtifact, withFileArtifact } from '../file/artifact';
import { resolveWorkspacePath } from '../file/workspace-path';
import { loadMammoth, loadWordExtractor } from './doc-loaders';

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
  '.rtf',
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
  return value.replace(/\|/g, '\\|').trim();
}

function plainTextToMarkdown(content: string, title: string, ext: string): string {
  const trimmed = content.trim();
  if (!trimmed) return `# ${title}\n\n`;
  if (ext === '.md' || ext === '.markdown') {
    return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
  }

  if (ext === '.csv') {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return `# ${title}\n\n`;
    const rows = lines.map((line) => line.split(',').map(escapeTableCell));
    const header = rows[0];
    const sep = header.map(() => '---');
    const body = rows.slice(1);
    const table = [
      `| ${header.join(' | ')} |`,
      `| ${sep.join(' | ')} |`,
      ...body.map((row) => `| ${row.join(' | ')} |`),
    ].join('\n');
    return `# ${title}\n\n${table}\n`;
  }

  if (ext === '.html' || ext === '.htm') {
    const text = trimmed
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return ensureTitle(text, title);
  }

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return `# ${title}\n\n${paragraphs.join('\n\n')}\n`;
}

async function convertDocx(absolute: string, title: string): Promise<string> {
  const mammoth = await loadMammoth();
  const result = await mammoth.extractRawText({ path: absolute });
  return plainTextToMarkdown(result.value, title, '.txt');
}

async function convertDoc(absolute: string, title: string): Promise<string> {
  const WordExtractor = await loadWordExtractor();
  const extractor = new WordExtractor();
  const doc = await extractor.extract(absolute);
  const body = doc.getBody().trim();
  return plainTextToMarkdown(body, title, '.txt');
}

export const convertToMarkdownTool: ToolDefinition = {
  name: 'convert_to_markdown',
  description:
    '将工作区内的 Word（.doc/.docx）或文本类文件（txt/md/csv/html 等）转换为 Markdown 并保存',
  category: 'doc',
  requiresPermission: ['filesystem:read', 'filesystem:write'],
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
      } else {
        const content = await fs.readFile(absolute, 'utf-8');
        markdown = plainTextToMarkdown(content, title, ext);
      }

      const outAbsolute = resolveWorkspacePath(ctx.workspaceRoot, outPath);
      await fs.mkdir(path.dirname(outAbsolute), { recursive: true });
      await fs.writeFile(outAbsolute, markdown, 'utf-8');

      const artifact = await buildFileArtifact(ctx.workspaceRoot, outPath);
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
