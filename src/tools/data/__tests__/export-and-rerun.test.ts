import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DataSourceInfo, QueryRunInfo } from '../../../db/repositories/datasources';
import type { QueryResult } from '../../../datasources/mysql-connector';
import { parameterizePlan, type NamedQueryCandidate } from '../../../datasources/named-queries';
import { classifyCsvColumn, isoToExcelDate, parseCsv, toCsv } from '../../../datasources/csv';
import { sampleDictionary, samplePlan } from '../../../datasources/__tests__/fixtures';
import { loadExcelJS } from '../../doc/exceljs-loader';
import { exportQueryResultTool, sourceSheetRows } from '../export-query-result';
import { runNamedQueryTool } from '../run-named-query';
import { buildNamedQueryPrompt } from '../schedule-named-query';
import { resolveTimePreset, setDataToolDeps, type DataToolDeps } from '../source-access';

const SOURCE: DataSourceInfo = {
  id: 'src-1', name: '生产库', kind: 'mysql', host: '10.0.0.5', port: 3306, database: 'erp', user: 'reader',
  passwordConfigured: true, options: {}, lastOkAt: 1, lastError: null, writableAccount: false, createdAt: 1, updatedAt: 1,
};

function result(columns: string[], rows: unknown[][], truncated = false): QueryResult {
  return { columns, rows, truncated, durationMs: 3 };
}

let workspace: string;
let named: NamedQueryCandidate[];
let queries: string[];
let touched: Array<[string, number]>;
let runByArtifact: QueryRunInfo | null;

function deps(): Partial<DataToolDeps> {
  return {
    listSources: () => [SOURCE],
    getSource: () => SOURCE,
    loadDictionary: () => sampleDictionary(),
    getConnector: () => ({
      explain: async () => [{ rows: 10 }],
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith('WITH')) return result(['name', '销售额', '订单数'], [['星泓科技', 120, 3]]);
        if (sql.includes('MIN(')) return result(['最早', '最晚'], [['2026-08-01', '2026-08-31']]);
        return result(['销售额', '订单数'], [[120, 3]]);
      },
    }),
    listNamedQueries: () => named,
    touchNamedQueryRun: (id, rowCount) => {
      touched.push([id, rowCount]);
    },
    getQueryRunByArtifact: () => runByArtifact,
    startQueryRun: () => ({ id: 'run-1' }) as never,
    finishQueryRun: () => undefined,
    now: () => new Date(2026, 8, 15, 10, 30, 0),
  };
}

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-export-'));
  named = [];
  queries = [];
  touched = [];
  runByArtifact = null;
  setDataToolDeps(deps());
});

afterEach(async () => {
  setDataToolDeps(null);
  await fs.rm(workspace, { recursive: true, force: true });
});

const ctx = (extra: Partial<{ preview: boolean; previewRevision: string }> = {}) => ({
  sessionId: 's1', workspaceRoot: workspace, signal: new AbortController().signal, runId: 'run-x', ...extra,
});

describe('csv helpers', () => {
  it('round-trips through parseCsv and classifies columns', () => {
    const csv = toCsv(['客户', '金额', '编号', '付款时间'], [['a,b', 12.5, '007', '2026-08-01 10:00:00'], ['"q"', -3, '008', '2026-08-02']]);
    const parsed = parseCsv(csv);
    expect(parsed.columns).toEqual(['客户', '金额', '编号', '付款时间']);
    expect(parsed.rows).toEqual([['a,b', '12.5', '007', '2026-08-01 10:00:00'], ['"q"', '-3', '008', '2026-08-02']]);
    expect(classifyCsvColumn(['12.5', '-3'])).toBe('number');
    expect(classifyCsvColumn(['007', '008'])).toBe('text');
    expect(classifyCsvColumn(['2026-08-01 10:00:00', '', '2026-08-02'])).toBe('datetime');
    expect(classifyCsvColumn(['', ''])).toBe('text');
    expect(isoToExcelDate('2026-08-01 10:00:00')?.toISOString()).toBe('2026-08-01T10:00:00.000Z');
    expect(isoToExcelDate('2026-08-01')?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(isoToExcelDate('x')).toBeNull();
  });
});

describe('export_query_result', () => {
  async function writeResultCsv(relativePath = '查询/2026-09-15/103000-测试.csv') {
    const absolute = path.join(workspace, relativePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, toCsv(['客户名称', '销售额', '订单号', '付款时间'], [['星泓科技', 120.5, '007', '2026-08-01 10:00:00'], ['岸边工作室', 30, '008', '2026-08-02 11:30:00']]), 'utf-8');
    return relativePath;
  }

  it('writes an xlsx with typed columns and a 来源 sheet describing the run', async () => {
    const csvPath = await writeResultCsv();
    runByArtifact = {
      id: 'qr-1', runId: null, sourceId: 'src-1', namedQueryId: null, planJson: JSON.stringify(samplePlan()), sql: 'WITH f AS (...) SELECT 1',
      status: 'succeeded', rowCount: 2, durationMs: 12, artifactPath: csvPath, error: null, startedAt: new Date(2026, 8, 15, 10, 30, 0).getTime(), finishedAt: null,
    };
    const exported = await exportQueryResultTool.execute({ csv_path: csvPath, format: 'xlsx', title: '8 月销售' }, ctx());
    expect(exported.success).toBe(true);
    expect(exported.artifacts?.[0].relativePath).toBe('查询/2026-09-15/103000-测试.xlsx');
    expect(exported.metadata).toMatchObject({ kinds: ['text', 'number', 'text', 'datetime'] });

    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(workspace, exported.artifacts![0].relativePath));
    const sheet = workbook.getWorksheet('8 月销售')!;
    expect(sheet.getCell('A1').value).toBe('客户名称');
    expect(sheet.getCell('B2').value).toBe(120.5);
    expect(sheet.getCell('C2').value).toBe('007');
    expect(sheet.getCell('D2').value).toBeInstanceOf(Date);
    expect((sheet.getCell('D2').value as Date).toISOString()).toBe('2026-08-01T10:00:00.000Z');
    expect(sheet.getColumn(4).numFmt).toBe('yyyy-mm-dd hh:mm:ss');
    const about = workbook.getWorksheet('来源')!;
    const pairs = sourceSheetRows({ sourceName: '生产库', summary: 'x', sql: 'y', ranAt: 'z', rowCount: 2 });
    expect(about.getCell('A2').value).toBe(pairs[0][0]);
    expect(about.getCell('B2').value).toBe('生产库');
    expect(String(about.getCell('B3').value)).toContain('我准备这样统计：2026 年 8 月');
    expect(about.getCell('B4').value).toBe('WITH f AS (...) SELECT 1');
    expect(about.getCell('B5').value).toBe('2026-09-15 10:30:00');
    expect(about.getCell('B6').value).toBe('2');
  });

  it('draws a chart through gen_chart and refuses non-numeric or oversized inputs', async () => {
    const csvPath = await writeResultCsv();
    const chart = await exportQueryResultTool.execute(
      { csv_path: csvPath, format: 'chart', chart_type: 'bar', label_column: '客户名称', value_columns: ['销售额'], title: '销售额' },
      ctx(),
    );
    expect(chart.success).toBe(true);
    expect(chart.artifacts?.map((item) => item.relativePath)).toEqual(['查询/2026-09-15/103000-测试.svg', '查询/2026-09-15/103000-测试.png']);
    const svg = await fs.readFile(path.join(workspace, '查询/2026-09-15/103000-测试.svg'), 'utf-8');
    expect(svg).toContain('<desc>来源：查询/2026-09-15/103000-测试.csv（生产库，（未知））</desc>');

    const text = await exportQueryResultTool.execute({ csv_path: csvPath, format: 'chart', chart_type: 'bar', label_column: '客户名称', value_columns: ['订单号'] }, ctx());
    expect(text.success).toBe(false);
    expect(text.error).toContain('不是数字');
    const missing = await exportQueryResultTool.execute({ csv_path: csvPath, format: 'chart', chart_type: 'pie', label_column: '客户名称', value_columns: ['幽灵'] }, ctx());
    expect(missing.error).toContain('不存在的列');

    const big = '查询/big.csv';
    await fs.writeFile(path.join(workspace, big), toCsv(['k', 'v'], Array.from({ length: 51 }, (_, i) => [`k${i}`, i])), 'utf-8');
    const oversized = await exportQueryResultTool.execute({ csv_path: big, format: 'chart', chart_type: 'bar', label_column: 'k', value_columns: ['v'] }, ctx());
    expect(oversized.error).toContain('最多 50 个类目');
    expect((await exportQueryResultTool.execute({ csv_path: '查询/none.csv', format: 'xlsx' }, ctx())).error).toContain('读不到');
  });
});

describe('run_named_query', () => {
  const stored = () => ({ id: 'nq1', name: '月度客户销售额', question: '8 月每个客户的销售额', planJson: JSON.stringify(parameterizePlan(samplePlan())), notes: null, embedding: null });

  it('requires a time range, fills it from a preset and reports which filter values were reused', async () => {
    named.push(stored());
    const missing = await runNamedQueryTool.execute({ name: '月度客户销售额' }, ctx());
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('必须给 time_range');

    const preview = await runNamedQueryTool.execute({ name: '月度客户销售额', time_range: '上月' }, ctx({ preview: true }));
    expect(preview.preview?.kind).toBe('query-plan');
    expect(preview.preview?.summary).toContain('2026 年 8 月');
    expect(queries).toEqual([]);

    const executed = await runNamedQueryTool.execute({ name: '月度客户销售额', time_range: '上月' }, ctx({ previewRevision: preview.preview!.revision }));
    expect(executed.success).toBe(true);
    expect(executed.output).toContain('按命名查询「月度客户销售额」的做法');
    expect(executed.output).toContain('时间范围按这次给的：2026 年 8 月');
    expect(executed.output).toContain('过滤值沿用保存时的「已付款、已退款」');
    expect(touched).toEqual([['nq1', 1]]);
    expect(executed.artifacts?.[0].relativePath).toMatch(/^查询\/2026-09-15\//);
  });

  it('accepts explicit ranges and filter overrides, and rejects unknown names or columns', async () => {
    named.push(stored());
    const explicit = await runNamedQueryTool.execute(
      { name: '月度客户销售额', time_range: { from: '2026-07-01', to: '2026-08-01' }, filters: [{ column: 'orders.status', values: ['2'] }] },
      ctx(),
    );
    expect(explicit.success).toBe(true);
    expect(explicit.output).toContain('2026 年 7 月');
    expect(explicit.output).toContain('只算订单状态在「已付款」之内');
    expect(explicit.output).not.toContain('沿用保存时');

    expect((await runNamedQueryTool.execute({ name: '不存在', time_range: '上月' }, ctx())).error).toContain('没有叫「不存在」的命名查询');
    expect((await runNamedQueryTool.execute({ name: '月度客户销售额', time_range: '随便' }, ctx())).error).toContain('不认识');
    expect((await runNamedQueryTool.execute({ name: '月度客户销售额', time_range: '上月', filters: [{ column: 'orders.region', values: ['华东'] }] }, ctx())).error).toContain('没有对 orders.region 的过滤');
  });
});

describe('time presets / prompts', () => {
  it('resolves relative ranges as left-closed right-open intervals', () => {
    const now = new Date(2026, 8, 15);
    expect(resolveTimePreset('上月', now)).toEqual({ from: '2026-08-01', to: '2026-09-01' });
    expect(resolveTimePreset('本周', now)).toEqual({ from: '2026-09-14', to: '2026-09-21' });
    expect(resolveTimePreset('上周', now)).toEqual({ from: '2026-09-07', to: '2026-09-14' });
    expect(resolveTimePreset('去年', now)).toEqual({ from: '2025-01-01', to: '2026-01-01' });
    expect(resolveTimePreset('最近 7 天', now)).toEqual({ from: '2026-09-09', to: '2026-09-16' });
    expect(resolveTimePreset('最近30天', now)).toEqual({ from: '2026-08-17', to: '2026-09-16' });
    expect(resolveTimePreset('随便', now)).toBeNull();
  });

  it('builds a scheduler prompt that names the tool, the query and the relative range', () => {
    const prompt = buildNamedQueryPrompt({ name: '月度客户销售额', source: '生产库', timeRange: '上月', filters: [{ column: 'orders.status', values: ['2'] }] });
    expect(prompt).toContain('run_named_query');
    expect(prompt).toContain('「月度客户销售额」');
    expect(prompt).toContain('time_range 取「上月」');
    expect(prompt).toContain('"orders.status"');
    expect(prompt).toContain('不要出现表名');
  });
});
