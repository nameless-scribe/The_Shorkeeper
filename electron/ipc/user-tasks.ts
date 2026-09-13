import { BrowserWindow } from 'electron';
import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  listUserTasks,
  updateUserTask,
  type UserTaskStatus,
} from '../../src/db/user-tasks';
import type { UserTaskInfo } from '../../src/shared/types';
import { setUserTaskChangeHandler } from '../../src/tasks/user-task-events';
import { syncUserTaskStatusToXlsx } from '../../src/tasks/xlsx-task-sync';
import { syncCommitmentWithTaskStatus } from '../../src/db/repositories/commitments';
import { safeSendToWebContents } from '../windows/web-contents';
import { requireEnum, requireRecord, requireString } from '../../src/shared/ipc-validation';

function broadcastUserTasksUpdated(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    safeSendToWebContents(win.webContents, 'userTasks:updated');
  }
}

export function registerUserTasksIpc(): void {
  setUserTaskChangeHandler(broadcastUserTasksUpdated);

  ipcMain.handle(
    'userTasks:list',
    (
      _event,
      filters?: { status?: UserTaskStatus; module?: string },
    ): UserTaskInfo[] => {
      if (filters === undefined) return listUserTasks();
      const input = requireRecord(filters, '用户任务筛选');
      return listUserTasks({
        status: input.status === undefined
          ? undefined
          : requireEnum(input.status, '任务状态', ['pending', 'in_progress', 'done', 'cancelled'] as const),
        module: input.module === undefined
          ? undefined
          : requireString(input.module, '模块', { allowEmpty: true, maxLength: 200 }),
      });
    },
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
      const input = requireRecord(patch, '用户任务更新');
      const normalized = {
        title: input.title === undefined ? undefined : requireString(input.title, '标题', { maxLength: 10_000 }),
        status: input.status === undefined
          ? undefined
          : requireEnum(input.status, '任务状态', ['pending', 'in_progress', 'done', 'cancelled'] as const),
        notes: input.notes === undefined ? undefined : requireString(input.notes, '备注', { allowEmpty: true, maxLength: 100_000 }),
        dueAt: input.dueAt === undefined ? undefined : requireString(input.dueAt, '截止时间', { allowEmpty: true, maxLength: 200 }),
      };
      const taskId = requireString(id, '用户任务 ID', { maxLength: 200 });
      const task = updateUserTask(taskId, normalized);
      if (task && normalized.status) {
        try {
          syncCommitmentWithTaskStatus(task.id, normalized.status, null);
        } catch (error) {
          console.error('[userTasks] 承诺同步失败:', error);
        }
      }
      if (task && normalized.status && task.sourceFile) {
        void syncUserTaskStatusToXlsx(taskId).catch((error) => {
          console.error('[userTasks] 回写 XLSX 失败:', error);
        });
      }
      broadcastUserTasksUpdated();
      return task;
    },
  );
}
