import { BrowserWindow, ipcMain } from 'electron';
import {
  listUserTasks,
  updateUserTask,
  type UserTaskStatus,
} from '../../src/db/user-tasks';
import type { UserTaskInfo } from '../../src/shared/types';
import { setUserTaskChangeHandler } from '../../src/tasks/user-task-events';
import { syncUserTaskStatusToXlsx } from '../../src/tasks/xlsx-task-sync';

function broadcastUserTasksUpdated(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('userTasks:updated');
  }
}

export function registerUserTasksIpc(): void {
  setUserTaskChangeHandler(broadcastUserTasksUpdated);

  ipcMain.handle(
    'userTasks:list',
    (
      _event,
      filters?: { status?: UserTaskStatus; module?: string },
    ): UserTaskInfo[] => listUserTasks(filters),
  );

  ipcMain.handle(
    'userTasks:update',
    (
      _event,
      id: string,
      patch: Partial<{
        title: string;
        status: UserTaskStatus;
        notes: string;
        dueAt: string;
      }>,
    ) => {
      const task = updateUserTask(id, patch);
      if (task && patch.status && task.sourceFile) {
        void syncUserTaskStatusToXlsx(id).catch(() => undefined);
      }
      broadcastUserTasksUpdated();
      return task;
    },
  );
}
