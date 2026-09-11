import cron from 'node-cron';
import type { AssistantActionPolicy, ScheduledTaskInfo } from '../../src/shared/types';
import {
  disableScheduledTask,
  listEnabledScheduledTasks,
  markTaskRun,
} from '../../src/db/scheduled-tasks';
import { notifyTasksChanged } from '../../src/scheduler/task-events';
import { resolveReminderBody } from '../../src/scheduler/reminder-message';
import { runOrchestrator } from '../../src/agent/orchestrator';
import {
  acquireSessionRun,
  releaseSessionRun,
  setSessionRunId,
} from '../../src/agent/session-run-lock';
import { getActiveSession } from '../../src/session/active';
import { broadcastAgentEvent, onRunError, onRunFinished, onRunStarted } from '../state/presence';
import { showReminderPopup } from '../reminder/popup';
import {
  evaluateReminderDelivery,
  getQuietHoursEndAt,
  isRepeatedNotification,
  isWithinQuietHours,
  recordProactivityDecision,
} from '../../src/assistant/proactivity';
import { getPerformanceSettings } from '../../src/config/performance';

export interface ReminderExecutionResult {
  delivered: boolean;
  deferred: boolean;
  policy: AssistantActionPolicy;
  reason: string;
  fireAt?: number;
}

const cronJobs = new Map<string, ReturnType<typeof cron.schedule>>();
const onceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastReminderNotificationAt = new Map<string, number>();

function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { message: raw };
  }
}

export async function executeReminder(
  task: ScheduledTaskInfo,
  payload: Record<string, unknown>,
): Promise<ReminderExecutionResult> {
  const settings = getPerformanceSettings();
  const now = Date.now();
  const quietHours = isWithinQuietHours(
    new Date(now),
    settings.quietHoursStart,
    settings.quietHoursEnd,
  );
  const decision = evaluateReminderDelivery({
    // 能进入 scheduled_tasks 的提醒都经过用户创建/确认链路。
    explicit: true,
    enabled: settings.proactivityEnabled,
    quietHours,
    repeated: isRepeatedNotification(
      lastReminderNotificationAt.get(task.id),
      now,
      settings.notificationDedupMinutes,
    ),
    scheduleKind: task.scheduleKind,
  });
  recordProactivityDecision({
    taskId: task.id,
    kind: 'scheduled_reminder',
    policy: decision.policy,
    reason: decision.reason,
    at: now,
  });

  if (decision.action === 'notify') {
    const body = await resolveReminderBody(task, payload);
    await showReminderPopup(task.name, body);
    lastReminderNotificationAt.set(task.id, now);
    return {
      delivered: true,
      deferred: false,
      policy: decision.policy,
      reason: decision.reason,
    };
  }

  const fireAt = decision.action === 'defer'
    ? getQuietHoursEndAt(new Date(now), settings.quietHoursStart, settings.quietHoursEnd) ?? now + 60_000
    : undefined;
  return {
    delivered: false,
    deferred: decision.action === 'defer',
    policy: decision.policy,
    reason: decision.reason,
    fireAt,
  };
}

export async function executeAgentPrompt(
  task: ScheduledTaskInfo,
  payload: Record<string, unknown>,
): Promise<{ skipped: boolean }> {
  const prompt =
    typeof payload.prompt === 'string'
      ? payload.prompt
      : typeof payload.message === 'string'
        ? payload.message
        : task.name;

  const session = getActiveSession();
  const controller = acquireSessionRun(session.id);
  if (!controller) {
    console.warn(`[scheduler] 跳过任务「${task.name}」：会话 ${session.id} 正在运行 Agent`);
    return { skipped: true };
  }

  onRunStarted();

  let terminalError = false;
  try {
    for await (const event of runOrchestrator(prompt, session.id, controller.signal)) {
      if (event.type === 'run_started') {
        setSessionRunId(session.id, event.runId);
      }
      broadcastAgentEvent(event);
      if (event.type === 'run_error') {
        terminalError = true;
      }
    }
    if (terminalError) {
      onRunError();
    } else {
      onRunFinished();
    }
    return { skipped: false };
  } catch (err) {
    onRunError();
    throw err;
  } finally {
    releaseSessionRun(session.id, controller);
  }
}

async function runTask(task: ScheduledTaskInfo): Promise<void> {
  const payload = parsePayload(task.actionPayload);
  try {
    let skipped = false;
    if (task.actionType === 'reminder') {
      const result = await executeReminder(task, payload);
      if (result.deferred) {
        scheduleDeferredReminder(task, result.fireAt);
        return;
      }
    } else if (task.actionType === 'agent_prompt') {
      const result = await executeAgentPrompt(task, payload);
      skipped = result.skipped;
    } else {
      console.warn(`[scheduler] 未知 action_type: ${task.actionType}`);
    }

    if (skipped) return;

    markTaskRun(task.id);

    if (task.scheduleKind === 'once') {
      disableScheduledTask(task.id);
      notifyTasksChanged();
    }
  } catch (err) {
    console.error(`[scheduler] 任务失败 ${task.name}:`, err);
  }
}

function scheduleRecurringTask(task: ScheduledTaskInfo): void {
  if (!cron.validate(task.cron)) {
    console.warn(`[scheduler] 无效 cron: ${task.name} (${task.cron})`);
    return;
  }

  const job = cron.schedule(task.cron, () => {
    void runTask(task);
  });
  cronJobs.set(task.id, job);
}

function scheduleOnceAt(task: ScheduledTaskInfo, fireAt: number): void {
  const existing = onceTimers.get(task.id);
  if (existing) clearTimeout(existing);

  const trigger = () => {
    onceTimers.delete(task.id);
    void runTask(task);
  };

  const delay = fireAt - Date.now();
  if (delay <= 0) {
    void trigger();
    return;
  }

  onceTimers.set(task.id, setTimeout(trigger, delay));
}

function scheduleDeferredReminder(task: ScheduledTaskInfo, fireAt?: number): void {
  if (fireAt == null) return;
  scheduleOnceAt(task, fireAt);
}

function scheduleOnceTask(task: ScheduledTaskInfo): void {
  if (!task.runAt) {
    console.warn(`[scheduler] 一次性任务缺少 run_at: ${task.name}`);
    return;
  }
  if (task.lastRunAt) return;
  scheduleOnceAt(task, task.runAt);
}

export function startScheduler(): void {
  stopScheduler();

  let recurringCount = 0;
  let onceCount = 0;

  for (const task of listEnabledScheduledTasks()) {
    if (task.scheduleKind === 'once') {
      scheduleOnceTask(task);
      onceCount += 1;
    } else {
      scheduleRecurringTask(task);
      recurringCount += 1;
    }
  }

  console.log(
    `[scheduler] 已加载 ${recurringCount} 个周期任务、${onceCount} 个一次性任务`,
  );
}

export function stopScheduler(): void {
  for (const job of cronJobs.values()) {
    job.stop();
  }
  cronJobs.clear();

  for (const timer of onceTimers.values()) {
    clearTimeout(timer);
  }
  onceTimers.clear();
}

export function reloadScheduler(): void {
  startScheduler();
}
