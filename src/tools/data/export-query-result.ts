/**
 * export_query_result（P7.4，计划 §3.5、§11.7）：把 run_sql_query 落下的 CSV 导成 Excel（带"来源"工作表）或图表。
 * 数字列写成数字（前导零的编号仍是文本）、日期列按日期格式、其余文本；来源页有数据源、方案、SQL、执行时间、行数。
 * 图表复用 gen_chart：类目超过 50 个提示先聚合。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../types';
import { WORKSPACE_WRITE_CONTRACT } from '../contract';
import { buildFileArtifact, writeWorkspaceFileAtomically } from '../file/artifact';
import { resolveWorkspacePath } from '../file/workspace-path';
import { loadExcelJS } from '../doc/exceljs-loader';
import { genChartTool } from '../doc/gen-chart';
import { MAX_CHART_CATEGORIES } from '../../documents/chart-svg';
import { classifyCsvColumn, isoToExcelDate, parseCsv, type CsvColumnKind } from '../../datasources/csv';
import { renderQueryPlan } from '../../datasources/plan-render';
import { parseQueryPlan } from '../../datasources/query-plan';
import { getDataToolDeps, resolveSource } from './source-access';

function invalid(error: string): ToolResult {
  return { success: false, output: '', error, errorCategory: 'invalid_arguments' };
}

export interface ExportSourceInfo {
  sourceName: string;
  summary: string;
  sql: string;
  ranAt: string;
  rowCount: number;
}

/** 来源页四列里的"项 / 值"两列（§11.7） */
export function sourceSheetRows(info: ExportSourceInfo): Array<[string, string]> {
  return [
    ['数据源', info.sourceName],
    ['方案', info.summary],
    ['SQL', info.sql],
    ['执行时间', info.ranAt],
    ['行数', String(info.rowCount)],
    ['说明', '本页供核对；数字列按数字写入，日期列按日期写入，其余为文本'],
  ];
}

function formatRanAt(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function columnKinds(columns: string[], rows: string[][]): CsvColumnKind[] {
  return columns.map((_column, index) => classifyCsvColumn(rows.map((row) => row[index] ?? '')));
}

export const exportQueryResultTool: ToolDefinition = {
  name: 'export_query_result',
  description:
    '把查询结果文件（run_sql_query 落下的 CSV）导成 Excel（带"来源"工作表：数据源、方案、执行时间、行数）或图表（柱 / 折线 / 饼）。图表的类目最多 50 个，超过先聚合',
  category: 'doc',
  requiresPermission: ['filesystem:read', 'filesystem:write'],
  sideEffects: WORKSPACE_WRITE_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      csv_path: { type: 'string', description: 'run_sql_query 返回的结果文件路径（工作区相对路径）' },
      format: { type: 'string', enum: ['xlsx', 'chart'], description: 'xlsx 导 Excel；chart 画图' },
      output_path: { type: 'string', description: '输出路径；省略则与 CSV 同名换扩展名' },
      title: { type: 'string', description: '图表标题 / Excel 工作表名' },
      chart_type: { type: 'string', enum: ['bar', 'line', 'pie'], description: 'format=chart 时的图型' },
      label_column: { type: 'string', description: 'format=chart 时作横轴 / 饼块的列（用结果文件的表头名）' },
      value_columns: { type: 'array', items: { type: 'string' }, description: 'format=chart 时作数值的列（表头名），饼图只能一列' },
      source: { type: 'string', description: '数据源名称或 id；只有一个时可省略' },
    },
    required: ['csv_path', 'format'],
  },
  async execute(args, ctx) {
    const { csv_path, format, output_path, title, chart_type, label_column, value_columns, source: ref } = (args ?? {}) as {
      csv_path?: string;
      format?: string;
      output_path?: string;
      title?: string;
      chart_type?: 'bar' | 'line' | 'pie';
      label_column?: string;
      value_columns?: string[];
      source?: string;
    };
    const csvPath = csv_path?.trim();
    if (!csvPath || !csvPath.toLowerCase().endsWith('.csv')) return invalid('csv_path 须为 run_sql_query 返回的 .csv 路径');
    if (format !== 'xlsx' && format !== 'chart') return invalid('format 只能是 xlsx 或 chart');
    const deps = getDataToolDeps();

    let text: string;
    try {
      text = await fs.readFile(resolveWorkspacePath(ctx.workspaceRoot, csvPath), 'utf-8');
    } catch {
      return invalid(`读不到 ${csvPath}；先用 run_sql_query 查出结果`);
    }
    const { columns, rows } = parseCsv(text);
    if (!columns.length) return invalid(`${csvPath} 里没有表头`);

    const run = deps.getQueryRunByArtifact(csvPath);
    const source = run ? deps.getSource(run.sourceId) : 'source' in resolveSource(ref, deps) ? (resolveSource(ref, deps) as { source: { id: string; name: string } }).source : null;
    let summary = '（没有找到这次查询的方案记录）';
    if (run && source) {
      const parsed = parseQueryPlan(JSON.parse(run.planJson));
      if ('plan' in parsed) summary = renderQueryPlan(parsed.plan, deps.loadDictionary(source.id)).summary;
    }
    const info: ExportSourceInfo = {
      sourceName: source?.name ?? '未知',
      summary,
      sql: run?.sql ?? '（无）',
      ranAt: run ? formatRanAt(run.startedAt) : '（未知）',
      rowCount: rows.length,
    };

    if (format === 'chart') {
      if (!chart_type || !['bar', 'line', 'pie'].includes(chart_type)) return invalid('format=chart 时要给 chart_type（bar / line / pie）');
      const labelIndex = columns.indexOf(label_column ?? '');
      if (labelIndex < 0) return invalid(`label_column 须是表头之一：${columns.join(' / ')}`);
      const valueNames = Array.isArray(value_columns) ? value_columns.filter((name): name is string => typeof name === 'string') : [];
      if (!valueNames.length) return invalid(`value_columns 至少给一列：${columns.filter((name) => name !== label_column).join(' / ')}`);
      const valueIndexes = valueNames.map((name) => columns.indexOf(name));
      if (valueIndexes.some((index) => index < 0)) return invalid(`value_columns 里有不存在的列；表头是：${columns.join(' / ')}`);
      if (rows.length > MAX_CHART_CATEGORIES) {
        return invalid(`结果有 ${rows.length} 条，图表最多 ${MAX_CHART_CATEGORIES} 个类目：先按更粗的粒度重新查（或只取前 ${MAX_CHART_CATEGORIES} 条）再画`);
      }
      const kinds = columnKinds(columns, rows);
      const nonNumeric = valueIndexes.filter((index) => kinds[index] !== 'number');
      if (nonNumeric.length) return invalid(`这些列不是数字，画不了：${nonNumeric.map((index) => columns[index]).join('、')}`);
      const target = output_path?.trim() || csvPath.replace(/\.csv$/i, '.svg');
      return genChartTool.execute(
        {
          path: target,
          type: chart_type,
          title: title?.trim() || summary.replace(/^我准备这样(统计|列)：/, '').slice(0, 40),
          labels: rows.map((row) => row[labelIndex] ?? ''),
          series: valueNames.map((name, position) => ({ name: valueNames.length > 1 ? name : '', values: rows.map((row) => Number(row[valueIndexes[position]] || 0)) })),
          source: `${csvPath}（${info.sourceName}，${info.ranAt}）`,
        },
        ctx,
      );
    }

    const target = output_path?.trim() || csvPath.replace(/\.csv$/i, '.xlsx');
    if (!target.toLowerCase().endsWith('.xlsx')) return invalid('output_path 须以 .xlsx 结尾');
    const kinds = columnKinds(columns, rows);
    try {
      await writeWorkspaceFileAtomically(
        ctx.workspaceRoot,
        target,
        async (temporaryPath) => {
          const ExcelJS = await loadExcelJS();
          const workbook = new ExcelJS.Workbook();
          const sheet = workbook.addWorksheet((title?.trim() || '结果').slice(0, 31));
          sheet.addRow(columns);
          sheet.getRow(1).font = { bold: true };
          for (const row of rows) {
            const cells = columns.map((_column, index) => {
              const raw = row[index] ?? '';
              if (raw === '') return null;
              if (kinds[index] === 'number') return Number(raw);
              if (kinds[index] === 'datetime') return isoToExcelDate(raw) ?? raw;
              return raw;
            });
            sheet.addRow(cells);
          }
          kinds.forEach((kind, index) => {
            const column = sheet.getColumn(index + 1);
            column.width = Math.min(60, Math.max(12, ...[columns[index], ...rows.map((row) => row[index] ?? '')].map((value) => [...value].length + 2)));
            if (kind === 'datetime') column.numFmt = 'yyyy-mm-dd hh:mm:ss';
          });
          const about = workbook.addWorksheet('来源');
          about.addRow(['项', '值']);
          about.getRow(1).font = { bold: true };
          for (const pair of sourceSheetRows(info)) about.addRow(pair);
          about.getColumn(1).width = 12;
          about.getColumn(2).width = 100;
          await workbook.xlsx.writeFile(temporaryPath);
        },
        { signal: ctx.signal },
      );
      const artifact = await buildFileArtifact(ctx.workspaceRoot, target);
      return {
        success: true,
        output: `已导出 ${target}：工作表「${(title?.trim() || '结果').slice(0, 31)}」${rows.length} 行、${columns.length} 列，另有「来源」页记录数据源、方案与执行时间`,
        metadata: { rows: rows.length, columns: columns.length, kinds, path: target },
        artifacts: [artifact],
      };
    } catch (error) {
      return { success: false, output: '', error: `导出失败：${error instanceof Error ? error.message : String(error)}（${path.basename(target)}）` };
    }
  },
};
