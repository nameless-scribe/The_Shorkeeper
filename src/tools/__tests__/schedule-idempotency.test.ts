import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listMock, createMock, notifyMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock('../../db/scheduled-tasks', () => ({
  listScheduledTasks: listMock,
  createScheduledTask: createMock,
  deleteScheduledTask: vi.fn(),
}));

vi.mock('../../scheduler/task-events', () => ({
  notifyTasksChanged: notifyMock,
}));

import { createScheduledTaskTool } from '../schedule/schedule-tools';

describe('create_scheduled_task idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the existing task for a repeated idempotency key', async () => {
    listMock.mockReturnValue([{
      id: 'task-1',
      name: '晨间提醒',
      enabled: true,
      actionPayload: JSON.stringify({
        message: '开始工作',
        _shorekeeper_idempotency_key: 'retry-1',
      }),
    }]);

    const result = await createScheduledTaskTool.execute({
      name: '晨间提醒',
      schedule_kind: 'recurring',
      cron: '30 9 * * *',
      message: '开始工作',
      idempotency_key: 'retry-1',
    }, {
      sessionId: 's1',
      workspaceRoot: '/tmp',
      signal: new AbortController().signal,
    });

    expect(result.success).toBe(true);
    expect(result.metadata).toEqual({ idempotent: true, taskId: 'task-1' });
    expect(createMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('creates a new active task when the matching reminder is disabled', async () => {
    listMock.mockReturnValue([{
      id: 'task-disabled',
      name: '晨间提醒',
      enabled: false,
      actionPayload: JSON.stringify({
        message: '开始工作',
        _shorekeeper_idempotency_key: 'retry-1',
      }),
    }]);
    createMock.mockReturnValue({
      id: 'task-2',
      name: '晨间提醒',
      scheduleKind: 'recurring',
      cron: '30 9 * * *',
      runAt: null,
      actionType: 'reminder',
      actionPayload: '{}',
      enabled: true,
      lastRunAt: null,
    });

    const result = await createScheduledTaskTool.execute({
      name: '晨间提醒',
      schedule_kind: 'recurring',
      cron: '30 9 * * *',
      message: '开始工作',
      idempotency_key: 'retry-1',
    }, {
      sessionId: 's1',
      workspaceRoot: '/tmp',
      signal: new AbortController().signal,
    });

    expect(result.success).toBe(true);
    expect(createMock).toHaveBeenCalledOnce();
    expect(notifyMock).toHaveBeenCalledOnce();
  });
});
