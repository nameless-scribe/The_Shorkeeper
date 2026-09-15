/**
 * schedule_named_query（P7.5）：把命名查询挂到 P3 定时任务上，到点由助理跑 run_named_query 并把产物路径告诉用户。
 * 任务是 agent_prompt 类型，payload 记下 namedQueryId 与 sourceId：数据源被删时按它停用任务。
 */
import cron from 'node-cron';
import type { ToolDefinition, ToolResult } from '../types';
import { createScheduledTask, listScheduledTasks } from '../../db/scheduled-tasks';
import { notifyTasksChanged } from '../../scheduler/task-events';
import { NAMED_QUERY_TASK_KIND } from '../../datasources/scheduled-named-queries';
import { getDataToolDeps, resolveSource, TIME_PRESETS } from './source-access';

function invalid(error: string): ToolResult {
  return { success: false, output: '', error, errorCategory: 'invalid_arguments' };
}

export function buildNamedQueryPrompt(input: { name: string; source: string; timeRange: string; filters?: Array<{ column: string; values: string[] }> }): string {
  const parts = [
    `请用 run_named_query 跑命名查询「${input.name}」（数据源「${input.source}」），time_range 取「${input.timeRange}」`,
  ];
  if (input.filters?.length) parts.push(`，filters 取 ${JSON.stringify(input.filters)}`);
  parts.push('。跑完用一两句话说结论，并给出结果文件的路径；不要出现表名、列名、SQL。');
  return parts.join('');
}

export const scheduleNamedQueryTool: ToolDefinition = {
  name: 'schedule_named_query',
  description:
    '把一条命名查询设为定时重跑（如每月 1 号 9 点跑"上月"的月度销售额）：到点助理会执行并把结果文件告诉用户。只能挂已保存的命名查询',
  category: 'doc',
  requiresPermission: ['automation'],
  sideEffects: { risk: 'medium', idempotent: false, supportsPreview: false, reversible: 'manual', evidence: 'output' },
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: '数据源名称或 id；只有一个时可省略' },
      name: { type: 'string', description: '命名查询的名字' },
      cron: { type: 'string', description: 'cron 表达式，如 "0 9 1 * *" 表示每月 1 号 9:00' },
      time_range: { type: 'string', description: `每次重跑用的相对时间范围：${TIME_PRESETS.join(' / ')}` },
      filters: {
        type: 'array',
        description: '每次重跑覆盖的过滤值（可选）',
        items: { type: 'object', properties: { column: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } }, required: ['column', 'values'] },
      },
      task_name: { type: 'string', description: '定时任务的名字；省略则用命名查询的名字' },
    },
    required: ['name', 'cron', 'time_range'],
  },
  async execute(args) {
    const { source: ref, name, cron: cronExpr, time_range, filters, task_name } = (args ?? {}) as {
      source?: string;
      name?: string;
      cron?: string;
      time_range?: string;
      filters?: Array<{ column?: unknown; values?: unknown }>;
      task_name?: string;
    };
    const queryName = typeof name === 'string' ? name.trim() : '';
    if (!queryName) return invalid('缺少 name（命名查询的名字）');
    const expression = typeof cronExpr === 'string' ? cronExpr.trim() : '';
    if (!expression || !cron.validate(expression)) return invalid(`无效的 cron 表达式：${expression || '（空）'}`);
    const timeRange = typeof time_range === 'string' ? time_range.trim() : '';
    if (!(TIME_PRESETS as readonly string[]).includes(timeRange)) return invalid(`time_range 须为 ${TIME_PRESETS.join(' / ')} 之一（定时重跑只能用相对时间）`);
    const deps = getDataToolDeps();
    const resolved = resolveSource(ref, deps);
    if ('error' in resolved) return invalid(resolved.error);
    const source = resolved.source;
    const named = deps.listNamedQueries(source.id).find((item) => item.name === queryName);
    if (!named) return invalid(`没有叫「${queryName}」的命名查询；先查一次并用 save_named_query 保存`);
    const cleanFilters: Array<{ column: string; values: string[] }> = [];
    for (const item of Array.isArray(filters) ? filters : []) {
      if (typeof item?.column !== 'string' || !Array.isArray(item.values) || item.values.some((value) => typeof value !== 'string')) {
        return invalid('filters 每项须为 { column, values[] }');
      }
      cleanFilters.push({ column: item.column, values: item.values as string[] });
    }
    const taskName = (typeof task_name === 'string' && task_name.trim()) || `定时查询：${queryName}`;
    const duplicate = listScheduledTasks().find((task) => {
      if (!task.enabled || task.actionType !== 'agent_prompt') return false;
      try {
        const payload = JSON.parse(task.actionPayload) as Record<string, unknown>;
        return payload._shorekeeper_kind === NAMED_QUERY_TASK_KIND && payload.namedQueryId === named.id && task.cron === expression && payload.timeRange === timeRange;
      } catch {
        return false;
      }
    });
    if (duplicate) {
      return { success: true, output: `已有同样的定时任务「${duplicate.name}」（id: ${duplicate.id}），未重复创建`, metadata: { taskId: duplicate.id, idempotent: true } };
    }
    const task = createScheduledTask({
      name: taskName,
      scheduleKind: 'recurring',
      cron: expression,
      actionType: 'agent_prompt',
      actionPayload: JSON.stringify({
        prompt: buildNamedQueryPrompt({ name: queryName, source: source.name, timeRange, filters: cleanFilters }),
        _shorekeeper_kind: NAMED_QUERY_TASK_KIND,
        namedQueryId: named.id,
        sourceId: source.id,
        timeRange,
        ...(cleanFilters.length ? { filters: cleanFilters } : {}),
      }),
      enabled: true,
    });
    notifyTasksChanged();
    return {
      success: true,
      output: `已设定时任务「${task.name}」（id: ${task.id}）：按 ${expression} 重跑命名查询「${queryName}」，时间范围每次取「${timeRange}」。数据源被删除时任务会自动停用`,
      metadata: { taskId: task.id, namedQueryId: named.id, sourceId: source.id },
    };
  },
};
