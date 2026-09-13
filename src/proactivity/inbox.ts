/**
 * 主动收件箱：读取三段视图、记录用户反馈、解析来源回链、汇总两周指标。
 * 处理动作只改事件状态与反馈账本；修改待办、承诺、文档或记忆仍走各自的工具与页面。
 */
import type { AppDatabase } from '../db/contracts';
import { getDatabase } from '../db';
import type {
  ProactiveEventInfo,
  ProactiveInboxItemInfo,
  ProactiveInboxSnapshot,
  ProactiveSourceTarget,
  ProactivityFeedbackReason,
  ProactivityMetricsInfo,
} from '../shared/types';
import {
  countProactiveEventsCreatedSince,
  countProactiveEventsResolvedBySourceSince,
  countUnreadProactiveEvents,
  getProactiveEvent,
  listProactiveEvents,
  markAllProactiveEventsRead,
  markProactiveEventRead,
  pruneHandledProactiveEvents,
  setProactiveEventStatus,
} from '../db/repositories/proactive-events';
import { countDecisionsByRouteSince, getLatestDecisionForEvent } from '../db/repositories/proactivity-decisions';
import { cancelDelivery, getLatestDeliveryForEvent, listDeliveries } from '../db/repositories/proactivity-deliveries';
import { countFeedbackByActionSince, recordFeedback } from '../db/repositories/proactivity-feedback';
import { getCommitment, updateCommitment } from '../db/repositories/commitments';
import { canTransitionEventStatus, isSnoozePreset } from './contract';

const HANDLED_LIMIT = 50;

function toInboxItem(event: ProactiveEventInfo, db: AppDatabase): ProactiveInboxItemInfo {
  const decision = getLatestDecisionForEvent(event.id, db);
  const delivery = getLatestDeliveryForEvent(event.id, db);
  return {
    event,
    lastRoute: decision?.route ?? null,
    lastRouteReason: decision?.reason ?? null,
    deliveredAt: delivery?.channel === 'popup' && delivery.status === 'sent' ? delivery.sentAt : null,
    deferredUntil: delivery?.channel === 'popup' && delivery.status === 'planned' ? delivery.scheduledAt : null,
  };
}

export function getInboxSnapshot(db: AppDatabase = getDatabase()): ProactiveInboxSnapshot {
  const attention = listProactiveEvents({ statuses: ['open'], limit: 200 }, db).map((event) => toInboxItem(event, db));
  const later = listProactiveEvents({ statuses: ['snoozed'], limit: 200 }, db).map((event) => toInboxItem(event, db));
  const handled = listProactiveEvents({ statuses: ['resolved', 'dismissed'], orderBy: 'updated', limit: HANDLED_LIMIT }, db)
    .map((event) => toInboxItem(event, db));
  return {
    attention,
    later,
    handled,
    unreadCount: countUnreadProactiveEvents(db),
    generatedAt: Date.now(),
  };
}

export function getUnreadCount(db: AppDatabase = getDatabase()): number {
  return countUnreadProactiveEvents(db);
}

export function markInboxEventRead(id: string, db: AppDatabase = getDatabase()): ProactiveEventInfo | null {
  const existing = getProactiveEvent(id, db);
  if (!existing) return null;
  if (existing.readAt == null) {
    recordFeedback({ eventId: id, action: 'opened' }, db);
  }
  return markProactiveEventRead(id, db);
}

export function markAllInboxRead(db: AppDatabase = getDatabase()): number {
  return markAllProactiveEventsRead(db);
}

function cancelPlannedPopup(eventId: string, db: AppDatabase): void {
  const delivery = getLatestDeliveryForEvent(eventId, db);
  if (delivery?.status === 'planned') cancelDelivery(delivery.id, db);
}

export function dismissInboxEvent(
  id: string,
  reason: ProactivityFeedbackReason | null = null,
  db: AppDatabase = getDatabase(),
): ProactiveEventInfo | null {
  return db.transaction(() => {
    const existing = getProactiveEvent(id, db);
    if (!existing) return null;
    if (!canTransitionEventStatus(existing.status, 'dismissed')) return existing;
    cancelPlannedPopup(id, db);
    const updated = setProactiveEventStatus(id, 'dismissed', { reason: reason ?? 'user' }, db);
    recordFeedback({ eventId: id, action: 'dismissed', reasonCode: reason }, db);
    return updated;
  });
}

export function snoozeInboxEvent(
  id: string,
  minutes: number,
  now = Date.now(),
  db: AppDatabase = getDatabase(),
): ProactiveEventInfo | null {
  if (!isSnoozePreset(minutes)) throw new Error('不支持的稍后提醒时长');
  return db.transaction(() => {
    const existing = getProactiveEvent(id, db);
    if (!existing) return null;
    if (!canTransitionEventStatus(existing.status, 'snoozed')) return existing;
    cancelPlannedPopup(id, db);
    const updated = setProactiveEventStatus(id, 'snoozed', { snoozedUntil: now + minutes * 60_000, now }, db);
    recordFeedback({ eventId: id, action: 'snoozed', reasonCode: 'later', at: now }, db);
    return updated;
  });
}

export function resolveInboxEvent(
  id: string,
  reason: ProactivityFeedbackReason | null = 'already_handled',
  db: AppDatabase = getDatabase(),
): ProactiveEventInfo | null {
  return db.transaction(() => {
    const existing = getProactiveEvent(id, db);
    if (!existing) return null;
    if (!canTransitionEventStatus(existing.status, 'resolved')) return existing;
    cancelPlannedPopup(id, db);
    const updated = setProactiveEventStatus(id, 'resolved', { reason: `user:${reason ?? 'done'}` }, db);
    recordFeedback({ eventId: id, action: 'resolved', reasonCode: reason }, db);
    return updated;
  });
}

/** 批量清理已处理事件：删除 resolved / dismissed 记录（含决策、投递、反馈）。 */
export function clearHandledInboxEvents(db: AppDatabase = getDatabase()): number {
  return pruneHandledProactiveEvents(Date.now() + 1, db);
}

/**
 * 解析来源回链：返回渲染层应打开的页面与建议提示。
 * 打开来源只记录反馈；"承诺久未跟进"额外记录一次 last_followed_up_at，这是唯一的领域写操作，
 * 且只更新跟进时间，不改变承诺状态。
 */
export function openInboxEventSource(id: string, db: AppDatabase = getDatabase()): ProactiveSourceTarget | null {
  const event = getProactiveEvent(id, db);
  if (!event) return null;
  db.transaction(() => {
    markProactiveEventRead(id, db);
    recordFeedback({ eventId: id, action: 'accepted', reasonCode: 'source_opened' }, db);
    if (event.kind === 'commitment_unattended' && event.sourceType === 'commitment') {
      const commitment = getCommitment(event.sourceId, db);
      if (commitment && commitment.status === 'open') {
        updateCommitment(commitment.id, { lastFollowedUpAt: Date.now() }, db);
      }
    }
  });
  return resolveSourceTarget(event);
}

export function resolveSourceTarget(event: ProactiveEventInfo): ProactiveSourceTarget {
  const base = {
    domain: event.domain,
    sourceType: event.sourceType,
    sourceId: event.sourceId,
    sourceRef: event.sourceRef,
  };
  switch (event.domain) {
    case 'task':
      return { ...base, open: 'userTodos', suggestedPrompt: null };
    case 'commitment':
      return {
        ...base,
        open: event.kind === 'commitment_proposed' ? 'chat' : 'userTodos',
        suggestedPrompt: event.kind === 'commitment_proposed'
          ? `请列出待确认的承诺，我来决定是否加入待办。`
          : null,
      };
    case 'run':
      return { ...base, open: 'runs', suggestedPrompt: null };
    case 'schedule':
      return { ...base, open: 'tasks', suggestedPrompt: null };
    case 'document':
      return { ...base, open: 'documents', suggestedPrompt: null };
    case 'memory':
      return { ...base, open: 'memory', suggestedPrompt: null };
    case 'goal':
      return {
        ...base,
        open: 'chat',
        suggestedPrompt: `请列出目标「${event.title.replace(/^[^：]*：/, '')}」的进度，我来决定是否调整。`,
      };
    default:
      return { ...base, open: 'chat', suggestedPrompt: null };
  }
}

export function getProactivityMetrics(
  since: number,
  until = Date.now(),
  db: AppDatabase = getDatabase(),
): ProactivityMetricsInfo {
  const routed = countDecisionsByRouteSince(since, db);
  const feedback = countFeedbackByActionSince(since, db);
  const deliveries = listDeliveries({ subjectKind: 'event', since, limit: 1000 }, db);
  const duplicateDeliveriesBlocked = deliveries.filter((item) => item.status === 'cancelled').length;
  return {
    since,
    until,
    eventsCreated: countProactiveEventsCreatedSince(since, db),
    notified: routed.notify,
    inboxed: routed.inbox,
    deferred: routed.defer,
    suppressed: routed.suppress,
    duplicateDeliveriesBlocked,
    opened: feedback.opened,
    accepted: feedback.accepted,
    dismissed: feedback.dismissed,
    snoozed: feedback.snoozed,
    resolvedBySource: countProactiveEventsResolvedBySourceSince(since, db),
  };
}
