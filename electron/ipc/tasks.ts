import { ipcMain } from 'electron';
import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
  updateScheduledTask,
} from '../../src/db/scheduled-tasks';
import type { ScheduledTaskInfo } from '../../src/shared/types';
import { reloadScheduler } from '../scheduler/cron';

export function registerTasksIpc() {
  ipcMain.handle('tasks:list', (): ScheduledTaskInfo[] => listScheduledTasks());

  ipcMain.handle(
    'tasks:create',
    (
      _event,
      input: {
        name: string;
        cron: string;
        actionType: string;
        actionPayload: string;
        enabled?: boolean;
      },
    ) => {
      const task = createScheduledTask(input);
      reloadScheduler();
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
        cron: string;
        actionType: string;
        actionPayload: string;
        enabled: boolean;
      }>,
    ) => {
      const task = updateScheduledTask(id, patch);
      reloadScheduler();
      return task;
    },
  );

  ipcMain.handle('tasks:delete', (_event, id: string) => {
    deleteScheduledTask(id);
    reloadScheduler();
    return { ok: true };
  });
}
