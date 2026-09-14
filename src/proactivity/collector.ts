/**
 * P3.1 LocalEventCollector 的纯投影部分：输入本地真源快照，输出应当存在的事件集合。
 * 不访问数据库、不产生副作用；快照由 sources.ts 读取，写入由 service.ts 完成。
 */
import type {
  CommitmentInfo,
  GoalInfo,
  GoalProgress,
  MemoryCandidateInfo,
  ProactiveEventDomain,
  ProactiveEventKind,
  ProactiveEventUrgency,
  ScheduledTaskInfo,
  TaskRunInfo,
  UserTaskInfo,
} from '../shared/types';
import type { UpsertProactiveEventInput } from '../db/repositories/proactive-events';
import {
  COMMITMENT_DUE_SOON_MS,
  COMMITMENT_NOTIFY_WINDOW_MS,
  COMMITMENT_UNATTENDED_MS,
  EVENT_DEFAULT_TTL_MS,
  GOAL_STALLED_MS,
  GOAL_TARGET_NEAR_DAYS,
  MEMORY_EXPIRING_MS,
  RUN_LOOKBACK_MS,
  SCHEDULE_MISSED_GRACE_MS,
  dedupeKeys,
  localDateKey,
} from './contract';

export interface DocumentSourceState {
  id: string;
  title: string;
  filename: string;
  status: string;
  statusError: string | null;
  freshnessStatus: string;
  staleReason: string | null;
  version: number;
  sourceKind: string;
  /** 稳定的发生时间依据：来源基线 mtime 或导入时间；不用"本次检查时间"，避免每轮都刷新事件 */
  sourceModifiedAt: number | null;
  importedAt: number;
}

export interface MemorySourceState {
  id: string;
  memoryKey: string | null;
  status: string;
  expiresAt: number | null;
}

export interface GoalSourceState extends GoalInfo {
  progress: GoalProgress;
  /** 目标本身、关联待办与承诺最近一次更新时间 */
  lastActivityAt: number;
}

export interface DomainSnapshot<T> {
  items: T[];
  /** 查询未被数量上限截断；只有完整快照才允许自动解决旧事件 */
  complete: boolean;
}

export interface LocalStateSnapshot {
  now: number;
  tasks?: DomainSnapshot<UserTaskInfo>;
  commitments?: DomainSnapshot<CommitmentInfo>;
  runs?: DomainSnapshot<TaskRunInfo>;
  schedules?: DomainSnapshot<ScheduledTaskInfo>;
  documents?: DomainSnapshot<DocumentSourceState>;
  memoryCandidates?: DomainSnapshot<MemoryCandidateInfo>;
  memories?: DomainSnapshot<MemorySourceState>;
  goals?: DomainSnapshot<GoalSourceState>;
}

export type ProjectedEvent = UpsertProactiveEventInput;

export interface ProjectionResult {
  events: ProjectedEvent[];
  /** 本次覆盖且快照完整的域：其中未出现的旧活动事件应被解决 */
  completeDomains: ProactiveEventDomain[];
  coveredDomains: ProactiveEventDomain[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseLocalDate(dateOnly: string): number | null {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

/** 本地日历加天数（跨夏令时安全）。 */
function addLocalDaysMs(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

/** 两个本地日起点之间的日历天数（跨夏令时安全）。 */
function calendarDaysBetween(fromDayStart: number, toDayStart: number): number {
  return Math.round((toDayStart - fromDayStart) / DAY_MS);
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(timestamp: number): string {
  return `${localDateKey(timestamp)} ${formatClock(timestamp)}`;
}

function event(
  kind: ProactiveEventKind,
  domain: ProactiveEventDomain,
  input: Omit<ProjectedEvent, 'kind' | 'domain' | 'expiresAt'> & { expiresAt?: number | null },
): ProjectedEvent {
  return {
    ...input,
    kind,
    domain,
    expiresAt: input.expiresAt === undefined ? input.occurredAt + EVENT_DEFAULT_TTL_MS : input.expiresAt,
  };
}

export function projectTaskEvents(tasks: UserTaskInfo[], now: number): ProjectedEvent[] {
  const today = localDateKey(now);
  const todayStart = parseLocalDate(today)!;
  const result: ProjectedEvent[] = [];
  for (const task of tasks) {
    if (task.status !== 'pending' && task.status !== 'in_progress') continue;
    if (!task.dueAt) continue;
    const dueStart = parseLocalDate(task.dueAt);
    if (dueStart == null) continue;
    if (task.dueAt === today) {
      result.push(event('task_due_today', 'task', {
        sourceType: 'user_task',
        sourceId: task.id,
        sourceRef: task.module ? `module:${task.module}` : null,
        dedupeKey: dedupeKeys.taskDue(task.id, today),
        sourceVersion: 0,
        title: `今日到期：${task.title}`,
        summary: `待办「${task.title}」今天截止${task.module ? `（${task.module}）` : ''}。完成、取消或改期后此提示自动消失。`,
        urgency: 'normal',
        dueAt: addLocalDaysMs(dueStart, 1) - 1,
        occurredAt: todayStart,
        expiresAt: addLocalDaysMs(dueStart, 1),
      }));
    } else if (task.dueAt < today) {
      const overdueDays = Math.max(1, calendarDaysBetween(dueStart, todayStart));
      result.push(event('task_overdue', 'task', {
        sourceType: 'user_task',
        sourceId: task.id,
        sourceRef: task.module ? `module:${task.module}` : null,
        dedupeKey: dedupeKeys.taskOverdue(task.id, task.dueAt),
        sourceVersion: 0,
        title: `已逾期 ${overdueDays} 天：${task.title}`,
        summary: `待办「${task.title}」截止 ${task.dueAt}，仍未完成。可以在待办页顺延、完成或取消。`,
        urgency: overdueDays >= 7 ? 'high' : 'normal',
        dueAt: addLocalDaysMs(dueStart, 1) - 1,
        occurredAt: addLocalDaysMs(dueStart, 1),
      }));
    }
  }
  return result;
}

export function projectCommitmentEvents(commitments: CommitmentInfo[], now: number): ProjectedEvent[] {
  const result: ProjectedEvent[] = [];
  for (const item of commitments) {
    const ownerLabel = item.owner === 'assistant' ? '助理承诺' : '承诺';
    const promisedTo = item.promisedTo ? `（答应了 ${item.promisedTo}）` : '';
    if (item.status === 'proposed') {
      result.push(event('commitment_proposed', 'commitment', {
        sourceType: 'commitment',
        sourceId: item.id,
        sourceRef: item.sourceSessionId ? `session:${item.sourceSessionId}` : null,
        dedupeKey: dedupeKeys.commitment(item.id, 'proposed', localDateKey(item.createdAt)),
        sourceVersion: 0,
        title: `待确认${ownerLabel}：${item.title}`,
        summary: `从对话中识别到一条${ownerLabel}${promisedTo}，尚未确认。确认后会加入待办；不需要的话可以拒绝。`,
        urgency: 'low',
        dueAt: item.dueAt,
        occurredAt: item.createdAt,
      }));
      continue;
    }
    if (item.status === 'missed') {
      const closedAt = item.closedAt ?? item.updatedAt;
      result.push(event('commitment_missed', 'commitment', {
        sourceType: 'commitment',
        sourceId: item.id,
        sourceRef: item.taskId ? `user_task:${item.taskId}` : null,
        dedupeKey: dedupeKeys.commitment(item.id, 'missed', localDateKey(closedAt)),
        sourceVersion: 0,
        title: `${ownerLabel}已错过：${item.title}`,
        summary: `${item.dueAt != null ? `截止 ${formatDateTime(item.dueAt)}，` : ''}到期未完成${promisedTo}。请决定顺延、重新承诺还是放弃；不会自动顺延。`,
        urgency: 'high',
        dueAt: item.dueAt,
        occurredAt: closedAt,
      }));
      continue;
    }
    if (item.status !== 'open') continue;
    if (item.dueAt != null && item.dueAt - now <= COMMITMENT_DUE_SOON_MS) {
      const overdue = item.dueAt < now;
      // 弹窗资格要求截止时间落在通知窗口的前后两侧：只有"即将到期"和"刚刚过期"才够紧急。
      // 少了下界，逾期数天乃至数月的承诺也会算成 high，升级后第一轮就会一起抢弹窗预算。
      const withinNotify =
        item.dueAt - now <= COMMITMENT_NOTIFY_WINDOW_MS && now - item.dueAt <= COMMITMENT_NOTIFY_WINDOW_MS;
      result.push(event('commitment_due_soon', 'commitment', {
        sourceType: 'commitment',
        sourceId: item.id,
        sourceRef: item.taskId ? `user_task:${item.taskId}` : null,
        dedupeKey: dedupeKeys.commitment(item.id, 'due_soon', localDateKey(item.dueAt)),
        sourceVersion: 0,
        title: overdue ? `${ownerLabel}已到期：${item.title}` : `${ownerLabel}临期：${item.title}`,
        summary: `${overdue ? '已于' : '将于'} ${formatDateTime(item.dueAt)} 到期${promisedTo}。完成后请在待办或承诺中标记，附上证据更好。`,
        urgency: withinNotify ? 'high' : 'normal',
        dueAt: item.dueAt,
        occurredAt: Math.max(item.createdAt, item.dueAt - COMMITMENT_DUE_SOON_MS),
      }));
      continue;
    }
    const lastTouched = item.lastFollowedUpAt ?? item.createdAt;
    if (now - lastTouched >= COMMITMENT_UNATTENDED_MS) {
      const weekIndex = Math.floor((now - lastTouched) / COMMITMENT_UNATTENDED_MS);
      result.push(event('commitment_unattended', 'commitment', {
        sourceType: 'commitment',
        sourceId: item.id,
        sourceRef: item.taskId ? `user_task:${item.taskId}` : null,
        dedupeKey: dedupeKeys.commitment(item.id, 'unattended', `w${weekIndex}`),
        sourceVersion: 0,
        title: `${ownerLabel}久未跟进：${item.title}`,
        summary: `自 ${localDateKey(lastTouched)} 起没有跟进记录${promisedTo}。打开后会记录一次跟进，不会改变承诺状态。`,
        urgency: 'low',
        dueAt: item.dueAt,
        occurredAt: lastTouched + COMMITMENT_UNATTENDED_MS,
      }));
    }
  }
  return result;
}

export function projectRunEvents(runs: TaskRunInfo[], now: number): ProjectedEvent[] {
  const result: ProjectedEvent[] = [];
  for (const run of runs) {
    if (run.phase !== 'error' && run.phase !== 'interrupted') continue;
    if (run.acknowledgedAt != null) continue;
    const terminalAt = run.terminalAt ?? run.updatedAt;
    if (now - terminalAt > RUN_LOOKBACK_MS) continue;
    const kindLabel = run.kind === 'scheduled' ? '定时任务运行' : run.kind === 'voice' ? '通话运行' : '对话运行';
    const steps = run.stepCount > 0 ? `工具步骤 ${run.stepCount - run.failedStepCount}/${run.stepCount} 成功。` : '';
    if (run.phase === 'error') {
      result.push(event('run_error', 'run', {
        sourceType: 'task_run',
        sourceId: run.id,
        sourceRef: `session:${run.sessionId}`,
        dedupeKey: dedupeKeys.run(run.id, 'error'),
        sourceVersion: 0,
        title: `${kindLabel}失败`,
        summary: `${run.errorSummary ? `原因：${run.errorSummary}。` : ''}${steps}打开可查看真实步骤与产物；不会自动重跑。`,
        urgency: 'normal',
        dueAt: null,
        occurredAt: terminalAt,
      }));
    } else {
      result.push(event('run_interrupted', 'run', {
        sourceType: 'task_run',
        sourceId: run.id,
        sourceRef: `session:${run.sessionId}`,
        dedupeKey: dedupeKeys.run(run.id, 'interrupted'),
        sourceVersion: 0,
        title: `${kindLabel}被中断`,
        summary: `${run.terminalReason ? `${run.terminalReason}。` : ''}${steps}打开可确认哪些步骤已完成；需要时由你决定是否重新发起。`,
        urgency: 'normal',
        dueAt: null,
        occurredAt: terminalAt,
      }));
    }
  }
  return result;
}

export function projectScheduleEvents(schedules: ScheduledTaskInfo[], now: number): ProjectedEvent[] {
  const result: ProjectedEvent[] = [];
  for (const task of schedules) {
    if (!task.enabled) continue;
    const failureCount = task.failureCount ?? 0;
    if (failureCount > 0 && task.lastErrorAt != null) {
      result.push(event('schedule_failed', 'schedule', {
        sourceType: 'scheduled_task',
        sourceId: task.id,
        sourceRef: null,
        dedupeKey: dedupeKeys.scheduleFailure(task.id, localDateKey(task.lastErrorAt)),
        sourceVersion: 0,
        title: failureCount >= 3 ? `定时任务连续失败 ${failureCount} 次：${task.name}` : `定时任务失败：${task.name}`,
        summary: `${task.lastError ? `最近错误：${task.lastError}。` : ''}下次成功执行后自动关闭此提示；也可以在定时任务页停用。`,
        urgency: failureCount >= 3 ? 'high' : 'normal',
        dueAt: null,
        occurredAt: task.lastErrorAt,
      }));
      continue;
    }
    if (
      task.scheduleKind === 'once' &&
      task.runAt != null &&
      task.lastRunAt == null &&
      now - task.runAt >= SCHEDULE_MISSED_GRACE_MS
    ) {
      result.push(event('schedule_missed', 'schedule', {
        sourceType: 'scheduled_task',
        sourceId: task.id,
        sourceRef: null,
        dedupeKey: dedupeKeys.scheduleMissed(task.id, task.runAt),
        sourceVersion: 0,
        title: `一次性提醒未按时执行：${task.name}`,
        summary: `计划 ${formatDateTime(task.runAt)} 执行，当时应用可能未运行。它仍会补发；确认不需要的话可以停用。`,
        urgency: 'normal',
        dueAt: task.runAt,
        occurredAt: task.runAt + SCHEDULE_MISSED_GRACE_MS,
      }));
    }
  }
  return result;
}

export function projectDocumentEvents(documents: DocumentSourceState[], now: number): ProjectedEvent[] {
  const result: ProjectedEvent[] = [];
  for (const document of documents) {
    if (document.status === 'deleted' || document.status === 'superseded') continue;
    const name = document.title || document.filename;
    // 文档状态没有"开始于何时"的真源：用来源基线 / 导入时间作为稳定时间，并且不设过期（状态存在事件就存在）。
    const occurredAt = Math.min(now, document.sourceModifiedAt ?? document.importedAt);
    if (document.status === 'index_failed') {
      result.push(event('document_sync_failed', 'document', {
        sourceType: 'document',
        sourceId: document.id,
        sourceRef: null,
        dedupeKey: dedupeKeys.document(document.id, 'sync_failed', document.version),
        sourceVersion: document.version,
        title: `文档索引失败：${name}`,
        summary: `${document.statusError ? `原因：${document.statusError}。` : ''}打开泰提斯终端可重试或移除；不会自动重建。`,
        urgency: 'normal',
        dueAt: null,
        occurredAt,
        expiresAt: null,
      }));
      continue;
    }
    if (document.sourceKind !== 'local_file') continue;
    if (document.freshnessStatus === 'changed') {
      result.push(event('document_changed', 'document', {
        sourceType: 'document',
        sourceId: document.id,
        sourceRef: null,
        dedupeKey: dedupeKeys.document(document.id, 'changed', document.version),
        sourceVersion: document.version,
        title: `本地文件已变化：${name}`,
        summary: '知识库里的内容比本地文件旧。打开泰提斯终端可同步新版本或保留当前快照。',
        urgency: 'low',
        dueAt: null,
        occurredAt,
        expiresAt: null,
      }));
    } else if (document.freshnessStatus === 'missing') {
      result.push(event('document_missing', 'document', {
        sourceType: 'document',
        sourceId: document.id,
        sourceRef: null,
        dedupeKey: dedupeKeys.document(document.id, 'missing', document.version),
        sourceVersion: document.version,
        title: `本地文件找不到了：${name}`,
        summary: '来源文件被移动或删除，知识库仍保留快照。打开泰提斯终端可重新定位或保留快照。',
        urgency: 'normal',
        dueAt: null,
        occurredAt,
        expiresAt: null,
      }));
    } else if (document.freshnessStatus === 'unknown' && document.staleReason) {
      result.push(event('document_sync_failed', 'document', {
        sourceType: 'document',
        sourceId: document.id,
        sourceRef: null,
        dedupeKey: dedupeKeys.document(document.id, 'sync_failed', document.version),
        sourceVersion: document.version,
        title: `文档来源检查失败：${name}`,
        summary: `原因：${document.staleReason}。打开泰提斯终端可重试检查。`,
        urgency: 'low',
        dueAt: null,
        occurredAt,
        expiresAt: null,
      }));
    }
  }
  return result;
}

export function projectMemoryEvents(
  candidates: MemoryCandidateInfo[],
  memories: MemorySourceState[],
  now: number,
): ProjectedEvent[] {
  const result: ProjectedEvent[] = [];
  for (const candidate of candidates) {
    if (candidate.status !== 'pending') continue;
    // 摘要只保留记忆键，不复制候选内容：敏感事实不能进入收件箱正文。
    const keyLabel = candidate.memoryKey ? `「${candidate.memoryKey}」` : '';
    if (candidate.conflictsWithMemoryId) {
      result.push(event('memory_conflict', 'memory', {
        sourceType: 'memory_candidate',
        sourceId: candidate.id,
        sourceRef: `memory:${candidate.conflictsWithMemoryId}`,
        dedupeKey: dedupeKeys.memory(candidate.id, 'conflict'),
        sourceVersion: 0,
        title: `记忆冲突待裁决${keyLabel}`,
        summary: '新识别的事实与已有记忆不一致。打开记忆页可以选择保留旧的、替换为新的或忽略。',
        urgency: 'normal',
        dueAt: null,
        occurredAt: candidate.createdAt,
      }));
      continue;
    }
    if (candidate.sensitivity === 'sensitive' || candidate.sensitivity === 'private') {
      result.push(event('memory_sensitive', 'memory', {
        sourceType: 'memory_candidate',
        sourceId: candidate.id,
        sourceRef: null,
        dedupeKey: dedupeKeys.memory(candidate.id, 'sensitive'),
        sourceVersion: 0,
        title: `敏感记忆待确认${keyLabel}`,
        summary: '识别到一条私密或敏感的个人事实，未经确认不会写入记忆，也不会提供给模型。',
        urgency: 'normal',
        dueAt: null,
        occurredAt: candidate.createdAt,
      }));
    }
  }
  for (const memory of memories) {
    if (memory.status !== 'active' || memory.expiresAt == null) continue;
    if (memory.expiresAt - now > MEMORY_EXPIRING_MS) continue;
    const expired = memory.expiresAt <= now;
    result.push(event('memory_expiring', 'memory', {
      sourceType: 'memory',
      sourceId: memory.id,
      sourceRef: memory.memoryKey ? `memory_key:${memory.memoryKey}` : null,
      dedupeKey: dedupeKeys.memory(memory.id, 'expiring'),
      sourceVersion: 0,
      title: expired ? `记忆已过期${memory.memoryKey ? `「${memory.memoryKey}」` : ''}` : `记忆即将过期${memory.memoryKey ? `「${memory.memoryKey}」` : ''}`,
      summary: `${expired ? '已于' : '将于'} ${localDateKey(memory.expiresAt)} 失效。打开记忆页可以续期、修改或删除。`,
      urgency: 'low',
      dueAt: memory.expiresAt,
      occurredAt: Math.min(now, memory.expiresAt - MEMORY_EXPIRING_MS),
      expiresAt: memory.expiresAt + 7 * DAY_MS,
    }));
  }
  return result;
}

export function projectGoalEvents(goals: GoalSourceState[], now: number): ProjectedEvent[] {
  const result: ProjectedEvent[] = [];
  const todayStart = parseLocalDate(localDateKey(now))!;
  for (const goal of goals) {
    if (goal.status !== 'active') continue;
    const remainingTasks = goal.progress.totalTasks - goal.progress.doneTasks;
    const unfinished = remainingTasks > 0 || goal.progress.openCommitments > 0;
    if (goal.targetDate) {
      const target = parseLocalDate(goal.targetDate);
      if (target != null) {
        const daysLeft = Math.round((target - todayStart) / DAY_MS);
        if (daysLeft <= GOAL_TARGET_NEAR_DAYS && unfinished) {
          result.push(event('goal_target_near', 'goal', {
            sourceType: 'goal',
            sourceId: goal.id,
            sourceRef: null,
            dedupeKey: dedupeKeys.goal(goal.id, 'target_near', goal.targetDate),
            sourceVersion: 0,
            title: daysLeft < 0 ? `目标已过目标日：${goal.title}` : `目标临近：${goal.title}`,
            summary: `目标日期 ${goal.targetDate}，待办 ${goal.progress.doneTasks}/${goal.progress.totalTasks}，未完成承诺 ${goal.progress.openCommitments}。可以调整目标日期、暂停或关闭。`,
            urgency: daysLeft < 0 ? 'normal' : 'low',
            dueAt: target + DAY_MS - 1,
            occurredAt: Math.min(now, target - GOAL_TARGET_NEAR_DAYS * DAY_MS),
          }));
          continue;
        }
      }
    }
    if (unfinished && now - goal.lastActivityAt >= GOAL_STALLED_MS) {
      result.push(event('goal_stalled', 'goal', {
        sourceType: 'goal',
        sourceId: goal.id,
        sourceRef: null,
        dedupeKey: dedupeKeys.goal(goal.id, 'stalled', localDateKey(goal.lastActivityAt)),
        sourceVersion: 0,
        title: `目标长时间没有推进：${goal.title}`,
        summary: `自 ${localDateKey(goal.lastActivityAt)} 起没有待办或承诺更新。有新进展、暂停或关闭后此提示自动消失。`,
        urgency: 'low',
        dueAt: null,
        occurredAt: goal.lastActivityAt + GOAL_STALLED_MS,
      }));
    }
  }
  return result;
}

export function projectLocalEvents(snapshot: LocalStateSnapshot): ProjectionResult {
  const events: ProjectedEvent[] = [];
  const completeDomains: ProactiveEventDomain[] = [];
  const coveredDomains: ProactiveEventDomain[] = [];
  const now = snapshot.now;

  const cover = (domain: ProactiveEventDomain, complete: boolean) => {
    coveredDomains.push(domain);
    if (complete) completeDomains.push(domain);
  };

  if (snapshot.tasks) {
    events.push(...projectTaskEvents(snapshot.tasks.items, now));
    cover('task', snapshot.tasks.complete);
  }
  if (snapshot.commitments) {
    events.push(...projectCommitmentEvents(snapshot.commitments.items, now));
    cover('commitment', snapshot.commitments.complete);
  }
  if (snapshot.runs) {
    events.push(...projectRunEvents(snapshot.runs.items, now));
    cover('run', snapshot.runs.complete);
  }
  if (snapshot.schedules) {
    events.push(...projectScheduleEvents(snapshot.schedules.items, now));
    cover('schedule', snapshot.schedules.complete);
  }
  if (snapshot.documents) {
    events.push(...projectDocumentEvents(snapshot.documents.items, now));
    cover('document', snapshot.documents.complete);
  }
  if (snapshot.memoryCandidates || snapshot.memories) {
    events.push(...projectMemoryEvents(
      snapshot.memoryCandidates?.items ?? [],
      snapshot.memories?.items ?? [],
      now,
    ));
    cover('memory', (snapshot.memoryCandidates?.complete ?? true) && (snapshot.memories?.complete ?? true));
  }
  if (snapshot.goals) {
    events.push(...projectGoalEvents(snapshot.goals.items, now));
    cover('goal', snapshot.goals.complete);
  }

  // 同一 dedupe key 在一次投影中只保留一条（优先紧急度高者）。
  const byKey = new Map<string, ProjectedEvent>();
  const rank: Record<ProactiveEventUrgency, number> = { high: 0, normal: 1, low: 2 };
  for (const item of events) {
    const existing = byKey.get(item.dedupeKey);
    if (!existing || rank[item.urgency] < rank[existing.urgency]) byKey.set(item.dedupeKey, item);
  }
  return { events: [...byKey.values()], completeDomains, coveredDomains };
}
