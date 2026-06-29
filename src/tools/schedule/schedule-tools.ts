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
  requiresPermission: [],
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
    },
    required: ['name', 'schedule_kind', 'message'],
  },
  async execute(args) {
    const { name, schedule_kind, cron: cronExpr, run_at, message } = args as {
      name?: string;
      schedule_kind?: ScheduleKind;
      cron?: string;
      run_at?: string;
      message?: string;
    };

    if (!name?.trim() || !message?.trim()) {
      return { success: false, output: '', error: '缺少 name 或 message 参数' };
    }

    const scheduleKind: ScheduleKind =
      schedule_kind === 'once' ? 'once' : schedule_kind === 'recurring' ? 'recurring' : 'recurring';

    if (schedule_kind !== 'once' && schedule_kind !== 'recurring') {
      return {
        success: false,
        output: '',
        error: 'schedule_kind 必须是 recurring 或 once',
      };
    }

    let runAt: number | null = null;
    if (scheduleKind === 'once') {
      if (!run_at?.trim()) {
        return { success: false, output: '', error: '一次性任务需要 run_at（ISO 时间）' };
      }
      runAt = parseRunAtIso(run_at);
      if (runAt === null) {
        return { success: false, output: '', error: `无法解析 run_at: ${run_at}` };
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

    try {
      const task = createScheduledTask({
        name: name.trim(),
        scheduleKind,
        cron: scheduleKind === 'recurring' ? cronExpr!.trim() : '',
        runAt,
        actionType: 'reminder',
        actionPayload: JSON.stringify({ message: message.trim() }),
        enabled: true,
      });

      notifyTasksChanged();

      return {
        success: true,
        output: `已创建${scheduleKind === 'once' ? '一次性' : '周期性'}任务「${task.name}」（id: ${task.id}），${formatScheduleLabel(task)}。可在日程面板查看。`,
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
  requiresPermission: [],
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
    notifyTasksChanged();

    return { success: true, output: `已删除定时任务「${target.name}」。` };
  },
};
