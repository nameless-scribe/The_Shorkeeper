/**
 * propose_query_plan（P7.2，计划 §3.3、§3.9）：模型填好槽位的方案交来校验、定位取值、渲染成业务语言。
 * 不发数据库请求；输出里的方案 JSON 是 run_sql_query 的输入。
 */
import type { ToolDefinition, ToolResult } from '../types';
import { READ_ONLY_CONTRACT } from '../contract';
import { matchNamedQuery } from '../../datasources/named-queries';
import { formatPreparedPlan, preparePlan } from './plan-preparation';
import { getDataToolDeps, resolveSource } from './source-access';

function invalid(error: string): ToolResult {
  return { success: false, output: '', error, errorCategory: 'invalid_arguments' };
}

export const PLAN_PARAMETER_DESCRIPTION =
  '查询方案对象：{ fact: {table}, dimensions: [{table, join}], timeRange?: {column, from, to}（左闭右开 ISO 日期）, filters: [{column: "表.列", op: eq|in|neq|gte|lte|like, values: []}], ' +
  'grain: ["表.列"], metrics: [{name}]（只写已定义指标的名字，口径自动补）, select?: ["表.列"]（清单模式：不聚合直接列行，此时 metrics 与 grain 为空）, compare?: {kind: yoy|mom}, ' +
  'orderBy?: {metric, direction}, limit?: 数字, unresolved: [{slot, question, options}]（还没问清的槽位）, rawSql?: 方案表达不了时的自定义 SELECT（逃生口，尽量别用） }';

export const proposeQueryPlanTool: ToolDefinition = {
  name: 'propose_query_plan',
  description:
    '把填好槽位的查询方案交来校验：核对表列与指标口径、把过滤值定位到字典的登记值、渲染成给用户看的业务语言、标出未确定项。不发数据库请求。方案确认后再用 run_sql_query 执行',
  category: 'doc',
  requiresPermission: [],
  sideEffects: READ_ONLY_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: '数据源名称或 id；只有一个时可省略' },
      plan: { type: 'object', description: PLAN_PARAMETER_DESCRIPTION },
    },
    required: ['plan'],
  },
  async execute(args) {
    const { source: ref, plan } = (args ?? {}) as { source?: string; plan?: unknown };
    if (!plan || typeof plan !== 'object') return invalid('缺少 plan（方案对象）');
    const deps = getDataToolDeps();
    const resolved = resolveSource(ref, deps);
    if ('error' in resolved) return invalid(resolved.error);
    const dictionary = deps.loadDictionary(resolved.source.id);
    if (!Object.keys(dictionary.tables).length) return invalid(`数据源「${resolved.source.name}」还没有读取过结构，先让用户在设置里刷新结构`);
    const prepared = preparePlan(plan, resolved.source.id, dictionary);
    if (!prepared.ok) return invalid(prepared.error);
    const { plan: normalized, rendering, ready, undefinedMetrics, compileError } = prepared.prepared;
    const match = ready ? matchNamedQuery(normalized, deps.listNamedQueries(resolved.source.id)) : null;
    const matchLine = match
      ? match.identical
        ? `- 与命名查询「${match.query.name}」完全相同：可直接执行，回复里注明"按你上次「${match.query.name}」的方式"`
        : `- 形状与命名查询「${match.query.name}」一致，只是时间范围或过滤值不同：回复里注明"按你上次「${match.query.name}」的方式，换成…"`
      : null;
    return {
      success: true,
      output: matchLine ? `${formatPreparedPlan(prepared.prepared)}\n${matchLine}` : formatPreparedPlan(prepared.prepared),
      metadata: {
        namedQuery: match ? { id: match.query.id, name: match.query.name, identical: match.identical } : null,
        sourceId: resolved.source.id,
        ready,
        unresolved: normalized.unresolved.length,
        undefinedMetrics,
        missingNames: rendering.missingNames,
        compileError,
        summary: rendering.summary,
        plan: normalized,
      },
    };
  },
};
