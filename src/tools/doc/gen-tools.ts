import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../types';
import { READ_ONLY_CONTRACT, WORKSPACE_WRITE_CONTRACT } from '../contract';
import { buildFileArtifact, withFileArtifact, writeWorkspaceFileAtomically } from '../file/artifact';
import { resolveWorkspacePath } from '../file/workspace-path';
import { parseXlsxFile } from './parse-xlsx';
import { loadExcelJS } from './exceljs-loader';

async function writeWorkspaceFile(
  ctx: { workspaceRoot: string },
  filePath: string,
  write: (absolute: string) => Promise<void>,
) {
  try {
    const artifact = await writeWorkspaceFileAtomically(ctx.workspaceRoot, filePath, write);
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
  sideEffects: WORKSPACE_WRITE_CONTRACT,
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
  sideEffects: WORKSPACE_WRITE_CONTRACT,
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
  sideEffects: READ_ONLY_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对于工作区的 .xlsx 路径' },
      sheet_name: { type: 'string', description: '工作表名称，省略则读第一个工作表' },
      max_rows: {
        type: 'number',
        description: '最多返回的数据行数（不含表头），默认 500',
      },
      start_row: {
        type: 'number',
        description: '从第几条数据行开始读取（从 0 计数，不含表头），默认 0',
      },
    },
    required: ['path'],
  },
  async execute(args, ctx) {
    const { path: filePath, sheet_name, max_rows = 500, start_row = 0 } = args as {
      path?: string;
      sheet_name?: string;
      max_rows?: number;
      start_row?: number;
    };

    if (!filePath?.trim()) {
      return { success: false, output: '', error: '缺少 path 参数' };
    }
    if (!filePath.toLowerCase().endsWith('.xlsx')) {
      return { success: false, output: '', error: '仅支持 .xlsx 文件，请用 read_file 读取 CSV/文本' };
    }

    if (!Number.isFinite(max_rows) || max_rows <= 0 || !Number.isFinite(start_row) || start_row < 0) {
      return {
        success: false,
        output: '',
        error: 'max_rows 须为有限数字，start_row 须为大于等于 0 的有限数字',
      };
    }
    const rowLimit = Math.max(1, Math.min(Math.floor(max_rows), 5000));

    try {
      const parsed = await parseXlsxFile(ctx.workspaceRoot, filePath, {
        sheet_name,
        max_rows: rowLimit,
        start_row,
      });

      const artifact = await buildFileArtifact(ctx.workspaceRoot, filePath);
      return withFileArtifact(
        {
          success: true,
          output: JSON.stringify(parsed, null, 2),
        },
        artifact,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};

type XlsxCellValue = string | number | boolean | null;

interface XlsxCellUpdate {
  cell: string;
  value: XlsxCellValue;
}

const CELL_ADDRESS = /^[A-Za-z]{1,3}[1-9]\d{0,6}$/;

/** Update selected cells without rebuilding the workbook or discarding other sheets. */
export const updateXlsxCellsTool: ToolDefinition = {
  name: 'update_xlsx_cells',
  description: '原位修改现有 Excel 工作簿中的指定单元格，并保留其他工作表、公式与格式',
  category: 'doc',
  requiresPermission: ['filesystem:read', 'filesystem:write'],
  sideEffects: WORKSPACE_WRITE_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      source_path: { type: 'string', description: '现有 .xlsx 文件的工作区相对路径' },
      output_path: {
        type: 'string',
        description: '可选输出路径；省略则安全覆盖源文件并保留备份',
      },
      sheet_name: { type: 'string', description: '要修改的工作表；省略则使用第一个工作表' },
      updates: {
        type: 'array',
        description: '单元格更新列表，最多 500 项',
        items: {
          type: 'object',
          properties: {
            cell: { type: 'string', description: 'A1 地址，如 C12' },
            value: {
              anyOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
                { type: 'null' },
              ],
              description: '新值；支持字符串、数字、布尔值或 null（清空）',
            },
          },
          required: ['cell', 'value'],
        },
      },
    },
    required: ['source_path', 'updates'],
  },
  async execute(args, ctx) {
    const { source_path, output_path, sheet_name, updates } = args as {
      source_path?: string;
      output_path?: string;
      sheet_name?: string;
      updates?: XlsxCellUpdate[];
    };
    const sourcePath = source_path?.trim().replace(/\\/g, '/');
    const outputPath = (output_path?.trim() || sourcePath || '').replace(/\\/g, '/');

    if (!sourcePath) return { success: false, output: '', error: '缺少 source_path 参数' };
    if (!sourcePath.toLowerCase().endsWith('.xlsx') || !outputPath.toLowerCase().endsWith('.xlsx')) {
      return { success: false, output: '', error: 'source_path 与 output_path 须为 .xlsx 文件' };
    }
    if (!Array.isArray(updates) || updates.length === 0) {
      return { success: false, output: '', error: 'updates 必须是非空数组' };
    }
    if (updates.length > 500) {
      return { success: false, output: '', error: '单次最多修改 500 个单元格' };
    }
    for (const update of updates) {
      if (!update || typeof update.cell !== 'string' || !CELL_ADDRESS.test(update.cell.trim())) {
        return { success: false, output: '', error: `无效单元格地址: ${update?.cell ?? ''}` };
      }
      if (!['string', 'number', 'boolean'].includes(typeof update.value) && update.value !== null) {
        return { success: false, output: '', error: `不支持的单元格值: ${update.cell}` };
      }
    }

    try {
      const sourceAbsolute = resolveWorkspacePath(ctx.workspaceRoot, sourcePath);
      const outputAbsolute = resolveWorkspacePath(ctx.workspaceRoot, outputPath);
      const overwritesSource = process.platform === 'win32'
        ? sourceAbsolute.toLowerCase() === outputAbsolute.toLowerCase()
        : sourceAbsolute === outputAbsolute;
      const ExcelJS = await loadExcelJS();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(sourceAbsolute);
      const sheet = sheet_name?.trim()
        ? workbook.getWorksheet(sheet_name.trim())
        : workbook.worksheets[0];
      if (!sheet) {
        const names = workbook.worksheets.map((item) => item.name).join(', ');
        return {
          success: false,
          output: '',
          error: sheet_name ? `未找到工作表「${sheet_name}」，可用：${names}` : '工作簿为空',
        };
      }

      for (const update of updates) {
        sheet.getCell(update.cell.trim().toUpperCase()).value = update.value;
      }

      const artifact = await writeWorkspaceFileAtomically(
        ctx.workspaceRoot,
        outputPath,
        (temporaryPath) => workbook.xlsx.writeFile(temporaryPath),
        { preserveBackup: overwritesSource },
      );
      return withFileArtifact(
        {
          success: true,
          output: `已在 ${sheet.name} 修改 ${updates.length} 个单元格，保存至 ${outputPath}`,
          metadata: { sheet: sheet.name, updatedCells: updates.map((item) => item.cell.toUpperCase()) },
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
  sideEffects: WORKSPACE_WRITE_CONTRACT,
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
      const ExcelJS = await loadExcelJS();
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
  sideEffects: WORKSPACE_WRITE_CONTRACT,
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
