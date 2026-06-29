import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../types';
import { resolveWorkspacePath } from '../file/workspace-path';

async function writeWorkspaceFile(
  ctx: { workspaceRoot: string },
  filePath: string,
  write: (absolute: string) => Promise<void>,
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const absolute = resolveWorkspacePath(ctx.workspaceRoot, filePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await write(absolute);
    return { success: true, output: `已生成 ${filePath}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: '', error: message };
  }
}

export const genMarkdownTool: ToolDefinition = {
  name: 'gen_markdown',
  description: '在工作区生成 Markdown 文件',
  category: 'doc',
  requiresPermission: ['filesystem:write'],
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '输出路径，如 reports/summary.md' },
      content: { type: 'string', description: 'Markdown 正文' },
    },
    required: ['path', 'content'],
  },
  async execute(args, ctx) {
    const { path: filePath, content } = args as { path?: string; content?: string };
    if (!filePath?.trim() || content == null) {
      return { success: false, output: '', error: '缺少 path 或 content' };
    }
    return writeWorkspaceFile(ctx, filePath, async (absolute) => {
      await fs.writeFile(absolute, content, 'utf-8');
    });
  },
};

export const genDocxTool: ToolDefinition = {
  name: 'gen_docx',
  description: '在工作区生成 Word (.docx) 文档',
  category: 'doc',
  requiresPermission: ['filesystem:write'],
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '输出路径，如 reports/report.docx' },
      title: { type: 'string', description: '文档标题' },
      body: { type: 'string', description: '正文（纯文本，段落以空行分隔）' },
    },
    required: ['path', 'title', 'body'],
  },
  async execute(args, ctx) {
    const { path: filePath, title, body } = args as {
      path?: string;
      title?: string;
      body?: string;
    };
    if (!filePath?.trim() || !title?.trim() || body == null) {
      return { success: false, output: '', error: '缺少 path、title 或 body' };
    }

    return writeWorkspaceFile(ctx, filePath, async (absolute) => {
      const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx');
      const paragraphs = body.split(/\n{2,}/).flatMap((block) => {
        const lines = block.split('\n');
        return lines.map(
          (line) =>
            new Paragraph({
              children: [new TextRun(line)],
            }),
        );
      });

      const doc = new Document({
        sections: [
          {
            children: [
              new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
              ...paragraphs,
            ],
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      await fs.writeFile(absolute, buffer);
    });
  },
};

export const genXlsxTool: ToolDefinition = {
  name: 'gen_xlsx',
  description: '在工作区生成 Excel (.xlsx) 表格',
  category: 'doc',
  requiresPermission: ['filesystem:write'],
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '输出路径，如 data/table.xlsx' },
      sheet_name: { type: 'string', description: '工作表名称，默认 Sheet1' },
      headers: {
        type: 'array',
        items: { type: 'string' },
        description: '表头列名',
      },
      rows: {
        type: 'array',
        items: { type: 'array', items: { type: 'string' } },
        description: '数据行（与 headers 列数对应）',
      },
    },
    required: ['path', 'headers', 'rows'],
  },
  async execute(args, ctx) {
    const { path: filePath, sheet_name = 'Sheet1', headers, rows } = args as {
      path?: string;
      sheet_name?: string;
      headers?: string[];
      rows?: string[][];
    };

    if (!filePath?.trim() || !headers?.length) {
      return { success: false, output: '', error: '缺少 path 或 headers' };
    }

    return writeWorkspaceFile(ctx, filePath, async (absolute) => {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(sheet_name);
      sheet.addRow(headers);
      for (const row of rows ?? []) {
        sheet.addRow(row);
      }
      await workbook.xlsx.writeFile(absolute);
    });
  },
};

export const genPdfTool: ToolDefinition = {
  name: 'gen_pdf',
  description: '在工作区生成简单 PDF 文档（纯文本）',
  category: 'doc',
  requiresPermission: ['filesystem:write'],
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '输出路径，如 reports/report.pdf' },
      title: { type: 'string', description: '文档标题' },
      body: { type: 'string', description: '正文内容' },
    },
    required: ['path', 'title', 'body'],
  },
  async execute(args, ctx) {
    const { path: filePath, title, body } = args as {
      path?: string;
      title?: string;
      body?: string;
    };
    if (!filePath?.trim() || !title?.trim() || body == null) {
      return { success: false, output: '', error: '缺少 path、title 或 body' };
    }

    return writeWorkspaceFile(ctx, filePath, async (absolute) => {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const page = pdf.addPage([595, 842]);
      const { height } = page.getSize();
      let y = height - 50;

      page.drawText(title, { x: 50, y, size: 18, font, color: rgb(0.1, 0.1, 0.1) });
      y -= 36;

      const lines = body.split('\n');
      for (const line of lines) {
        if (y < 50) break;
        page.drawText(line.slice(0, 90), { x: 50, y, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
        y -= 16;
      }

      const bytes = await pdf.save();
      await fs.writeFile(absolute, bytes);
    });
  },
};
