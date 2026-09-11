import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTaskInfo } from '../../shared/types';
import { isSessionRunActive } from '../../agent/session-run-lock';

const state = vi.hoisted(() => ({
  runOrchestrator: vi.fn(),
  broadcast: vi.fn(),
  onRunStarted: vi.fn(),
  onRunFinished: vi.fn(),
  onRunError: vi.fn(),
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

import { executeAgentPrompt } from '../../../electron/scheduler/cron';

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
