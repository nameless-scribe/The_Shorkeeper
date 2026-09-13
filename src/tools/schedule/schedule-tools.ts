import cron from 'node-cron';
import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
} from '../../db/scheduled-tasks';
import { notifyTasksChanged } from '../../scheduler/task-events';
import { formatScheduleLabel, parseRunAtIso } from '../../scheduler/format';
import type { ScheduleKind } from '../../shared/types';
import type { ToolDefinition } from '../types';
import { READ_ONLY_CONTRACT } from '../contract';
import {
  cancelCommitmentForScheduledTask,
  createCommitment,
} from '../../db/repositories/commitments';

function validateCron(expression: string): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return 'cron 表达式不能为空';
  if (!cron.validate(trimmed)) return `无效的 cron 表达式: ${trimmed}`;
  return null;
}

function formatTaskList(): string {
  const tasks = listScheduledTasks();
  if (!tasks.length) return '当前没有定时任务。';

  return tasks
    .map(
      (t) =>
        `- [${t.enabled ? '启用' : '停用'}] ${t.name} (id: ${t.id})\n  调度: ${formatScheduleLabel(t)}\n  类型: ${t.actionType}`,
    )
    .join('\n');
}

export const createScheduledTaskTool: ToolDefinition = {
  name: 'create_scheduled_task',
  description:
    '创建定时提醒。区分两种：recurring=每天/周期性重复；once=指定时间只提醒一次。action 固定为 reminder 系统通知。',
  category: 'life',
  requiresPermission: ['automation'],
  sideEffects: {
    risk: 'medium',
    idempotent: false,
    supportsPreview: false,
    reversible: 'manual',
    evidence: 'output',
  },
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '任务名称' },
      schedule_kind: {
        type: 'string',
        description: 'recurring=周期性（需 cron）；once=仅执行一次（需 run_at）',
        enum: ['recurring', 'once'],
      },
      cron: {
        type: 'string',
        description: 'schedule_kind=recurring 时必填，如 "0 9 * * *" 表示每天 9:00',
      },
      run_at: {
        type: 'string',
        description:
          'schedule_kind=once 时必填，ISO 本地时间，如 "2026-06-30T15:00:00" 表示 6 月 30 日 15:00',
      },
      message: { type: 'string', description: '到点弹出的提醒正文' },
      idempotency_key: {
        type: 'string',
        description: '可选的重试幂等键；相同幂等键不会重复创建任务',
      },
    },
    required: ['name', 'schedule_kind', 'message'],
  },
  async execute(args, ctx) {
    const raw = args as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name : undefined;
    const message = typeof raw.message === 'string' ? raw.message : undefined;
    const scheduleKindRaw =
      typeof raw.schedule_kind === 'string'
        ? raw.schedule_kind
        : typeof raw.scheduleKind === 'string'
          ? raw.scheduleKind
          : undefined;
    const cronExpr =
      typeof raw.cron === 'string' ? raw.cron : undefined;
    const runAtRaw =
      typeof raw.run_at === 'string'
        ? raw.run_at
        : typeof raw.runAt === 'string'
          ? raw.runAt
          : undefined;
    const idempotencyKey = typeof raw.idempotency_key === 'string'
      ? raw.idempotency_key.trim()
      : '';

    if (!name?.trim() || !message?.trim()) {
      return { success: false, output: '', error: '缺少 name 或 message 参数' };
    }

    let scheduleKind: ScheduleKind;
    if (scheduleKindRaw === 'once') {
      scheduleKind = 'once';
    } else if (scheduleKindRaw === 'recurring') {
      scheduleKind = 'recurring';
    } else if (runAtRaw?.trim()) {
      scheduleKind = 'once';
    } else if (cronExpr?.trim()) {
      scheduleKind = 'recurring';
    } else {
      return {
        success: false,
        output: '',
        error: '需要 schedule_kind（recurring 或 once），或提供 cron / run_at',
      };
    }

    let runAt: number | null = null;
    if (scheduleKind === 'once') {
      if (!runAtRaw?.trim()) {
        return { success: false, output: '', error: '一次性任务需要 run_at（ISO 时间，如 2026-06-30T10:00:00）' };
      }
      runAt = parseRunAtIso(runAtRaw);
      if (runAt === null) {
        return { success: false, output: '', error: `无法解析 run_at: ${runAtRaw}（请用 ISO 格式并包含日期）` };
      }
    } else {
      if (!cronExpr?.trim()) {
        return { success: false, output: '', error: '周期任务需要 cron 表达式' };
      }
      const cronError = validateCron(cronExpr);
      if (cronError) {
        return { success: false, output: '', error: cronError };
      }
    }

    if (idempotencyKey) {
      const existing = listScheduledTasks().find((task) => {
        if (!task.enabled) return false;
        try {
          const payload = JSON.parse(task.actionPayload) as Record<string, unknown>;
          return payload._shorekeeper_idempotency_key === idempotencyKey;
        } catch {
          return false;
        }
      });
      if (existing) {
        return {
          success: true,
          output: `定时任务已存在，未重复创建：「${existing.name}」（id: ${existing.id}）。`,
          metadata: { idempotent: true, taskId: existing.id },
        };
      }
    }

    try {
      const task = createScheduledTask({
        name: name.trim(),
        scheduleKind,
        cron: scheduleKind === 'recurring' ? cronExpr!.trim() : '',
        runAt,
        actionType: 'reminder',
        actionPayload: JSON.stringify({
          message: message.trim(),
          ...(idempotencyKey ? { _shorekeeper_idempotency_key: idempotencyKey } : {}),
        }),
        enabled: true,
      });

      // 助理答应了"到点提醒你"，这本身是一条承诺；一次性提醒到期弹窗后自动完成。
      try {
        createCommitment({
          title: `提醒：${task.name}`,
          owner: 'assistant',
          dueAt: task.runAt,
          scheduledTaskId: task.id,
          sourceSessionId: ctx?.sessionId || null,
          sourceRunId: ctx?.runId ?? null,
        });
      } catch (error) {
        console.warn('[schedule] 助理承诺记录失败:', error instanceof Error ? error.message : error);
      }

      notifyTasksChanged();

      return {
        success: true,
        output: `已创建${scheduleKind === 'once' ? '一次性' : '周期性'}任务「${task.name}」（id: ${task.id}），${formatScheduleLabel(task)}。可在日程面板查看。`,
        metadata: { taskId: task.id },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: msg };
    }
  },
};

export const listScheduledTasksTool: ToolDefinition = {
  name: 'list_scheduled_tasks',
  description: '列出所有定时任务，用于确认已有任务或获取 id 以便删除',
  category: 'life',
  requiresPermission: [],
  sideEffects: READ_ONLY_CONTRACT,
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute() {
    return { success: true, output: formatTaskList() };
  },
};

export const deleteScheduledTaskTool: ToolDefinition = {
  name: 'delete_scheduled_task',
  description: '按 id 删除定时任务。删除前可先 list_scheduled_tasks 获取 id。',
  category: 'life',
  requiresPermission: ['automation'],
  sideEffects: {
    risk: 'medium',
    idempotent: true,
    supportsPreview: false,
    reversible: 'none',
    evidence: 'output',
  },
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '任务 id（list_scheduled_tasks 返回）' },
    },
    required: ['id'],
  },
  async execute(args) {
    const { id } = args as { id?: string };
    if (!id?.trim()) {
      return { success: false, output: '', error: '缺少 id 参数' };
    }

    const tasks = listScheduledTasks();
    const target = tasks.find((t) => t.id === id.trim());
    if (!target) {
      return { success: false, output: '', error: `未找到 id 为 ${id} 的任务` };
    }

    deleteScheduledTask(id.trim());
    try {
      cancelCommitmentForScheduledTask(id.trim());
    } catch (error) {
      console.warn('[schedule] 取消助理承诺失败:', error instanceof Error ? error.message : error);
    }
    notifyTasksChanged();

    return { success: true, output: `已删除定时任务「${target.name}」。` };
  },
};
