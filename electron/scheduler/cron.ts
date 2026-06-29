import cron from 'node-cron';
import { Notification } from 'electron';
import type { ScheduledTaskInfo } from '../../src/shared/types';
import {
  listEnabledScheduledTasks,
  markTaskRun,
} from '../../src/db/scheduled-tasks';
import { runOrchestrator } from '../../src/agent/orchestrator';
import { getOrCreateDefaultSession } from '../../src/db/repositories/sessions';
import { broadcastAgentEvent } from '../state/presence';

const jobs = new Map<string, ReturnType<typeof cron.schedule>>();

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

  if (Notification.isSupported()) {
    new Notification({ title: task.name, body }).show();
  } else {
    console.log(`[scheduler] reminder: ${task.name} — ${body}`);
  }
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

async function executeTask(task: ScheduledTaskInfo): Promise<void> {
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
  } catch (err) {
    console.error(`[scheduler] 任务失败 ${task.name}:`, err);
  }
}

function scheduleTask(task: ScheduledTaskInfo): void {
  if (!cron.validate(task.cron)) {
    console.warn(`[scheduler] 无效 cron: ${task.name} (${task.cron})`);
    return;
  }

  const job = cron.schedule(task.cron, () => {
    void executeTask(task);
  });
  jobs.set(task.id, job);
}

export function startScheduler(): void {
  stopScheduler();
  for (const task of listEnabledScheduledTasks()) {
    scheduleTask(task);
  }
  console.log(`[scheduler] 已加载 ${jobs.size} 个定时任务`);
}

export function stopScheduler(): void {
  for (const job of jobs.values()) {
    job.stop();
  }
  jobs.clear();
}

export function reloadScheduler(): void {
  startScheduler();
}
