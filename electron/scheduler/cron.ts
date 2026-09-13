import cron from 'node-cron';
import type { AssistantActionPolicy, ScheduledTaskInfo } from '../../src/shared/types';
import {
  disableScheduledTask,
  listEnabledScheduledTasks,
  markTaskFailure,
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
import { completeCommitmentForScheduledTask } from '../../src/db/repositories/commitments';
import { claimPopup, lastPopupSentAt, persistReminderDecision } from '../../src/proactivity/ledger';
import { idempotencyKeys, localDateKey, reminderOccurrenceKey } from '../../src/proactivity/contract';

export interface ReminderExecutionResult {
  delivered: boolean;
  deferred: boolean;
  policy: AssistantActionPolicy;
  reason: string;
  fireAt?: number;
}

const cronJobs = new Map<string, ReturnType<typeof cron.schedule>>();
const onceTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** 安静时段推迟的执行：reloadScheduler 不清除，只在退出时清除。 */
const deferredTimers = new Map<string, ReturnType<typeof setTimeout>>();
const runningTaskIds = new Set<string>();

/** Node timers cannot safely represent delays larger than a signed 32-bit integer. */
export const MAX_TIMER_DELAY_MS = 2_147_000_000;
export const BUSY_ONCE_TASK_RETRY_MS = 60_000;

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
    // 最近通知时间来自持久投递账本：应用重启不会让同一提醒再次弹出。
    repeated: isRepeatedNotification(
      lastPopupSentAt('scheduled_reminder', task.id),
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
  persistReminderDecision({
    decisionKey: idempotencyKeys.reminderDecision(task.id, now),
    subjectKind: 'scheduled_reminder',
    subjectId: task.id,
    policy: decision.policy,
    route: decision.action === 'notify' ? 'notify' : decision.action === 'defer' ? 'defer' : 'suppress',
    reason: decision.reason,
    at: now,
  });

  if (decision.action === 'notify') {
    // 同一提醒同一分钟只投递一次；一次性提醒用 run_at 作为发生键，跨重启也不重复。
    const occurrence = task.scheduleKind === 'once' && task.runAt != null
      ? `once:${task.runAt}`
      : reminderOccurrenceKey(now);
    // 先生成正文（可能调用模型、耗时较长），再认领投递：认领与弹窗之间不留可被崩溃打断的窗口。
    const body = await resolveReminderBody(task, payload);
    const claim = claimPopup({
      deliveryKey: idempotencyKeys.reminderDelivery(task.id, occurrence),
      subjectKind: 'scheduled_reminder',
      subjectId: task.id,
    });
    if (!claim.claimed) {
      return {
        delivered: false,
        deferred: false,
        policy: decision.policy,
        reason: 'repeated',
      };
    }
    try {
      await showReminderPopup(task.name, body);
    } catch (error) {
      claim.fail(error instanceof Error ? error.name || 'popup_error' : 'popup_error');
      throw error;
    }
    claim.commit(now);
    if (task.scheduleKind === 'once') {
      // 一次性提醒弹出即兑现了"到点提醒你"的承诺；周期提醒持续有效，不关闭。
      try {
        completeCommitmentForScheduledTask(task.id);
      } catch (error) {
        console.warn('[scheduler] 助理承诺完成标记失败:', error instanceof Error ? error.message : error);
      }
    }
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

/** 系统任务（如每日管家）声明 respect_quiet_hours 时，安静时段内推迟到时段结束再跑。 */
function agentPromptDeferral(payload: Record<string, unknown>): number | null {
  if (payload.respect_quiet_hours !== true) return null;
  const settings = getPerformanceSettings();
  const now = Date.now();
  if (!isWithinQuietHours(new Date(now), settings.quietHoursStart, settings.quietHoursEnd)) return null;
  return getQuietHoursEndAt(new Date(now), settings.quietHoursStart, settings.quietHoursEnd) ?? now + 60_000;
}

async function notifyAgentPromptDone(
  task: ScheduledTaskInfo,
  payload: Record<string, unknown>,
): Promise<void> {
  if (typeof payload.popup_title !== 'string' || !payload.popup_title.trim()) return;
  if (!getPerformanceSettings().proactivityEnabled) return;
  // 完成提示按"任务 + 日期"记入投递账本：不参与提醒去重窗口，但同一天不会重复弹。
  const now = Date.now();
  const claim = claimPopup({
    deliveryKey: idempotencyKeys.stewardNotice(task.id, localDateKey(now)),
    subjectKind: 'steward_notice',
    subjectId: task.id,
  });
  if (!claim.claimed) return;
  persistReminderDecision({
    decisionKey: `decision:steward:${task.id}:${localDateKey(now)}`,
    subjectKind: 'steward_notice',
    subjectId: task.id,
    policy: 'notify',
    route: 'notify',
    reason: 'notified',
    at: now,
  });
  try {
    await showReminderPopup(payload.popup_title.trim(), '已生成，请打开聊天窗口查看。');
    claim.commit(now);
  } catch (error) {
    claim.fail(error instanceof Error ? error.name || 'popup_error' : 'popup_error');
    console.warn(`[scheduler] 任务「${task.name}」完成提示弹窗失败:`, error);
  }
}

export async function executeAgentPrompt(
  task: ScheduledTaskInfo,
  payload: Record<string, unknown>,
): Promise<{ skipped: boolean; failed?: boolean }> {
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
    for await (const event of runOrchestrator(prompt, session.id, controller.signal, {
      kind: 'scheduled',
      triggerRef: task.id,
    })) {
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
      await notifyAgentPromptDone(task, payload);
    }
    return { skipped: false, failed: terminalError };
  } catch (err) {
    onRunError();
    throw err;
  } finally {
    releaseSessionRun(session.id, controller);
  }
}

export async function runScheduledTask(task: ScheduledTaskInfo): Promise<void> {
  if (runningTaskIds.has(task.id)) {
    console.warn(`[scheduler] 跳过重叠执行：「${task.name}」仍在运行`);
    return;
  }
  runningTaskIds.add(task.id);

  const payload = parsePayload(task.actionPayload);
  try {
    let skipped = false;
    let failed = false;
    if (task.actionType === 'reminder') {
      const result = await executeReminder(task, payload);
      if (result.deferred) {
        scheduleDeferredReminder(task, result.fireAt);
        return;
      }
    } else if (task.actionType === 'agent_prompt') {
      const deferUntil = agentPromptDeferral(payload);
      if (deferUntil != null) {
        console.info(`[scheduler] 「${task.name}」处于安静时段，推迟到 ${new Date(deferUntil).toLocaleTimeString()}`);
        scheduleDeferredReminder(task, deferUntil);
        return;
      }
      const result = await executeAgentPrompt(task, payload);
      skipped = result.skipped;
      failed = result.failed === true;
    } else {
      throw new Error(`未知 action_type: ${task.actionType}`);
    }

    if (skipped) {
      if (task.scheduleKind === 'once') {
        scheduleOnceAt(task, Date.now() + BUSY_ONCE_TASK_RETRY_MS);
      }
      return;
    }

    if (failed) {
      // 以 run_error 结束的定时 Agent 任务是失败：不清零失败计数，让主动服务能看到它。
      markTaskFailure(task.id, new Error('定时任务的 Agent 运行以错误结束'));
    } else {
      markTaskRun(task.id);
    }

    if (task.scheduleKind === 'once') {
      disableScheduledTask(task.id);
      notifyTasksChanged();
    }
  } catch (err) {
    console.error(`[scheduler] 任务失败 ${task.name}:`, err);
    try {
      // 失败写入真源，P3 采集器据此投影"定时任务失败"事件。
      markTaskFailure(task.id, err);
    } catch (recordError) {
      console.warn('[scheduler] 记录任务失败状态失败:', recordError instanceof Error ? recordError.message : recordError);
    }
  } finally {
    runningTaskIds.delete(task.id);
  }
}

function scheduleRecurringTask(task: ScheduledTaskInfo): void {
  if (!cron.validate(task.cron)) {
    console.warn(`[scheduler] 无效 cron: ${task.name} (${task.cron})`);
    return;
  }

  const job = cron.schedule(task.cron, () => {
    void runScheduledTask(task);
  });
  cronJobs.set(task.id, job);
}

function scheduleOnceAt(
  task: ScheduledTaskInfo,
  fireAt: number,
  options: { deferred?: boolean } = {},
): void {
  const timers = options.deferred ? deferredTimers : onceTimers;
  const existing = timers.get(task.id);
  if (existing) clearTimeout(existing);

  const trigger = () => {
    timers.delete(task.id);
    if (fireAt > Date.now()) {
      scheduleOnceAt(task, fireAt, options);
      return;
    }
    if (options.deferred) {
      // 推迟期间任务可能被修改或删除：以数据库当前状态为准。
      const live = listEnabledScheduledTasks().find((item) => item.id === task.id);
      if (!live) return;
      void runScheduledTask(live);
      return;
    }
    void runScheduledTask(task);
  };

  const delay = fireAt - Date.now();
  if (delay <= 0) {
    void trigger();
    return;
  }

  timers.set(task.id, setTimeout(trigger, Math.min(delay, MAX_TIMER_DELAY_MS)));
}

function scheduleDeferredReminder(task: ScheduledTaskInfo, fireAt?: number): void {
  if (fireAt == null) return;
  scheduleOnceAt(task, fireAt, { deferred: true });
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
  stopScheduler({ keepDeferred: true });

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

export function stopScheduler(options: { keepDeferred?: boolean } = {}): void {
  for (const job of cronJobs.values()) {
    job.stop();
  }
  cronJobs.clear();

  for (const timer of onceTimers.values()) {
    clearTimeout(timer);
  }
  onceTimers.clear();

  if (!options.keepDeferred) {
    for (const timer of deferredTimers.values()) {
      clearTimeout(timer);
    }
    deferredTimers.clear();
  }
}

export function reloadScheduler(): void {
  startScheduler();
}
