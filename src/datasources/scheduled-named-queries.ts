/**
 * 命名查询的定时任务（P7.5）：数据源被删时，挂在它上面的任务停用并留提示。
 */
import { listScheduledTasks, markTaskFailure, updateScheduledTask } from '../db/scheduled-tasks';

export const NAMED_QUERY_TASK_KIND = 'named_query';

export function namedQueryTaskPayload(actionPayload: string): { namedQueryId?: string; sourceId?: string } | null {
  try {
    const payload = JSON.parse(actionPayload) as Record<string, unknown>;
    if (payload._shorekeeper_kind !== NAMED_QUERY_TASK_KIND) return null;
    return {
      ...(typeof payload.namedQueryId === 'string' ? { namedQueryId: payload.namedQueryId } : {}),
      ...(typeof payload.sourceId === 'string' ? { sourceId: payload.sourceId } : {}),
    };
  } catch {
    return null;
  }
}

/** 返回停用的任务名 */
export function disableNamedQueryTasksForSource(sourceId: string, sourceName?: string): string[] {
  const disabled: string[] = [];
  for (const task of listScheduledTasks()) {
    if (task.actionType !== 'agent_prompt' || !task.enabled) continue;
    const payload = namedQueryTaskPayload(task.actionPayload);
    if (!payload || payload.sourceId !== sourceId) continue;
    updateScheduledTask(task.id, { enabled: false });
    markTaskFailure(task.id, `数据源${sourceName ? `「${sourceName}」` : ''}已删除，任务已停用`);
    disabled.push(task.name);
  }
  return disabled;
}
