import {
  createScheduledTaskTool,
  deleteScheduledTaskTool,
  listScheduledTasksTool,
} from '../tools/schedule/schedule-tools';
import { listScheduledTasks } from '../db/scheduled-tasks';
import type { ScheduleReminderIntent } from './reminder-intent';

export async function executeScheduleReminderIntent(
  intent: Exclude<ScheduleReminderIntent, { triggered: false }>,
): Promise<string> {
  if (intent.action === 'list') {
    const result = await listScheduledTasksTool.execute({}, {
      sessionId: '',
      workspaceRoot: '',
      signal: new AbortController().signal,
    });
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

    const result = await deleteScheduledTaskTool.execute(
      { id: target.id },
      { sessionId: '', workspaceRoot: '', signal: new AbortController().signal },
    );
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

  const result = await createScheduledTaskTool.execute(payload, {
    sessionId: '',
    workspaceRoot: '',
    signal: new AbortController().signal,
  });

  if (!result.success) {
    return `创建定时提醒失败：${result.error ?? '未知错误'}`;
  }

  return `${result.output}\n\n到点后会由 Shorekeeper 弹出应用内提醒（需保持应用运行）。`;
}
