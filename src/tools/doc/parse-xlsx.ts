import path from 'node:path';
import { resolveWorkspacePath } from '../file/workspace-path';
import { loadExcelJS } from './exceljs-loader';

export interface ParsedXlsxSheet {
  path: string;
  sheet: string;
  available_sheets: string[];
  headers: string[];
  rows: string[][];
  total_rows: number;
  start_row: number;
  returned_rows: number;
  truncated: boolean;
  has_more: boolean;
}

export interface ParseXlsxOptions {
  sheet_name?: string;
  max_rows?: number;
  /** Zero-based offset within data rows (the header is not counted). */
  start_row?: number;
}

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

export async function parseXlsxFile(
  workspaceRoot: string,
  filePath: string,
  options: ParseXlsxOptions = {},
): Promise<ParsedXlsxSheet> {
  const { sheet_name, max_rows = 500, start_row = 0 } = options;

  if (!filePath?.trim()) {
    throw new Error('缺少 path 参数');
  }
  if (!filePath.toLowerCase().endsWith('.xlsx')) {
    throw new Error('仅支持 .xlsx 文件，请用 read_file 读取 CSV/文本');
  }

  const rowLimit = Number.isFinite(max_rows)
    ? Math.max(1, Math.min(Math.floor(max_rows), 5000))
    : 500;
  const rowOffset = Number.isFinite(start_row) ? Math.max(0, Math.floor(start_row)) : 0;
  const absolute = resolveWorkspacePath(workspaceRoot, filePath);
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(absolute);

  const sheet = sheet_name?.trim()
    ? workbook.getWorksheet(sheet_name)
    : workbook.worksheets[0];

  if (!sheet) {
    const names = workbook.worksheets.map((ws) => ws.name).join(', ');
    throw new Error(
      sheet_name ? `未找到工作表「${sheet_name}」，可用：${names}` : '工作簿为空',
    );
  }

  const rawRows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values;
    if (!Array.isArray(values)) return;
    rawRows.push(values.slice(1).map(cellToString));
  });

  if (!rawRows.length) {
    return {
      path: filePath.replace(/\\/g, '/'),
      sheet: sheet.name,
      available_sheets: workbook.worksheets.map((ws) => ws.name),
      headers: [],
      rows: [],
      total_rows: 0,
      start_row: rowOffset,
      returned_rows: 0,
      truncated: false,
      has_more: false,
    };
  }

  const headers = rawRows[0];
  const dataRows = rawRows.slice(1);
  const totalRows = dataRows.length;
  const rows = dataRows.slice(rowOffset, rowOffset + rowLimit);
  const hasMore = rowOffset + rows.length < totalRows;
  const truncated = rowOffset > 0 || hasMore;

  return {
    path: path.relative(workspaceRoot, absolute).replace(/\\/g, '/'),
    sheet: sheet.name,
    available_sheets: workbook.worksheets.map((ws) => ws.name),
    headers,
    rows,
    total_rows: totalRows,
    start_row: rowOffset,
    returned_rows: rows.length,
    truncated,
    has_more: hasMore,
  };
}

export function formatParsedXlsxForPrompt(parsed: ParsedXlsxSheet): string {
  const lines = [
    `文件: ${parsed.path}`,
    `工作表: ${parsed.sheet}`,
    `表头: ${JSON.stringify(parsed.headers)}`,
    `数据行（共 ${parsed.total_rows} 行，本页从第 ${parsed.start_row + 1} 条起返回 ${parsed.returned_rows} 行）:`,
    ...parsed.rows.map((row, i) => `  ${parsed.start_row + i + 1}. ${JSON.stringify(row)}`),
  ];
  if (parsed.has_more) {
    lines.push(`仍有后续数据；下一页 start_row=${parsed.start_row + parsed.returned_rows}`);
  }
  if (parsed.available_sheets.length > 1) {
    lines.push(`其他工作表: ${parsed.available_sheets.join(', ')}`);
  }
  return lines.join('\n');
}
