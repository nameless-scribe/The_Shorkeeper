import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTaskInfo } from '../../shared/types';
import { isSessionRunActive } from '../../agent/session-run-lock';

const state = vi.hoisted(() => ({
  runOrchestrator: vi.fn(),
  broadcast: vi.fn(),
  onRunStarted: vi.fn(),
  onRunFinished: vi.fn(),
  onRunError: vi.fn(),
  settings: {
    proactivityEnabled: true,
    quietHoursStart: '',
    quietHoursEnd: '',
    notificationDedupMinutes: 5,
  },
}));

vi.mock('node-cron', () => ({
  default: {
    validate: vi.fn(() => true),
    schedule: vi.fn(() => ({ stop: vi.fn() })),
  },
}));
vi.mock('../../db/scheduled-tasks', () => ({
  disableScheduledTask: vi.fn(),
  listEnabledScheduledTasks: vi.fn(() => []),
  markTaskRun: vi.fn(),
}));
vi.mock('../task-events', () => ({ notifyTasksChanged: vi.fn() }));
vi.mock('../reminder-message', () => ({
  resolveReminderBody: vi.fn(async () => '提醒'),
}));
vi.mock('../../config/performance', () => ({
  getPerformanceSettings: vi.fn(() => ({ ...state.settings })),
}));
vi.mock('../../agent/orchestrator', () => ({
  runOrchestrator: (...args: unknown[]) => state.runOrchestrator(...args),
}));
vi.mock('../../session/active', () => ({
  getActiveSession: vi.fn(() => ({ id: 'scheduled-session' })),
}));
vi.mock('../../../electron/state/presence', () => ({
  broadcastAgentEvent: (...args: unknown[]) => state.broadcast(...args),
  onRunStarted: (...args: unknown[]) => state.onRunStarted(...args),
  onRunFinished: (...args: unknown[]) => state.onRunFinished(...args),
  onRunError: (...args: unknown[]) => state.onRunError(...args),
}));
vi.mock('../../../electron/reminder/popup', () => ({
  showReminderPopup: vi.fn(async () => undefined),
}));

import { executeAgentPrompt, executeReminder } from '../../../electron/scheduler/cron';
import { showReminderPopup } from '../../../electron/reminder/popup';
import {
  clearProactivityDecisions,
  listProactivityDecisions,
} from '../../assistant/proactivity';

const task: ScheduledTaskInfo = {
  id: 'task-1',
  name: '定时整理',
  scheduleKind: 'recurring',
  cron: '0 9 * * *',
  runAt: null,
  actionType: 'agent_prompt',
  actionPayload: '{"prompt":"整理今天的计划"}',
  enabled: true,
  lastRunAt: null,
};

async function* events(items: Array<{ type: string; [key: string]: unknown }>) {
  for (const item of items) yield item;
}

describe('scheduled Agent runs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the shared run lifecycle and releases its session lock', async () => {
    state.runOrchestrator.mockReturnValue(events([
      { type: 'run_started', runId: 'scheduled-run', sessionId: 'scheduled-session' },
      { type: 'text_delta', runId: 'scheduled-run', delta: '已整理' },
      { type: 'run_finished', runId: 'scheduled-run' },
    ]));

    await expect(executeAgentPrompt(task, { prompt: '整理今天的计划' }))
      .resolves.toEqual({ skipped: false });

    expect(state.onRunStarted).toHaveBeenCalledOnce();
    expect(state.onRunFinished).toHaveBeenCalledOnce();
    expect(state.onRunError).not.toHaveBeenCalled();
    expect(isSessionRunActive('scheduled-session')).toBe(false);
    expect(state.broadcast).toHaveBeenCalledTimes(3);
  });

  it('settles failures without leaving the chat session locked', async () => {
    state.runOrchestrator.mockReturnValue(events([
      { type: 'run_started', runId: 'scheduled-error', sessionId: 'scheduled-session' },
      { type: 'run_error', runId: 'scheduled-error', message: '模型超时' },
    ]));

    await expect(executeAgentPrompt(task, { prompt: '整理今天的计划' }))
      .resolves.toEqual({ skipped: false });

    expect(state.onRunError).toHaveBeenCalledOnce();
    expect(state.onRunFinished).not.toHaveBeenCalled();
    expect(isSessionRunActive('scheduled-session')).toBe(false);
  });
});

describe('scheduled reminder visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    clearProactivityDecisions();
    state.settings.proactivityEnabled = true;
    state.settings.quietHoursStart = '';
    state.settings.quietHoursEnd = '';
    state.settings.notificationDedupMinutes = 5;
  });

  it('keeps explicitly created reminders visible through the policy layer', async () => {
    const result = await executeReminder({
      ...task,
      actionType: 'reminder',
    }, { message: '按计划休息' });

    expect(result).toMatchObject({ delivered: true, deferred: false, reason: 'notified' });
    expect(showReminderPopup).toHaveBeenCalledWith('定时整理', '提醒');
    expect(state.onRunError).not.toHaveBeenCalled();
    expect(listProactivityDecisions()[0]).toMatchObject({
      taskId: 'task-1',
      reason: 'notified',
    });
  });

  it('suppresses a duplicate reminder inside the configured window', async () => {
    await executeReminder({
      ...task,
      id: 'task-dedup',
      actionType: 'reminder',
    }, { message: '按计划休息' });
    const repeated = await executeReminder({
      ...task,
      id: 'task-dedup',
      actionType: 'reminder',
    }, { message: '按计划休息' });

    expect(showReminderPopup).toHaveBeenCalledOnce();
    expect(repeated).toMatchObject({ delivered: false, deferred: false, reason: 'repeated' });
  });

  it('defers a once reminder in quiet hours instead of consuming it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 30));
    state.settings.quietHoursStart = '22:00';
    state.settings.quietHoursEnd = '07:00';

    const result = await executeReminder({
      ...task,
      id: 'task-once-quiet',
      scheduleKind: 'once',
      actionType: 'reminder',
    }, { message: '按计划休息' });

    expect(showReminderPopup).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      delivered: false,
      deferred: true,
      reason: 'quiet_hours',
      fireAt: new Date(2026, 0, 2, 7, 0, 0, 0).getTime(),
    });
    expect(state.onRunStarted).not.toHaveBeenCalled();
    expect(state.onRunError).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('suppresses a recurring reminder in quiet hours without starting a chat run', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 30));
    state.settings.quietHoursStart = '22:00';
    state.settings.quietHoursEnd = '07:00';

    const result = await executeReminder({
      ...task,
      id: 'task-recurring-quiet',
      actionType: 'reminder',
    }, { message: '按计划休息' });

    expect(showReminderPopup).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      delivered: false,
      deferred: false,
      reason: 'quiet_hours',
    });
    expect(state.onRunError).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
