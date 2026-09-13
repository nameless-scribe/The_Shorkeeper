import {
  createScheduledTaskTool,
  deleteScheduledTaskTool,
  listScheduledTasksTool,
} from '../tools/schedule/schedule-tools';
import { listScheduledTasks } from '../db/scheduled-tasks';
import { normalizeToolResult } from '../tools/result';
import type { ToolContext, ToolDefinition, ToolResult } from '../tools/types';
import type { ScheduleReminderIntent } from './reminder-intent';
import {
  defaultPermissionPolicy,
  resolveToolPermission,
} from '../agent/permissions';

export interface ReminderIntentContext {
  runId?: string;
  sessionId?: string;
  /** 快捷路径绕过 Agent 主循环，由调用方据此把工具执行写入运行记录。 */
  onToolStart?: (toolName: string, tool: ToolDefinition) => void;
  onToolResult?: (toolName: string, result: ToolResult) => void;
}

async function runQuickPathTool(
  tool: ToolDefinition,
  args: unknown,
  signal: AbortSignal | undefined,
  context: ReminderIntentContext | undefined,
): Promise<ToolResult> {
  const toolCtx: ToolContext = {
    sessionId: context?.sessionId ?? '',
    workspaceRoot: '',
    signal: signal ?? new AbortController().signal,
    runId: context?.runId,
  };
  context?.onToolStart?.(tool.name, tool);
  let result: ToolResult;
  try {
    result = normalizeToolResult(await tool.execute(args, toolCtx));
  } catch (error) {
    result = normalizeToolResult({
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  context?.onToolResult?.(tool.name, result);
  return result;
}

export async function executeScheduleReminderIntent(
  intent: Exclude<ScheduleReminderIntent, { triggered: false }>,
  signal?: AbortSignal,
  context?: ReminderIntentContext,
): Promise<string> {
  const permissionContext = { runId: context?.runId, sessionId: context?.sessionId };

  if (intent.action === 'list') {
    const result = await runQuickPathTool(listScheduledTasksTool, {}, signal, context);
    return result.success ? result.output : `查询失败：${result.error ?? '未知错误'}`;
  }

  if (intent.action === 'delete') {
    const tasks = listScheduledTasks();
    const target = tasks.find(
      (task) =>
        task.name.includes(intent.nameHint) ||
        task.actionPayload.includes(intent.nameHint),
    );

    if (!target) {
      return `未找到名称或内容包含「${intent.nameHint}」的定时任务。可先让我列出当前任务。`;
    }

    const args = { id: target.id };
    const permission = await resolveToolPermission(
      deleteScheduledTaskTool,
      defaultPermissionPolicy(),
      args,
      signal,
      permissionContext,
    );
    if (permission === 'deny') return '已取消删除定时任务。';

    const result = await runQuickPathTool(deleteScheduledTaskTool, args, signal, context);
    return result.success ? result.output : `删除失败：${result.error ?? '未知错误'}`;
  }

  const payload: Record<string, unknown> = {
    name: intent.name,
    message: intent.message,
    schedule_kind: intent.scheduleKind,
  };

  if (intent.scheduleKind === 'recurring') {
    payload.cron = intent.cron;
  } else {
    const runAt = intent.runAt;
    if (!runAt) {
      return '无法解析一次性提醒时间，请说明具体日期。';
    }
    const d = new Date(runAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    payload.run_at = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  }
  payload.idempotency_key = [
    'natural-reminder',
    intent.scheduleKind,
    intent.name.trim(),
    intent.message.trim(),
    intent.cron ?? intent.runAt ?? '',
  ].join(':');

  const permission = await resolveToolPermission(
    createScheduledTaskTool,
    defaultPermissionPolicy(),
    payload,
    signal,
    permissionContext,
  );
  if (permission === 'deny') return '已取消创建定时提醒。';

  const result = await runQuickPathTool(createScheduledTaskTool, payload, signal, context);

  if (!result.success) {
    return `创建定时提醒失败：${result.error ?? '未知错误'}`;
  }

  return `${result.output}\n\n到点后会由 Shorekeeper 弹出应用内提醒（需保持应用运行）。`;
}
