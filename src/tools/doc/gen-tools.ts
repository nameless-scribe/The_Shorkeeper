import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../types';
import { buildFileArtifact, withFileArtifact } from '../file/artifact';
import { resolveWorkspacePath } from '../file/workspace-path';

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'text' in value && typeof (value as { text: unknown }).text === 'string') {
    return (value as { text: string }).text;
  }
  if (typeof value === 'object' && 'result' in value) {
    return cellToString((value as { result: unknown }).result);
  }
  return String(value);
}

async function writeWorkspaceFile(
  ctx: { workspaceRoot: string },
  filePath: string,
  write: (absolute: string) => Promise<void>,
) {
  try {
    const absolute = resolveWorkspacePath(ctx.workspaceRoot, filePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await write(absolute);
    const artifact = await buildFileArtifact(ctx.workspaceRoot, filePath);
    return withFileArtifact({ success: true, output: `已生成 ${filePath}` }, artifact);
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

export const readXlsxTool: ToolDefinition = {
  name: 'read_xlsx',
  description: '读取工作区内的 Excel (.xlsx) 表格，返回 JSON（表头 + 数据行）',
  category: 'doc',
  requiresPermission: ['filesystem:read'],
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对于工作区的 .xlsx 路径' },
      sheet_name: { type: 'string', description: '工作表名称，省略则读第一个工作表' },
      max_rows: {
        type: 'number',
        description: '最多返回的数据行数（不含表头），默认 500',
      },
    },
    required: ['path'],
  },
  async execute(args, ctx) {
    const { path: filePath, sheet_name, max_rows = 500 } = args as {
      path?: string;
      sheet_name?: string;
      max_rows?: number;
    };

    if (!filePath?.trim()) {
      return { success: false, output: '', error: '缺少 path 参数' };
    }
    if (!filePath.toLowerCase().endsWith('.xlsx')) {
      return { success: false, output: '', error: '仅支持 .xlsx 文件，请用 read_file 读取 CSV/文本' };
    }

    const rowLimit = Math.max(1, Math.min(max_rows, 5000));

    try {
      const absolute = resolveWorkspacePath(ctx.workspaceRoot, filePath);
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(absolute);

      const sheet = sheet_name?.trim()
        ? workbook.getWorksheet(sheet_name)
        : workbook.worksheets[0];

      if (!sheet) {
        const names = workbook.worksheets.map((ws) => ws.name).join(', ');
        return {
          success: false,
          output: '',
          error: sheet_name ? `未找到工作表「${sheet_name}」，可用：${names}` : '工作簿为空',
        };
      }

      const rawRows: string[][] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values = row.values;
        if (!Array.isArray(values)) return;
        rawRows.push(values.slice(1).map(cellToString));
      });

      if (!rawRows.length) {
        const artifact = await buildFileArtifact(ctx.workspaceRoot, filePath);
        return withFileArtifact(
          {
            success: true,
            output: JSON.stringify(
              { path: filePath, sheet: sheet.name, headers: [], rows: [], total_rows: 0 },
              null,
              2,
            ),
          },
          artifact,
        );
      }

      const headers = rawRows[0];
      const dataRows = rawRows.slice(1);
      const totalRows = dataRows.length;
      const truncated = totalRows > rowLimit;
      const rows = truncated ? dataRows.slice(0, rowLimit) : dataRows;

      const artifact = await buildFileArtifact(ctx.workspaceRoot, filePath);
      return withFileArtifact(
        {
          success: true,
          output: JSON.stringify(
            {
              path: filePath,
              sheet: sheet.name,
              available_sheets: workbook.worksheets.map((ws) => ws.name),
              headers,
              rows,
              total_rows: totalRows,
              truncated,
            },
            null,
            2,
          ),
        },
        artifact,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
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
