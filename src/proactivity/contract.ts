/**
 * P3.0 事件契约：事件类型、紧急度、状态机、稳定去重键、解除条件与路由矩阵。
 * 这里只有常量与纯函数，不访问数据库；collector / policy / repository 均以此为准。
 */
import type {
  ProactiveEventDomain,
  ProactiveEventKind,
  ProactiveEventStatus,
  ProactiveEventUrgency,
  ProactivityRoute,
} from '../shared/types';

export const PROACTIVITY_RULE_VERSION = 'p3.1';

export const PROACTIVE_EVENT_DOMAINS = [
  'task',
  'commitment',
  'run',
  'schedule',
  'document',
  'memory',
  'goal',
] as const satisfies readonly ProactiveEventDomain[];

export const PROACTIVE_EVENT_KINDS = [
  'task_due_today',
  'task_overdue',
  'commitment_due_soon',
  'commitment_missed',
  'commitment_proposed',
  'commitment_unattended',
  'run_error',
  'run_interrupted',
  'schedule_failed',
  'schedule_missed',
  'document_changed',
  'document_missing',
  'document_sync_failed',
  'memory_conflict',
  'memory_sensitive',
  'memory_expiring',
  'goal_target_near',
  'goal_stalled',
] as const satisfies readonly ProactiveEventKind[];

export const PROACTIVE_EVENT_URGENCIES = ['low', 'normal', 'high'] as const satisfies readonly ProactiveEventUrgency[];

export const PROACTIVE_EVENT_STATUSES = [
  'open',
  'snoozed',
  'dismissed',
  'resolved',
] as const satisfies readonly ProactiveEventStatus[];

export const PROACTIVITY_ROUTES = ['inbox', 'notify', 'defer', 'suppress'] as const satisfies readonly ProactivityRoute[];

/** 事件正文限长：标题一行，摘要不超过两三句；不复制 prompt、文档内容或聊天正文。 */
export const MAX_EVENT_TITLE_CHARS = 120;
export const MAX_EVENT_SUMMARY_CHARS = 280;

export const EVENT_DOMAIN_BY_KIND: Record<ProactiveEventKind, ProactiveEventDomain> = {
  task_due_today: 'task',
  task_overdue: 'task',
  commitment_due_soon: 'commitment',
  commitment_missed: 'commitment',
  commitment_proposed: 'commitment',
  commitment_unattended: 'commitment',
  run_error: 'run',
  run_interrupted: 'run',
  schedule_failed: 'schedule',
  schedule_missed: 'schedule',
  document_changed: 'document',
  document_missing: 'document',
  document_sync_failed: 'document',
  memory_conflict: 'memory',
  memory_sensitive: 'memory',
  memory_expiring: 'memory',
  goal_target_near: 'goal',
  goal_stalled: 'goal',
};

export const EVENT_DOMAIN_LABELS: Record<ProactiveEventDomain, string> = {
  task: '待办',
  commitment: '承诺',
  run: '运行',
  schedule: '定时任务',
  document: '知识文档',
  memory: '记忆',
  goal: '目标',
};

export const EVENT_KIND_LABELS: Record<ProactiveEventKind, string> = {
  task_due_today: '今日到期',
  task_overdue: '已逾期',
  commitment_due_soon: '承诺临期',
  commitment_missed: '承诺错过',
  commitment_proposed: '待确认承诺',
  commitment_unattended: '承诺久未跟进',
  run_error: '运行失败',
  run_interrupted: '运行中断',
  schedule_failed: '定时任务失败',
  schedule_missed: '定时任务错过',
  document_changed: '文档已变化',
  document_missing: '文档丢失',
  document_sync_failed: '文档同步失败',
  memory_conflict: '记忆冲突',
  memory_sensitive: '敏感记忆待确认',
  memory_expiring: '记忆即将过期',
  goal_target_near: '目标临近',
  goal_stalled: '目标停滞',
};

/**
 * 路由矩阵：每种事件默认进哪个渠道。
 * - notify 只给"接近不可恢复截止"或"需要立即处理的本地故障"；其余一律默认收件箱。
 * - 显式定时提醒不在此表中：它们仍按用户订阅的到点提醒规则 notify。
 */
export const DEFAULT_ROUTE_BY_KIND: Record<ProactiveEventKind, Exclude<ProactivityRoute, 'defer' | 'suppress'>> = {
  task_due_today: 'inbox',
  task_overdue: 'inbox',
  commitment_due_soon: 'inbox',
  commitment_missed: 'inbox',
  commitment_proposed: 'inbox',
  commitment_unattended: 'inbox',
  run_error: 'inbox',
  run_interrupted: 'inbox',
  schedule_failed: 'inbox',
  schedule_missed: 'inbox',
  document_changed: 'inbox',
  document_missing: 'inbox',
  document_sync_failed: 'inbox',
  memory_conflict: 'inbox',
  memory_sensitive: 'inbox',
  memory_expiring: 'inbox',
  goal_target_near: 'inbox',
  goal_stalled: 'inbox',
};

/** 高紧急度且属于以下类型的事件才允许升级为即时弹窗。 */
export const NOTIFY_ELIGIBLE_KINDS: ReadonlySet<ProactiveEventKind> = new Set<ProactiveEventKind>([
  'commitment_due_soon',
  'commitment_missed',
  'schedule_failed',
]);

/** 承诺"临期"窗口：截止前 24 小时内进入收件箱；截止前 2 小时内且高优先级才弹窗。 */
export const COMMITMENT_DUE_SOON_MS = 24 * 60 * 60 * 1000;
export const COMMITMENT_NOTIFY_WINDOW_MS = 2 * 60 * 60 * 1000;
/** 承诺久未跟进：open 且距上次跟进（或创建）超过 7 天。 */
export const COMMITMENT_UNATTENDED_MS = 7 * 24 * 60 * 60 * 1000;
/** 目标临近：目标日期在 3 天内；目标停滞：14 天内没有任何待办 / 承诺更新。 */
export const GOAL_TARGET_NEAR_DAYS = 3;
export const GOAL_STALLED_MS = 14 * 24 * 60 * 60 * 1000;
/** 记忆临期：7 天内过期。 */
export const MEMORY_EXPIRING_MS = 7 * 24 * 60 * 60 * 1000;
/** 一次性定时任务错过：run_at 已过去超过 15 分钟仍未执行。 */
export const SCHEDULE_MISSED_GRACE_MS = 15 * 60 * 1000;
/** 运行失败事件只看最近 7 天；更早的失败不再打扰。 */
export const RUN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** 事件默认过期：出现 30 天后仍未处理则自动 resolved(expired)。 */
export const EVENT_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 已处理事件保留 90 天。 */
export const HANDLED_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** 每次采集每个来源域最多处理的对象数量：不阻塞启动或聊天。 */
export const MAX_SOURCE_ITEMS_PER_DOMAIN = 200;

/** 稳定去重键：同一来源同一状态窗口只对应一个活动事件。 */
export const dedupeKeys = {
  taskDue: (taskId: string, date: string) => `task:${taskId}:due:${date}`,
  taskOverdue: (taskId: string, date: string) => `task:${taskId}:overdue:${date}`,
  commitment: (commitmentId: string, state: string, window: string) => `commitment:${commitmentId}:${state}:${window}`,
  run: (runId: string, phase: string) => `run:${runId}:${phase}`,
  scheduleFailure: (taskId: string, window: string) => `schedule:${taskId}:failure:${window}`,
  scheduleMissed: (taskId: string, runAt: number) => `schedule:${taskId}:missed:${runAt}`,
  document: (documentId: string, state: string, version: number) => `doc:${documentId}:${state}:${version}`,
  memory: (id: string, state: string) => `memory:${id}:${state}`,
  goal: (goalId: string, state: string, window: string) => `goal:${goalId}:${state}:${window}`,
} as const;

/** 决策 / 投递幂等键。重复调度同一 subject 同一窗口不会生成第二条记录。 */
export const idempotencyKeys = {
  eventDecision: (eventId: string, sourceVersion: number, attempt: string) =>
    `decision:event:${eventId}:${sourceVersion}:${attempt}`,
  eventDelivery: (eventId: string, sourceVersion: number) => `delivery:event:${eventId}:${sourceVersion}`,
  reminderDecision: (taskId: string, firedAt: number) => `decision:reminder:${taskId}:${firedAt}`,
  reminderDelivery: (taskId: string, occurrence: string) => `delivery:reminder:${taskId}:${occurrence}`,
  stewardNotice: (taskId: string, date: string) => `delivery:steward:${taskId}:${date}`,
} as const;

/** 周期提醒的"本次"窗口：同一任务同一分钟只投递一次；跨重启依然成立。 */
export function reminderOccurrenceKey(firedAt: number): string {
  return String(Math.floor(firedAt / 60_000));
}

export function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 状态机：哪些转换合法。 */
export const EVENT_STATUS_TRANSITIONS: Record<ProactiveEventStatus, readonly ProactiveEventStatus[]> = {
  open: ['snoozed', 'dismissed', 'resolved'],
  snoozed: ['open', 'dismissed', 'resolved'],
  dismissed: ['resolved'],
  resolved: [],
};

export function canTransitionEventStatus(from: ProactiveEventStatus, to: ProactiveEventStatus): boolean {
  return EVENT_STATUS_TRANSITIONS[from].includes(to);
}

/** 稍后提醒的固定档位（分钟）：不接受任意自由输入。 */
export const SNOOZE_PRESETS_MINUTES = [30, 120, 24 * 60, 3 * 24 * 60] as const;

export function isSnoozePreset(minutes: number): boolean {
  return (SNOOZE_PRESETS_MINUTES as readonly number[]).includes(minutes);
}

/**
 * 解除条件说明（供文档与测试引用）：
 * - task：完成、取消或改期 → 旧 due/overdue 键不再由投影产生，collector 自动 resolved(source:task)。
 * - commitment：状态改变或用户处理 → 键中的 state 变化，旧事件 superseded / resolved。
 * - run：用户确认（acknowledged_at）→ resolved(source:run)。
 * - schedule：下次成功（failure_count 归零）或停用 → resolved(source:schedule)。
 * - document：同步成功 / 重新定位 / 保留快照 → freshness 变为 current/snapshot → resolved(source:document)。
 * - memory：候选已裁决或记忆续期 → resolved(source:memory)。
 * - goal：有新进展、暂停或关闭 → resolved(source:goal)。
 */
export const SOURCE_RESOLVED_REASON = (domain: ProactiveEventDomain) => `source:${domain}`;
