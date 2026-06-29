import cron from 'node-cron';
import type { ScheduledTaskInfo } from '../../src/shared/types';
import {
  disableScheduledTask,
  listEnabledScheduledTasks,
  markTaskRun,
} from '../../src/db/scheduled-tasks';
import { notifyTasksChanged } from '../../src/scheduler/task-events';
import { runOrchestrator } from '../../src/agent/orchestrator';
import { getOrCreateDefaultSession } from '../../src/db/repositories/sessions';
import { broadcastAgentEvent } from '../state/presence';
import { showReminderPopup } from '../reminder/popup';

const cronJobs = new Map<string, ReturnType<typeof cron.schedule>>();
const onceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { message: raw };
  }
}

async function executeReminder(task: ScheduledTaskInfo, payload: Record<string, unknown>) {
  const body =
    typeof payload.message === 'string'
      ? payload.message
      : typeof payload.text === 'string'
        ? payload.text
        : task.name;

  await showReminderPopup(task.name, body);
}

async function executeAgentPrompt(task: ScheduledTaskInfo, payload: Record<string, unknown>) {
  const prompt =
    typeof payload.prompt === 'string'
      ? payload.prompt
      : typeof payload.message === 'string'
        ? payload.message
        : task.name;

  const session = getOrCreateDefaultSession();
  for await (const event of runOrchestrator(prompt, session.id)) {
    broadcastAgentEvent(event);
  }
}

async function runTask(task: ScheduledTaskInfo): Promise<void> {
  const payload = parsePayload(task.actionPayload);
  try {
    if (task.actionType === 'reminder') {
      await executeReminder(task, payload);
    } else if (task.actionType === 'agent_prompt') {
      await executeAgentPrompt(task, payload);
    } else {
      console.warn(`[scheduler] 未知 action_type: ${task.actionType}`);
    }
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

function scheduleOnceTask(task: ScheduledTaskInfo): void {
  if (!task.runAt) {
    console.warn(`[scheduler] 一次性任务缺少 run_at: ${task.name}`);
    return;
  }
  if (task.lastRunAt) return;

  const trigger = () => {
    onceTimers.delete(task.id);
    void runTask(task);
  };

  const delay = task.runAt - Date.now();
  if (delay <= 0) {
    void trigger();
    return;
  }

  const timer = setTimeout(trigger, delay);
  onceTimers.set(task.id, timer);
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
