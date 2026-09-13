import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTaskInfo } from '../../shared/types';
import {
  acquireSessionRun,
  isSessionRunActive,
  releaseSessionRun,
} from '../../agent/session-run-lock';

const state = vi.hoisted(() => ({
  runOrchestrator: vi.fn(),
  broadcast: vi.fn(),
  onRunStarted: vi.fn(),
  onRunFinished: vi.fn(),
  onRunError: vi.fn(),
  resolveReminderBody: vi.fn(async () => '提醒'),
  showReminderPopup: vi.fn(async () => undefined),
  enabledTasks: [] as ScheduledTaskInfo[],
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
  listEnabledScheduledTasks: vi.fn(() => state.enabledTasks),
  markTaskRun: vi.fn(),
}));
vi.mock('../task-events', () => ({ notifyTasksChanged: vi.fn() }));
vi.mock('../../db/repositories/commitments', () => ({
  completeCommitmentForScheduledTask: vi.fn(),
}));
vi.mock('../reminder-message', () => ({
  resolveReminderBody: state.resolveReminderBody,
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
  showReminderPopup: state.showReminderPopup,
}));

import {
  BUSY_ONCE_TASK_RETRY_MS,
  executeAgentPrompt,
  executeReminder,
  MAX_TIMER_DELAY_MS,
  runScheduledTask,
  startScheduler,
  stopScheduler,
} from '../../../electron/scheduler/cron';
import { showReminderPopup } from '../../../electron/reminder/popup';
import { disableScheduledTask, markTaskRun } from '../../db/scheduled-tasks';
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

beforeEach(() => {
  state.enabledTasks = [];
  state.resolveReminderBody.mockReset().mockResolvedValue('提醒');
  state.showReminderPopup.mockReset().mockResolvedValue(undefined);
});

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

  it('pops a title-only notice after a system prompt finishes, but not after it fails', async () => {
    state.runOrchestrator.mockReturnValue(events([
      { type: 'run_started', runId: 'brief-run', sessionId: 'scheduled-session' },
      { type: 'run_finished', runId: 'brief-run' },
    ]));
    await executeAgentPrompt(task, { prompt: '简报', popup_title: '早间简报已准备好' });
    expect(state.showReminderPopup).toHaveBeenCalledWith('早间简报已准备好', expect.stringContaining('聊天窗口'));

    state.showReminderPopup.mockClear();
    state.runOrchestrator.mockReturnValue(events([
      { type: 'run_started', runId: 'brief-error', sessionId: 'scheduled-session' },
      { type: 'run_error', runId: 'brief-error', message: '模型超时' },
    ]));
    await executeAgentPrompt(task, { prompt: '简报', popup_title: '早间简报已准备好' });
    expect(state.showReminderPopup).not.toHaveBeenCalled();

    state.settings.proactivityEnabled = false;
    state.runOrchestrator.mockReturnValue(events([
      { type: 'run_started', runId: 'brief-quiet', sessionId: 'scheduled-session' },
      { type: 'run_finished', runId: 'brief-quiet' },
    ]));
    await executeAgentPrompt(task, { prompt: '简报', popup_title: '早间简报已准备好' });
    expect(state.showReminderPopup).not.toHaveBeenCalled();
    state.settings.proactivityEnabled = true;
  });

  it('defers a quiet-hours-aware system prompt instead of running it', async () => {
    vi.useFakeTimers();
    try {
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, '0');
      const start = `${pad((now.getHours() + 23) % 24)}:00`;
      const end = `${pad((now.getHours() + 2) % 24)}:00`;
      state.settings.quietHoursStart = start;
      state.settings.quietHoursEnd = end;

      await runScheduledTask({
        ...task,
        id: 'steward-morning',
        actionPayload: JSON.stringify({ prompt: '简报', respect_quiet_hours: true }),
      });
      expect(state.runOrchestrator).not.toHaveBeenCalled();
      expect(markTaskRun).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      // Ordinary agent prompts ignore quiet hours.
      state.runOrchestrator.mockReturnValue(events([
        { type: 'run_started', runId: 'plain', sessionId: 'scheduled-session' },
        { type: 'run_finished', runId: 'plain' },
      ]));
      await runScheduledTask({ ...task, id: 'plain-prompt' });
      expect(state.runOrchestrator).toHaveBeenCalledOnce();
    } finally {
      stopScheduler();
      vi.useRealTimers();
      state.settings.quietHoursStart = '';
      state.settings.quietHoursEnd = '';
    }
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

describe('scheduler execution safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    state.settings.proactivityEnabled = true;
    state.settings.quietHoursStart = '';
    state.settings.quietHoursEnd = '';
    state.settings.notificationDedupMinutes = 5;
  });

  it('chunks long one-time delays instead of overflowing the Node timer', async () => {
    vi.useFakeTimers();
    const now = new Date(2026, 0, 1, 9, 0).getTime();
    vi.setSystemTime(now);
    const fireAt = now + MAX_TIMER_DELAY_MS + 10_000;
    state.enabledTasks = [{
      ...task,
      id: 'task-long-delay',
      name: '远期提醒',
      scheduleKind: 'once',
      runAt: fireAt,
      actionType: 'reminder',
    }];

    startScheduler();
    await vi.advanceTimersByTimeAsync(MAX_TIMER_DELAY_MS);
    expect(state.showReminderPopup).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(state.showReminderPopup).toHaveBeenCalledOnce();
    expect(markTaskRun).toHaveBeenCalledWith('task-long-delay');
    expect(disableScheduledTask).toHaveBeenCalledWith('task-long-delay');
    stopScheduler();
    vi.useRealTimers();
  });

  it('retries a busy one-time Agent task instead of stranding it', async () => {
    vi.useFakeTimers();
    const busyController = acquireSessionRun('scheduled-session');
    expect(busyController).not.toBeNull();
    const onceAgentTask: ScheduledTaskInfo = {
      ...task,
      id: 'task-busy-once',
      scheduleKind: 'once',
      runAt: Date.now(),
    };

    await runScheduledTask(onceAgentTask);
    expect(state.runOrchestrator).not.toHaveBeenCalled();
    releaseSessionRun('scheduled-session', busyController!);
    state.runOrchestrator.mockReturnValue(events([
      { type: 'run_started', runId: 'retried-run', sessionId: 'scheduled-session' },
      { type: 'run_finished', runId: 'retried-run' },
    ]));

    await vi.advanceTimersByTimeAsync(BUSY_ONCE_TASK_RETRY_MS);
    expect(state.runOrchestrator).toHaveBeenCalledOnce();
    expect(markTaskRun).toHaveBeenCalledWith('task-busy-once');
    expect(disableScheduledTask).toHaveBeenCalledWith('task-busy-once');
    stopScheduler();
    vi.useRealTimers();
  });

  it('prevents overlapping executions of the same reminder task', async () => {
    let finishPopup: (() => void) | undefined;
    state.showReminderPopup.mockImplementation(() => new Promise<undefined>((resolve) => {
      finishPopup = () => resolve(undefined);
    }));
    const reminderTask: ScheduledTaskInfo = {
      ...task,
      id: 'task-overlap',
      actionType: 'reminder',
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const first = runScheduledTask(reminderTask);
    await vi.waitFor(() => expect(state.showReminderPopup).toHaveBeenCalledOnce());
    await runScheduledTask(reminderTask);
    expect(state.showReminderPopup).toHaveBeenCalledOnce();

    finishPopup?.();
    await first;
    expect(markTaskRun).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('does not mark unsupported actions as successfully consumed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runScheduledTask({
      ...task,
      id: 'task-unsupported',
      scheduleKind: 'once',
      actionType: 'unsupported',
    });

    expect(markTaskRun).not.toHaveBeenCalled();
    expect(disableScheduledTask).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
