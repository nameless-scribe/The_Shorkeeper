/**
 * P3 主动服务闭环：快照 → 投影 → 幂等写账本 → 自动解决 → 确定性路由 → 投递。
 * 弹窗与广播由调用方注入；这里不依赖 Electron。
 */
import type { AppDatabase } from '../db/contracts';
import { getDatabase } from '../db';
import type {
  ProactiveEventDomain,
  ProactiveEventInfo,
  ProactivityRoute,
} from '../shared/types';
import {
  expireProactiveEvents,
  getProactiveEvent,
  listActiveProactiveEventsByDomain,
  pruneHandledProactiveEvents,
  resolveProactiveEventsBySource,
  upsertProactiveEvent,
  wakeSnoozedProactiveEvents,
} from '../db/repositories/proactive-events';
import { getLatestDecisionForEvent, pruneDetachedDecisions, recordDecision } from '../db/repositories/proactivity-decisions';
import {
  cancelDelivery,
  claimDelivery,
  countPopupsSentSince,
  getLastSentPopupAt,
  getLatestDeliveryForEvent,
  listPlannedDeliveries,
  markDeliveryFailed,
  markDeliverySent,
  pruneDetachedDeliveries,
  rescheduleDelivery,
} from '../db/repositories/proactivity-deliveries';
import { projectLocalEvents } from './collector';
import {
  HANDLED_EVENT_RETENTION_MS,
  SOURCE_RESOLVED_REASON,
  idempotencyKeys,
} from './contract';
import type { ProactivityCycleTrigger } from './coordinator';
import { loadLocalStateSnapshot } from './sources';
import {
  reevaluateDeferredDelivery,
  routeProactiveEvent,
  startOfLocalDay,
  type NotificationBudgetState,
  type ProactivityPolicySettings,
} from './policy';

export interface ProactivityServiceDeps {
  db?: AppDatabase;
  now?: () => number;
  getSettings: () => ProactivityPolicySettings;
  /** 即时弹窗；失败抛错即视为投递失败 */
  popup: (title: string, body: string) => Promise<void>;
  /** 收件箱有变化（新事件、状态变化、投递）时通知界面 */
  onInboxChanged?: (summary: CycleReport) => void;
  log?: (message: string) => void;
}

export interface CycleReport {
  trigger: ProactivityCycleTrigger;
  startedAt: number;
  finishedAt: number;
  domains: ProactiveEventDomain[] | 'all';
  projected: number;
  created: number;
  updated: number;
  superseded: number;
  resolvedBySource: number;
  expired: number;
  woken: number;
  routed: Record<ProactivityRoute, number>;
  popupsSent: number;
  popupsFailed: number;
  deferredReplayed: number;
  duplicatesBlocked: number;
  changed: boolean;
}

function emptyRouted(): Record<ProactivityRoute, number> {
  return { inbox: 0, notify: 0, defer: 0, suppress: 0 };
}

export function readNotificationBudget(now: number, db: AppDatabase): NotificationBudgetState {
  return {
    sentLastHour: countPopupsSentSince(now - 60 * 60 * 1000, db),
    sentToday: countPopupsSentSince(startOfLocalDay(now), db),
  };
}

function popupBody(event: ProactiveEventInfo): string {
  return event.summary ?? event.title;
}

/** 把一条事件按确定性策略路由并记账；attempt 区分首次、唤醒与补发。 */
export async function routeAndDeliverEvent(
  event: ProactiveEventInfo,
  attempt: string,
  deps: ProactivityServiceDeps,
  report: CycleReport,
): Promise<void> {
  const db = deps.db ?? getDatabase();
  const now = deps.now?.() ?? Date.now();
  // 同一周期里事件可能已被来源解决或用户处理：以账本当前状态为准，不用采集时的快照。
  const fresh = getProactiveEvent(event.id, db);
  if (!fresh || fresh.status !== 'open') return;
  event = fresh;
  const settings = deps.getSettings();
  const budget = readNotificationBudget(now, db);
  const latestDelivery = getLatestDeliveryForEvent(event.id, db);
  const decision = routeProactiveEvent({
    event,
    now,
    settings,
    budget,
    lastPopupAt: getLastSentPopupAt('event', event.id, db),
    // 稍后提醒唤醒、以及来源恢复后再次出现的同一状态，都允许再评估一次弹窗；
    // 其余情况下同一版本只弹一次。重复轰炸仍由去重窗口与频率预算兜底。
    alreadyDelivered: attempt.startsWith('wake:') || attempt.startsWith('reopen:')
      ? false
      : latestDelivery?.status === 'sent' &&
        latestDelivery.channel === 'popup' &&
        latestDelivery.deliveryKey.includes(`:${event.sourceVersion}:`),
  });

  const recorded = recordDecision({
    decisionKey: idempotencyKeys.eventDecision(event.id, event.sourceVersion, attempt),
    subjectKind: 'event',
    subjectId: event.id,
    eventId: event.id,
    policy: decision.policy,
    route: decision.route,
    reason: decision.reason,
    ruleVersion: decision.ruleVersion,
    evaluatedAt: now,
  }, db);
  if (!recorded.created) {
    // 同一版本同一 attempt 已经评估过：不重复投递。
    report.duplicatesBlocked += 1;
    return;
  }
  report.routed[decision.route] += 1;

  if (decision.route === 'inbox' || decision.route === 'suppress') {
    // 收件箱本身就是事件账本；这里只需记录一次 inbox 投递以便 UI 显示"为什么出现"。
    if (decision.route === 'inbox') {
      const claimed = claimDelivery({
        deliveryKey: `${idempotencyKeys.eventDelivery(event.id, event.sourceVersion)}:inbox:${attempt}`,
        subjectKind: 'event',
        subjectId: event.id,
        eventId: event.id,
        channel: 'inbox',
      }, db);
      if (claimed.claimed) markDeliverySent(claimed.delivery.id, now, db);
    }
    return;
  }

  const deliveryKey = `${idempotencyKeys.eventDelivery(event.id, event.sourceVersion)}:popup:${attempt}`;
  const claimed = claimDelivery({
    deliveryKey,
    subjectKind: 'event',
    subjectId: event.id,
    eventId: event.id,
    channel: 'popup',
    scheduledAt: decision.route === 'defer' ? decision.deferUntil : now,
  }, db);
  if (!claimed.claimed) {
    report.duplicatesBlocked += 1;
    return;
  }
  if (decision.route === 'defer') {
    deps.log?.(`[proactivity] 事件「${event.title}」处于安静时段，延后到 ${new Date(decision.deferUntil ?? now).toLocaleString()}`);
    return;
  }
  try {
    await deps.popup(event.title, popupBody(event));
    markDeliverySent(claimed.delivery.id, now, db);
    report.popupsSent += 1;
  } catch (error) {
    markDeliveryFailed(claimed.delivery.id, error instanceof Error ? error.name || 'popup_error' : 'popup_error', db);
    report.popupsFailed += 1;
    deps.log?.(`[proactivity] 事件弹窗失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 安静时段结束 / 预算恢复后补发已延后的弹窗；不满足条件则继续延后或转为收件箱。 */
export async function replayDeferredDeliveries(
  deps: ProactivityServiceDeps,
  report: CycleReport,
): Promise<void> {
  const db = deps.db ?? getDatabase();
  const now = deps.now?.() ?? Date.now();
  const planned = listPlannedDeliveries({ channel: 'popup', dueBefore: now, limit: 50 }, db);
  if (!planned.length) return;
  const settings = deps.getSettings();
  for (const delivery of planned) {
    if (!delivery.eventId) {
      cancelDelivery(delivery.id, db);
      continue;
    }
    const event = getProactiveEvent(delivery.eventId, db);
    if (!event || event.status !== 'open') {
      cancelDelivery(delivery.id, db);
      continue;
    }
    const budget = readNotificationBudget(now, db);
    const decision = reevaluateDeferredDelivery({ event, now, settings, budget });
    recordDecision({
      decisionKey: idempotencyKeys.eventDecision(event.id, event.sourceVersion, `replay:${delivery.scheduledAt ?? now}`),
      subjectKind: 'event',
      subjectId: event.id,
      eventId: event.id,
      policy: decision.policy,
      route: decision.route,
      reason: decision.reason,
      ruleVersion: decision.ruleVersion,
      evaluatedAt: now,
    }, db);
    if (decision.route === 'notify') {
      try {
        await deps.popup(event.title, popupBody(event));
        markDeliverySent(delivery.id, now, db);
        report.popupsSent += 1;
        report.deferredReplayed += 1;
        report.changed = true;
      } catch (error) {
        markDeliveryFailed(delivery.id, error instanceof Error ? error.name || 'popup_error' : 'popup_error', db);
        report.popupsFailed += 1;
      }
    } else if (decision.route === 'defer' && decision.deferUntil != null) {
      // 仍在安静时段：只推迟计划时间，不产生新记录。
      rescheduleDelivery(delivery.id, decision.deferUntil, db);
    } else {
      // 预算耗尽、域被静音或事件已不适合弹窗：取消弹窗，事件继续留在收件箱。
      cancelDelivery(delivery.id, db);
      report.changed = true;
    }
  }
}

export async function runProactivityCycle(
  deps: ProactivityServiceDeps,
  options: { domains?: ReadonlySet<ProactiveEventDomain> | null; trigger?: ProactivityCycleTrigger } = {},
): Promise<CycleReport> {
  const db = deps.db ?? getDatabase();
  const now = deps.now?.() ?? Date.now();
  const trigger = options.trigger ?? 'manual';
  const domains = options.domains ?? null;
  const report: CycleReport = {
    trigger,
    startedAt: now,
    finishedAt: now,
    domains: domains == null ? 'all' : [...domains],
    projected: 0,
    created: 0,
    updated: 0,
    superseded: 0,
    resolvedBySource: 0,
    expired: 0,
    woken: 0,
    routed: emptyRouted(),
    popupsSent: 0,
    popupsFailed: 0,
    deferredReplayed: 0,
    duplicatesBlocked: 0,
    changed: false,
  };

  const settings = deps.getSettings();
  if (!settings.proactivityEnabled) {
    // 全局关闭：不投影、不弹窗、不补发；已有记录原样保留（是否清空由设置变更时决定）。
    report.finishedAt = deps.now?.() ?? Date.now();
    return report;
  }

  const woken = wakeSnoozedProactiveEvents(now, db);
  report.woken = woken.length;
  report.expired = expireProactiveEvents(now, db);
  if (report.woken || report.expired) report.changed = true;

  const toRoute: Array<{ event: ProactiveEventInfo; attempt: string }> = [];
  for (const event of woken) toRoute.push({ event, attempt: `wake:${event.updatedAt}` });

  const scanDomains = domains == null || domains.size > 0;
  if (scanDomains) {
    const snapshot = loadLocalStateSnapshot(domains, now, db);
    const projection = projectLocalEvents(snapshot);
    report.projected = projection.events.length;

    const produced = new Set<string>();
    // 每条 upsert 自带事务；这里不外包事务（适配器不支持嵌套），只用批次延迟 sql.js 的落盘次数。
    db.beginBatch();
    try {
      for (const projected of projection.events) {
        produced.add(projected.dedupeKey);
        const result = upsertProactiveEvent(projected, db);
        if (result.outcome === 'created' || result.outcome === 'reopened') report.created += 1;
        else if (result.outcome === 'updated') report.updated += 1;
        else if (result.outcome === 'superseded') report.superseded += 1;
        if (result.outcome === 'created' || result.outcome === 'superseded') {
          toRoute.push({ event: result.event, attempt: 'initial' });
        } else if (result.outcome === 'reopened') {
          // 复用原行意味着 (eventId, sourceVersion, 'initial') 已被首次决策占用；
          // 不带重开时间就会被当成重复拦下，事件回到收件箱却再也不会路由或通知。
          toRoute.push({ event: result.event, attempt: `reopen:${result.event.updatedAt}` });
        } else if (result.outcome === 'updated' && result.event.status === 'open') {
          // 紧急度升级（如承诺进入 2 小时窗口）时允许再评估一次；决策键含紧急度，不会反复弹窗。
          const latest = getLatestDecisionForEvent(result.event.id, db);
          if (latest && result.event.urgency === 'high' && latest.route === 'inbox') {
            toRoute.push({ event: result.event, attempt: `urgency:${result.event.urgency}` });
          }
        }
      }
      for (const domain of projection.completeDomains) {
        const stale = listActiveProactiveEventsByDomain(domain, db).filter((event) => !produced.has(event.dedupeKey));
        if (stale.length) {
          report.resolvedBySource += resolveProactiveEventsBySource(
            stale.map((event) => ({ dedupeKey: event.dedupeKey })),
            SOURCE_RESOLVED_REASON(domain),
            now,
            db,
          );
          for (const event of stale) {
            const delivery = getLatestDeliveryForEvent(event.id, db);
            if (delivery?.status === 'planned') cancelDelivery(delivery.id, db);
          }
        }
      }
    } finally {
      db.endBatch();
    }
    if (report.created || report.updated || report.superseded || report.resolvedBySource) report.changed = true;
  }

  for (const item of toRoute) {
    await routeAndDeliverEvent(item.event, item.attempt, deps, report);
  }
  await replayDeferredDeliveries(deps, report);

  if (trigger === 'sweep' || trigger === 'startup') {
    const cutoff = now - HANDLED_EVENT_RETENTION_MS;
    pruneHandledProactiveEvents(cutoff, db);
    pruneDetachedDecisions(cutoff, db);
    pruneDetachedDeliveries(cutoff, db);
  }

  report.finishedAt = deps.now?.() ?? Date.now();
  if (report.changed) deps.onInboxChanged?.(report);
  return report;
}
