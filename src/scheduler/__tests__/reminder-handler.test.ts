import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  resolvePermissionMock,
  createExecuteMock,
  deleteExecuteMock,
  listScheduledTasksMock,
} = vi.hoisted(() => ({
  resolvePermissionMock: vi.fn(),
  createExecuteMock: vi.fn(),
  deleteExecuteMock: vi.fn(),
  listScheduledTasksMock: vi.fn(),
}));

vi.mock('../../agent/permissions', () => ({
  defaultPermissionPolicy: vi.fn(() => ({})),
  resolveToolPermission: resolvePermissionMock,
}));

vi.mock('../../db/scheduled-tasks', () => ({
  listScheduledTasks: listScheduledTasksMock,
}));

vi.mock('../../tools/schedule/schedule-tools', () => ({
  createScheduledTaskTool: {
    name: 'create_scheduled_task',
    execute: createExecuteMock,
  },
  deleteScheduledTaskTool: {
    name: 'delete_scheduled_task',
    execute: deleteExecuteMock,
  },
  listScheduledTasksTool: {
    name: 'list_scheduled_tasks',
    execute: vi.fn(),
  },
}));

import { executeScheduleReminderIntent } from '../reminder-handler';

describe('schedule reminder permission boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePermissionMock.mockResolvedValue('allow');
    createExecuteMock.mockResolvedValue({ success: true, output: '已创建提醒' });
    deleteExecuteMock.mockResolvedValue({ success: true, output: '已删除提醒' });
  });

  it('does not bypass confirmation for natural-language creation', async () => {
    resolvePermissionMock.mockResolvedValue('deny');

    const reply = await executeScheduleReminderIntent({
      triggered: true,
      action: 'create',
      scheduleKind: 'recurring',
      cron: '30 9 * * *',
      name: '晨间提醒',
      message: '开始工作',
    });

    expect(reply).toBe('已取消创建定时提醒。');
    expect(resolvePermissionMock).toHaveBeenCalledOnce();
    expect(createExecuteMock).not.toHaveBeenCalled();
  });

  it('requires permission before natural-language deletion', async () => {
    listScheduledTasksMock.mockReturnValue([{
      id: 'task-1',
      name: '下班提醒',
      actionPayload: '{"message":"下班"}',
    }]);
    resolvePermissionMock.mockResolvedValue('deny');

    const reply = await executeScheduleReminderIntent({
      triggered: true,
      action: 'delete',
      nameHint: '下班',
    });

    expect(reply).toBe('已取消删除定时任务。');
    expect(resolvePermissionMock).toHaveBeenCalledOnce();
    expect(deleteExecuteMock).not.toHaveBeenCalled();
  });
});
