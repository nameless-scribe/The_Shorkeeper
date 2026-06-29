import { ipcMain } from 'electron';
import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
  updateScheduledTask,
} from '../../src/db/scheduled-tasks';
import type { ScheduleKind, ScheduledTaskInfo } from '../../src/shared/types';
import { notifyTasksChanged } from '../../src/scheduler/task-events';

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
      const task = createScheduledTask(input);
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
      const task = updateScheduledTask(id, patch);
      notifyTasksChanged();
      return task;
    },
  );

  ipcMain.handle('tasks:delete', (_event, id: string) => {
    deleteScheduledTask(id);
    notifyTasksChanged();
    return { ok: true };
  });
}
