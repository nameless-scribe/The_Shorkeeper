/**
 * run_named_query（P7.5，计划 §3.6、§4 P7.5）：按保存的做法重跑，槽位取自这次的参数。
 * 时间范围必须给（相对说法或起止日期），不沿用保存时的值；过滤值没给才沿用保存时的，并在结果里说明。
 * 与 run_sql_query 同一条执行路径（预览 → 确认 → 执行 → CSV），产物按日期命名。
 */
import type { ToolDefinition, ToolResult } from '../types';
import { enumLabel } from '../../datasources/dictionary';
import { instantiateTemplate, parseNamedQueryPayload } from '../../datasources/named-queries';
import { splitQualifiedColumn } from '../../datasources/query-plan';
import { describeTimeRange } from '../../datasources/plan-render';
import { DEFAULT_MAX_ROWS, HARD_MAX_ROWS } from '../../datasources/mysql-connector';
import { preparePlan } from './plan-preparation';
import { attemptNumber, clampMaxRows, executePreparedPlan, previewPreparedPlan, RUN_SQL_QUERY_CONTRACT } from './run-sql-query';
import { getDataToolDeps, resolveSource, resolveTimePreset, TIME_PRESETS } from './source-access';

function invalid(error: string): ToolResult {
  return { success: false, output: '', error, errorCategory: 'invalid_arguments' };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const runNamedQueryTool: ToolDefinition = {
  name: 'run_named_query',
  description:
    '按保存过的命名查询重跑一次（做法不变，时间范围按这次给的填）：time_range 写 上月 / 本月 / 昨天 这类说法或起止日期；过滤值可按列覆盖。用于定时重跑与"再跑一次上次那个"',
  category: 'doc',
  requiresPermission: ['filesystem:write'],
  sideEffects: RUN_SQL_QUERY_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: '数据源名称或 id；只有一个时可省略' },
      name: { type: 'string', description: '命名查询的名字' },
      time_range: {
        description: `时间范围：${TIME_PRESETS.join(' / ')} 之一，或 { from, to }（ISO 日期，左闭右开）。命名查询带时间范围时必填`,
        oneOf: [{ type: 'string' }, { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } }],
      },
      filters: {
        type: 'array',
        description: '按列覆盖过滤值：[{ column: "表.列", values: [] }]；没给的沿用保存时的值',
        items: { type: 'object', properties: { column: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } }, required: ['column', 'values'] },
      },
      max_rows: { type: 'number', description: `最多返回多少行（默认 ${DEFAULT_MAX_ROWS}，上限 ${HARD_MAX_ROWS}）` },
      attempt: { type: 'number', description: '数据库报错后重试时填第几次' },
    },
    required: ['name'],
  },
  async execute(args, ctx) {
    const { source: ref, name, time_range, filters, max_rows, attempt } = (args ?? {}) as {
      source?: string;
      name?: string;
      time_range?: unknown;
      filters?: Array<{ column?: unknown; values?: unknown }>;
      max_rows?: number;
      attempt?: number;
    };
    const queryName = typeof name === 'string' ? name.trim() : '';
    if (!queryName) return invalid('缺少 name（命名查询的名字）');
    const deps = getDataToolDeps();
    const resolved = resolveSource(ref, deps);
    if ('error' in resolved) return invalid(resolved.error);
    const source = resolved.source;
    const named = deps.listNamedQueries(source.id).find((item) => item.name === queryName);
    if (!named) {
      const names = deps.listNamedQueries(source.id).map((item) => item.name);
      return invalid(`没有叫「${queryName}」的命名查询${names.length ? `；现有：${names.join(' / ')}` : '；还没有保存过任何命名查询'}`);
    }
    const payload = parseNamedQueryPayload(named.planJson);
    if (!payload) return invalid(`命名查询「${queryName}」是旧格式，无法重跑；请重新查一次并保存`);

    const notes: string[] = [];
    let timeRange: { from: string; to: string } | undefined;
    if (payload.template.timeRange) {
      if (typeof time_range === 'string' && time_range.trim()) {
        const preset = resolveTimePreset(time_range.trim(), deps.now());
        if (!preset) return invalid(`time_range「${time_range}」不认识：用 ${TIME_PRESETS.join(' / ')} 或 { from, to }`);
        timeRange = preset;
      } else if (time_range && typeof time_range === 'object') {
        const range = time_range as { from?: unknown; to?: unknown };
        if (typeof range.from !== 'string' || typeof range.to !== 'string' || !ISO_DATE.test(range.from) || !ISO_DATE.test(range.to) || range.from >= range.to) {
          return invalid('time_range 的 from / to 须为 ISO 日期且 from < to');
        }
        timeRange = { from: range.from, to: range.to };
      } else {
        return invalid(`命名查询「${queryName}」带时间范围，重跑必须给 time_range（${TIME_PRESETS.join(' / ')} 或起止日期），不沿用上次的值`);
      }
      notes.push(`时间范围按这次给的：${describeTimeRange(timeRange.from, timeRange.to)}`);
    }

    const filterValues = payload.exampleSlots.filterValues.map((values) => [...values]);
    const overrides = Array.isArray(filters) ? filters : [];
    for (const override of overrides) {
      const column = typeof override?.column === 'string' ? override.column.trim() : '';
      const index = payload.template.filters.findIndex((filter) => filter.column === column);
      if (index < 0) return invalid(`命名查询「${queryName}」里没有对 ${column || '?'} 的过滤，不能覆盖`);
      if (!Array.isArray(override.values) || !override.values.length || override.values.some((value) => typeof value !== 'string')) {
        return invalid(`过滤 ${column} 的 values 须为非空字符串数组`);
      }
      filterValues[index] = override.values as string[];
    }
    const dictionary = deps.loadDictionary(source.id);
    payload.template.filters.forEach((filter, index) => {
      if (!overrides.some((override) => override?.column === filter.column) && filterValues[index]?.length) {
        const { table, column } = splitQualifiedColumn(filter.column);
        notes.push(`过滤值沿用保存时的「${filterValues[index].map((value) => enumLabel(dictionary, table, column, value)).join('、')}」`);
      }
    });

    const plan = instantiateTemplate(payload.template, { ...(timeRange ? { timeRange } : {}), filterValues });
    const preparedResult = preparePlan(plan, source.id, dictionary);
    if (!preparedResult.ok) return invalid(`命名查询「${queryName}」已不能执行：${preparedResult.error}`);
    const prepared = preparedResult.prepared;
    if (!prepared.ready || !prepared.compiled) {
      return invalid(`命名查询「${queryName}」已不能执行：${prepared.compileError ?? prepared.warnings.join('；') ?? '方案有未确定项'}；请重新查一次并保存`);
    }
    if (ctx.preview) return previewPreparedPlan(prepared, source);
    return executePreparedPlan(prepared, source, dictionary, ctx, {
      maxRows: clampMaxRows(max_rows, prepared.plan.limit),
      attempt: attemptNumber(attempt),
      extraNotes: [`按命名查询「${queryName}」的做法`, ...notes],
      onSuccess: (rowCount) => deps.touchNamedQueryRun(named.id, rowCount),
    });
  },
};
