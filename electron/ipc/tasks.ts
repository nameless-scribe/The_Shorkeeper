import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
  updateScheduledTask,
} from '../../src/db/scheduled-tasks';
import type { ScheduleKind, ScheduledTaskInfo } from '../../src/shared/types';
import { notifyTasksChanged } from '../../src/scheduler/task-events';
import {
  requireBoolean,
  requireEnum,
  requireFiniteNumber,
  requireRecord,
  requireString,
} from '../../src/shared/ipc-validation';

function parseNullableRunAt(value: unknown): number | null {
  if (value === null) return null;
  return requireFiniteNumber(value, '执行时间', { min: 0, max: 8_640_000_000_000_000 });
}

function parseTaskInput(value: unknown, partial = false) {
  const input = requireRecord(value, '定时任务参数');
  return {
    name: input.name === undefined && partial
      ? undefined
      : requireString(input.name, '任务名称', { maxLength: 10_000 }),
    scheduleKind: input.scheduleKind === undefined
      ? undefined
      : requireEnum(input.scheduleKind, '调度类型', ['recurring', 'once'] as const),
    cron: input.cron === undefined
      ? undefined
      : requireString(input.cron, 'cron', { allowEmpty: true, maxLength: 500 }),
    runAt: input.runAt === undefined ? undefined : parseNullableRunAt(input.runAt),
    actionType: input.actionType === undefined && partial
      ? undefined
      : requireEnum(input.actionType, '动作类型', ['reminder', 'agent_prompt'] as const),
    actionPayload: input.actionPayload === undefined && partial
      ? undefined
      : requireString(input.actionPayload, '动作内容', { maxLength: 100_000 }),
    enabled: input.enabled === undefined ? undefined : requireBoolean(input.enabled, 'enabled'),
  };
}

function parseTaskCreateInput(value: unknown) {
  const parsed = parseTaskInput(value);
  return {
    ...parsed,
    name: parsed.name!,
    actionType: parsed.actionType!,
    actionPayload: parsed.actionPayload!,
  };
}

export function registerTasksIpc() {
  ipcMain.handle('tasks:list', (): ScheduledTaskInfo[] => listScheduledTasks());

  ipcMain.handle(
    'tasks:create',
    (
      _event,
      input: {
        name: string;
        scheduleKind?: ScheduleKind;
        cron?: string;
        runAt?: number | null;
        actionType: string;
        actionPayload: string;
        enabled?: boolean;
      },
    ) => {
      const task = createScheduledTask(parseTaskCreateInput(input));
      notifyTasksChanged();
      return task;
    },
  );

  ipcMain.handle(
    'tasks:update',
    (
      _event,
      id: string,
      patch: Partial<{
        name: string;
        scheduleKind: ScheduleKind;
        cron: string;
        runAt: number | null;
        actionType: string;
        actionPayload: string;
        enabled: boolean;
      }>,
    ) => {
      const task = updateScheduledTask(
        requireString(id, '定时任务 ID', { maxLength: 200 }),
        parseTaskInput(patch, true),
      );
      notifyTasksChanged();
      return task;
    },
  );

  ipcMain.handle('tasks:delete', (_event, id: string) => {
    deleteScheduledTask(requireString(id, '定时任务 ID', { maxLength: 200 }));
    notifyTasksChanged();
    return { ok: true };
  });
}
