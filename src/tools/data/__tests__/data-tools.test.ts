import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DataSourceInfo } from '../../../db/repositories/datasources';
import type { QueryResult } from '../../../datasources/mysql-connector';
import type { DataDictionary } from '../../../datasources/dictionary';
import { containsTechnicalTerms } from '../../../datasources/plan-render';
import { JOIN_ORDERS_CUSTOMERS, sampleDictionary } from '../../../datasources/__tests__/fixtures';
import { describeDataSourceTool, listDataSourcesTool } from '../data-source-tools';
import { proposeQueryPlanTool } from '../propose-query-plan';
import { artifactPath, runSqlQueryTool } from '../run-sql-query';
import { updateDataDictionaryTool } from '../update-data-dictionary';
import { saveNamedQueryTool } from '../save-named-query';
import { findValuesTool } from '../find-values';
import { parameterizePlan, type NamedQueryCandidate } from '../../../datasources/named-queries';
import { samplePlan } from '../../../datasources/__tests__/fixtures';
import { describeDateContext, resolveSource, setDataToolDeps, type DataToolDeps } from '../source-access';

const SOURCE: DataSourceInfo = {
  id: 'src-1',
  name: '生产库',
  kind: 'mysql',
  host: '10.0.0.5',
  port: 3306,
  database: 'erp',
  user: 'reader',
  passwordConfigured: true,
  options: {},
  lastOkAt: 1,
  lastError: null,
  writableAccount: false,
  createdAt: 1,
  updatedAt: 1,
};

function result(columns: string[], rows: unknown[][], truncated = false): QueryResult {
  return { columns, rows, truncated, durationMs: 3 };
}

interface FakeState {
  dictionary: DataDictionary;
  queries: string[];
  runs: Array<{ id: string; outcome?: unknown }>;
  metrics: unknown[];
  totals: unknown[];
  explainRows: number;
  queryError?: Error;
  selfCheckError?: Error;
  named: NamedQueryCandidate[];
  embedding: Float32Array | null;
}

function fakeDeps(state: FakeState, sources: DataSourceInfo[] = [SOURCE]): Partial<DataToolDeps> {
  return {
    listSources: () => sources,
    getSource: (id) => sources.find((item) => item.id === id) ?? null,
    loadDictionary: () => state.dictionary,
    getConnector: () => ({
      explain: async () => [{ rows: state.explainRows }],
      query: async (sql: string) => {
        state.queries.push(sql);
        if (state.queryError && !sql.includes('COUNT(*)') && !sql.includes('MIN(') && !/AS `销售额` FROM/.test(sql)) throw state.queryError;
        if (state.selfCheckError && sql.includes('MIN(')) throw state.selfCheckError;
        if (sql.startsWith('WITH')) return result(['name', '销售额', '订单数'], [['星泓科技', 120, 3], ['岸边工作室', 30, 1]]);
        if (sql.includes('COUNT(*)')) return result(['总行数'], [[9]]);
        if (sql.includes('MIN(')) return result(['最早', '最晚'], [['2026-08-01 09:00:00', '2026-08-30 18:00:00']]);
        if (sql.startsWith('SELECT f.`id`')) return result(['id', 'name'], [[1, '星泓科技'], [2, '岸边工作室']], true);
        if (sql.startsWith('SELECT DISTINCT')) {
          if (sql.includes('`name`')) return result(['v'], [['苏运来'], ['苏运来（外包）']]);
          throw Object.assign(new Error('slow'), { code: 'ER_QUERY_TIMEOUT' });
        }
        return result(['销售额', '订单数'], [state.totals]);
      },
    }),
    upsertMetric: (input) => {
      state.metrics.push(input);
      state.dictionary.metrics.push({ name: input.name, sqlFragment: input.sqlFragment, source: input.source });
    },
    updateTableManual: (_sourceId, table, patch) => {
      Object.assign(state.dictionary.tables[table].manual, patch);
      return state.dictionary;
    },
    updateColumnManual: (_sourceId, table, column, patch) => {
      state.dictionary.tables[table].columns[column] = { ...(state.dictionary.tables[table].columns[column] ?? {}), ...patch };
      return state.dictionary;
    },
    startQueryRun: () => {
      const run = { id: `run-${state.runs.length + 1}` };
      state.runs.push(run);
      return { id: run.id } as never;
    },
    finishQueryRun: (id, outcome) => {
      const run = state.runs.find((item) => item.id === id);
      if (run) run.outcome = outcome;
    },
    listNamedQueries: () => state.named,
    saveNamedQuery: (input) => {
      const existing = state.named.find((item) => item.id === input.id);
      const record = { id: input.id ?? `nq-${state.named.length + 1}`, name: input.name, question: input.question, planJson: input.planJson, notes: input.notes, embedding: input.embedding };
      if (existing) Object.assign(existing, record);
      else state.named.push(record);
      return { id: record.id } as never;
    },
    embedQuestion: async () => state.embedding,
    now: () => new Date(2026, 8, 15, 10, 30, 0),
  };
}

const aggregatePlan = {
  fact: { table: 'orders' },
  dimensions: [{ table: 'customers', join: JOIN_ORDERS_CUSTOMERS }],
  timeRange: { column: 'paid_at', from: '2026-08-01', to: '2026-09-01' },
  filters: [{ column: 'orders.status', op: 'in', values: ['已付款', '已退款'] }],
  grain: ['customers.name'],
  metrics: [{ name: '销售额' }, { name: '订单数' }],
  orderBy: { metric: '销售额', direction: 'desc' },
  limit: 100,
};

let workspace: string;
let state: FakeState;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-data-tools-'));
  state = { dictionary: sampleDictionary(), queries: [], runs: [], metrics: [], totals: [150, 4], explainRows: 100, named: [], embedding: null };
  setDataToolDeps(fakeDeps(state));
});

afterEach(async () => {
  setDataToolDeps(null);
  await fs.rm(workspace, { recursive: true, force: true });
});

const ctx = (extra: Partial<{ preview: boolean; previewRevision: string }> = {}) => ({
  sessionId: 's1',
  workspaceRoot: workspace,
  signal: new AbortController().signal,
  runId: 'run-x',
  ...extra,
});

describe('resolveSource / describeDateContext', () => {
  it('resolves by id or name, defaults to the only source and explains when none exists', () => {
    expect(resolveSource(undefined)).toMatchObject({ source: { id: 'src-1' } });
    expect(resolveSource('生产库')).toMatchObject({ source: { id: 'src-1' } });
    expect(resolveSource('src-1')).toMatchObject({ source: { id: 'src-1' } });
    expect(resolveSource('测试库')).toMatchObject({ error: expect.stringContaining('没有叫「测试库」') });
    setDataToolDeps(fakeDeps(state, [SOURCE, { ...SOURCE, id: 'src-2', name: '测试库' }]));
    expect(resolveSource(undefined)).toMatchObject({ error: expect.stringContaining('有 2 个数据源') });
    setDataToolDeps(fakeDeps(state, []));
    expect(resolveSource(undefined)).toMatchObject({ error: expect.stringContaining('尚未配置数据源') });
  });

  it('gives left-closed right-open anchors for today, this month and last month', () => {
    const text = describeDateContext(new Date(2026, 8, 15));
    expect(text).toContain('今天是 2026-09-15（周二）');
    expect(text).toContain('今天 2026-09-15 ~ 2026-09-16');
    expect(text).toContain('本周 2026-09-14 ~ 2026-09-21');
    expect(text).toContain('本月 2026-09-01 ~ 2026-10-01');
    expect(text).toContain('上月 2026-08-01 ~ 2026-09-01');
    expect(text).toContain('今年 2026-01-01 ~ 2027-01-01');
  });
});

describe('list_data_sources / describe_data_source', () => {
  it('lists sources with status and explains when none is configured', async () => {
    const listed = await listDataSourcesTool.execute({}, ctx());
    expect(listed.output).toContain('生产库');
    expect(listed.output).toContain('2 张表');
    setDataToolDeps(fakeDeps(state, []));
    const empty = await listDataSourcesTool.execute({}, ctx());
    expect(empty.success).toBe(true);
    expect(empty.output).toContain('尚未配置数据源');
  });

  it('describes the catalog with date anchors and metrics, then a single table on request', async () => {
    const catalog = await describeDataSourceTool.execute({}, ctx());
    expect(catalog.success).toBe(true);
    expect(catalog.output).toContain('sourceId 填 src-1');
    expect(catalog.output).toContain('今天是 2026-09-15');
    expect(catalog.output).toContain('订单（orders）');
    expect(catalog.output).toContain('销售额');
    const detail = await describeDataSourceTool.execute({ table: 'orders' }, ctx());
    expect(detail.output).toContain('枚举 1=待付款 2=已付款 3=已退款');
    const missing = await describeDataSourceTool.execute({ table: 'ghost' }, ctx());
    expect(missing.success).toBe(false);
  });

  it('tells the model to refresh the schema when the dictionary is empty', async () => {
    state.dictionary = { sourceId: 'src-1', tables: {}, metrics: [] };
    const described = await describeDataSourceTool.execute({}, ctx());
    expect(described.success).toBe(true);
    expect(described.output).toContain('刷新结构');
    const proposed = await proposeQueryPlanTool.execute({ plan: aggregatePlan }, ctx());
    expect(proposed.success).toBe(false);
  });
});

describe('propose_query_plan', () => {
  it('fills metric fragments from the dictionary, locates enum labels and renders business language', async () => {
    const proposed = await proposeQueryPlanTool.execute({ plan: aggregatePlan }, ctx());
    expect(proposed.success).toBe(true);
    expect(proposed.metadata).toMatchObject({ ready: true, unresolved: 0, undefinedMetrics: [] });
    const plan = (proposed.metadata as { plan: { filters: Array<{ values: string[] }>; metrics: Array<{ fragment: string }> } }).plan;
    expect(plan.filters[0].values).toEqual(['2', '3']);
    expect(plan.metrics[0].fragment).toBe('SUM(f.paid_amount - f.refund_amount)');
    const summaryLine = proposed.output.split('\n')[0];
    expect(summaryLine).toContain('2026 年 8 月');
    expect(summaryLine).toContain('已付款、已退款');
    expect(containsTechnicalTerms(summaryLine)).toBe(false);
    expect(proposed.output).toContain('可以执行');
  });

  it('flags undefined metrics and unresolved slots instead of guessing', async () => {
    const proposed = await proposeQueryPlanTool.execute(
      { plan: { ...aggregatePlan, metrics: [{ name: '进度', fragment: 'AVG(f.paid_amount)' }], orderBy: undefined, unresolved: [{ slot: '时间范围', question: '看哪个月？', options: ['本月', '上月'] }] } },
      ctx(),
    );
    expect(proposed.success).toBe(true);
    expect(proposed.metadata).toMatchObject({ ready: false, unresolved: 1, undefinedMetrics: ['进度'] });
    expect(proposed.output).toContain('指标「进度」还没有登记口径');
    expect(proposed.output).toContain('[时间范围] 看哪个月？（选项：本月 / 上月）');
    expect(proposed.output).toContain('还不能执行');
  });

  it('rejects malformed plans and unknown tables with readable errors', async () => {
    expect((await proposeQueryPlanTool.execute({ plan: { fact: { table: 'ghost' }, metrics: [{ name: '销售额' }] } }, ctx())).error).toContain('字典里没有表 ghost');
    expect((await proposeQueryPlanTool.execute({ plan: { fact: { table: 'orders' }, metrics: 'x' } }, ctx())).error).toContain('方案不合规');
    expect((await proposeQueryPlanTool.execute({}, ctx())).errorCategory).toBe('invalid_arguments');
  });
});

describe('run_sql_query', () => {
  it('uses a unique run suffix so same-second results cannot overwrite evidence', () => {
    const now = new Date(2026, 8, 15, 10, 30, 0);
    expect(artifactPath(now, '同一摘要', 'run-a')).not.toBe(artifactPath(now, '同一摘要', 'run-b'));
  });

  it('previews with a business summary and folded SQL, then executes only against the same revision', async () => {
    const preview = await runSqlQueryTool.execute({ plan: aggregatePlan }, ctx({ preview: true }));
    expect(preview.success).toBe(true);
    expect(preview.preview?.kind).toBe('query-plan');
    expect(preview.preview?.summary).toContain('每个客户名称的销售额和订单数');
    expect(preview.preview?.technicalDetails).toContain('WITH f AS');
    expect(containsTechnicalTerms(preview.preview!.summary)).toBe(false);
    expect(preview.artifacts).toBeUndefined();
    expect(state.queries).toEqual([]);

    const stale = await runSqlQueryTool.execute({ plan: aggregatePlan }, ctx({ previewRevision: 'plan:other' }));
    expect(stale.success).toBe(false);
    expect(state.queries).toEqual([]);

    const executed = await runSqlQueryTool.execute({ plan: aggregatePlan }, ctx({ previewRevision: preview.preview!.revision }));
    expect(executed.success).toBe(true);
    expect(executed.artifacts).toHaveLength(1);
    expect(executed.artifacts![0].relativePath).toMatch(/^查询\/2026-09-15\/103000-.*\.csv$/);
    const csv = await fs.readFile(path.join(workspace, executed.artifacts![0].relativePath), 'utf-8');
    expect(csv).toContain('客户名称,销售额,订单数');
    expect(csv).toContain('星泓科技,120,3');
    expect(executed.output).toContain('| 客户名称 | 销售额 | 订单数 |');
    expect(executed.output).toContain('实际有数据的时间是 2026-08-01 到 2026-08-30');
    expect(executed.output).not.toContain('SELECT');
    expect(executed.metadata).toMatchObject({ rowCount: 2, truncated: false, estimatedRows: 100, runRecordId: 'run-1' });
    expect(state.runs[0].outcome).toMatchObject({ status: 'succeeded', rowCount: 2, artifactPath: executed.artifacts![0].relativePath });
  });

  it('withholds results when the self-check fails and records the failure', async () => {
    state.totals = [100, 4];
    const executed = await runSqlQueryTool.execute({ plan: aggregatePlan }, ctx());
    expect(executed.success).toBe(false);
    expect(executed.error).toContain('结果自检没通过');
    expect(executed.error).toContain('销售额：分组相加 150，整体 100');
    expect(executed.artifacts).toBeUndefined();
    expect(state.runs[0].outcome).toMatchObject({ status: 'failed' });
  });

  it('surfaces an incomplete self-check in the model-visible output and metadata', async () => {
    state.selfCheckError = new Error('timeout');
    const executed = await runSqlQueryTool.execute({ plan: aggregatePlan }, ctx());
    expect(executed.success).toBe(true);
    expect(executed.output).toContain('核验状态：未完全核验');
    expect(executed.output).toContain('日期覆盖自动核对未完成');
    expect(executed.metadata).toMatchObject({ complete: true, verification: 'incomplete' });
  });

  it('returns the database error for a rewrite with attempt tracking, and stops after three attempts', async () => {
    state.queryError = Object.assign(new Error("Unknown column 'f.ghost'"), { code: 'ER_BAD_FIELD_ERROR' });
    const first = await runSqlQueryTool.execute({ plan: aggregatePlan }, ctx());
    expect(first.success).toBe(false);
    expect(first.error).toContain('第 1 次');
    expect(first.error).toContain("Unknown column 'f.ghost'");
    expect(first.metadata).toMatchObject({ repairable: true, attempt: 1, phase: 'query' });
    const third = await runSqlQueryTool.execute({ plan: aggregatePlan, attempt: 3 }, ctx());
    expect(third.error).toContain('不再重试');
    expect(third.metadata).toMatchObject({ repairable: false });
  });

  it('refuses heavy queries and unready plans before touching the database', async () => {
    state.explainRows = 3_000_000;
    const heavy = await runSqlQueryTool.execute({ plan: aggregatePlan }, ctx());
    expect(heavy.success).toBe(false);
    expect(heavy.error).toContain('300 万行');
    expect(state.queries).toEqual([]);

    const unready = await runSqlQueryTool.execute({ plan: { ...aggregatePlan, metrics: [{ name: '进度' }], orderBy: undefined } }, ctx());
    expect(unready.success).toBe(false);
    expect(unready.error).toContain('还不能执行');
  });

  it('runs list plans with a row-count note and business column headers', async () => {
    const listPlan = {
      fact: { table: 'orders' },
      dimensions: [{ table: 'customers', join: JOIN_ORDERS_CUSTOMERS }],
      timeRange: { column: 'paid_at', from: '2026-09-01', to: '2026-10-01' },
      filters: [],
      select: ['orders.id', 'customers.name'],
      metrics: [],
      limit: 2,
    };
    state.dictionary.tables.orders.columns.id = { businessName: '订单号' };
    const executed = await runSqlQueryTool.execute({ plan: listPlan }, ctx());
    expect(executed.success).toBe(true);
    expect(executed.output).toContain('| 订单号 | 客户名称 |');
    expect(executed.output).toContain('符合条件的共 9 条，这里只列了前 2 条');
    expect(executed.output).toContain('部分结果文件');
    expect(executed.output).toContain('不是完整结果');
    expect(executed.metadata).toMatchObject({ list: true, truncated: true, complete: false, verification: 'passed' });
  });
});

describe('update_data_dictionary', () => {
  it('writes metrics, table and column manual layers after confirmation', async () => {
    const written = await updateDataDictionaryTool.execute(
      {
        metrics: [{ name: '工时合计', sql_fragment: 'SUM(f.paid_amount)', grain: '报工', notes: '含加班' }],
        tables: [{ table: 'orders', business_name: '销售订单', time_column: 'paid_at' }],
        columns: [{ table: 'orders', column: 'region', business_name: '销售区域', enum_values: { 华东: '华东大区' } }],
      },
      ctx(),
    );
    expect(written.success).toBe(true);
    expect(written.output).toContain('指标「工时合计」');
    expect(state.metrics).toHaveLength(1);
    expect(state.dictionary.tables.orders.manual).toMatchObject({ businessName: '销售订单', timeColumn: 'paid_at' });
    expect(state.dictionary.tables.orders.columns.region).toMatchObject({ businessName: '销售区域', enumValues: { 华东: '华东大区' } });
  });

  it('rejects write-shaped fragments, unknown tables and empty payloads', async () => {
    expect((await updateDataDictionaryTool.execute({ metrics: [{ name: 'x', sql_fragment: 'SUM(f.a); DROP TABLE t' }] }, ctx())).error).toContain('聚合表达式');
    expect((await updateDataDictionaryTool.execute({ tables: [{ table: 'ghost', business_name: 'x' }] }, ctx())).error).toContain('字典里没有表');
    expect((await updateDataDictionaryTool.execute({ tables: [{ table: 'orders', time_column: 'nope' }] }, ctx())).error).toContain('没有列 nope');
    expect((await updateDataDictionaryTool.execute({}, ctx())).error).toContain('没有要写的内容');
    expect(state.metrics).toHaveLength(0);
  });
});

describe('save_named_query / examples / find_values (P7.3)', () => {
  it('saves a parameterised template after the plan is executable and updates by name', async () => {
    const saved = await saveNamedQueryTool.execute({ name: '月度客户销售额', question: '8 月每个客户的销售额', plan: aggregatePlan, notes: '含税' }, ctx());
    expect(saved.success).toBe(true);
    expect(saved.output).toContain('已保存命名查询「月度客户销售额」');
    expect(saved.output).toContain('时间范围与 1 处过滤值已抽成槽位');
    expect(saved.output).toContain('相似检索按关键词');
    expect(state.named).toHaveLength(1);
    const payload = JSON.parse(state.named[0].planJson) as { template: { timeRange: { from: string } }; exampleSlots: { filterValues: string[][] } };
    expect(payload.template.timeRange.from).toBe('{{time_from}}');
    expect(payload.exampleSlots.filterValues).toEqual([['2', '3']]);

    const again = await saveNamedQueryTool.execute({ name: '月度客户销售额', question: '8 月每个客户的销售额', plan: aggregatePlan, notes: '不含税' }, ctx());
    expect(again.output).toContain('已更新');
    expect(state.named).toHaveLength(1);
    expect(state.named[0].notes).toBe('不含税');

    const unready = await saveNamedQueryTool.execute({ name: 'x', question: 'q', plan: { ...aggregatePlan, metrics: [{ name: '进度' }], orderBy: undefined } }, ctx());
    expect(unready.success).toBe(false);
    expect(unready.error).toContain('只有能执行的方案才能保存');
  });

  it('injects similar named queries as examples and reports shape or slot matches', async () => {
    state.named.push({ id: 'nq1', name: '月度客户销售额', question: '8 月每个客户的销售额', planJson: JSON.stringify(parameterizePlan(samplePlan())), notes: '含税', embedding: null });
    const described = await describeDataSourceTool.execute({ question: '9 月每个客户的销售额' }, ctx());
    expect(described.output).toContain('相似的过往查询');
    expect(described.output).toContain('命名查询「月度客户销售额」');
    expect(described.output).toContain('按当前问题填');
    expect(described.metadata).toMatchObject({ examples: 1 });

    const identical = await proposeQueryPlanTool.execute({ plan: aggregatePlan }, ctx());
    expect(identical.output).toContain('与命名查询「月度客户销售额」完全相同');
    expect(identical.metadata).toMatchObject({ namedQuery: { id: 'nq1', identical: true } });

    const shifted = await proposeQueryPlanTool.execute({ plan: { ...aggregatePlan, timeRange: { column: 'paid_at', from: '2026-09-01', to: '2026-10-01' } } }, ctx());
    expect(shifted.output).toContain('形状与命名查询「月度客户销售额」一致');
    expect(shifted.metadata).toMatchObject({ namedQuery: { identical: false } });

    const unrelated = await describeDataSourceTool.execute({ question: '库存盘点' }, ctx());
    expect(unrelated.output).not.toContain('相似的过往查询');
  });

  it('probes text columns without value tables by containment and reports per-column matches', async () => {
    const found = await findValuesTool.execute({ table: 'customers', value: '苏运来' }, ctx());
    expect(found.success).toBe(true);
    expect(found.output).toContain('客户名称（name）：「苏运来」 「苏运来（外包）」');
    expect(found.output).toContain('多个匹配');
    expect(state.queries.some((sql) => sql.includes("LIKE ?") && sql.includes('LIMIT 6'))).toBe(true);
    // region 有取值表，不探测；status 是 tinyint，不探测
    const none = await findValuesTool.execute({ table: 'orders', value: '华东' }, ctx());
    expect(none.success).toBe(false);
    expect(none.error).toContain('没有可探测的文本列');
    expect((await findValuesTool.execute({ table: 'customers', value: '50%' }, ctx())).error).toContain('不要带');
    expect((await findValuesTool.execute({ table: 'ghost', value: 'x' }, ctx())).error).toContain('字典里没有表');
  });
});
