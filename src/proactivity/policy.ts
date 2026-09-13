/**
 * P3.3 路由策略：确定性规则决定本地事件进收件箱、即时弹窗、延后还是抑制。
 * 模型不参与；这里不访问数据库，所有输入由 service 从账本与设置读出后传入。
 */
import type {
  AssistantActionPolicy,
  ProactiveEventDomain,
  ProactiveEventInfo,
  ProactivityRoute,
  ProactivityRouteReason,
} from '../shared/types';
import { getQuietHoursEndAt, isRepeatedNotification, isWithinQuietHours } from '../assistant/proactivity';
import { DEFAULT_ROUTE_BY_KIND, NOTIFY_ELIGIBLE_KINDS, PROACTIVITY_RULE_VERSION } from './contract';

export interface ProactivityPolicySettings {
  proactivityEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  notificationDedupMinutes: number;
  notifyHourlyLimit: number;
  notifyDailyLimit: number;
  mutedEventDomains: ProactiveEventDomain[];
}

export interface NotificationBudgetState {
  sentLastHour: number;
  sentToday: number;
}

export interface EventRouteInput {
  event: Pick<ProactiveEventInfo, 'id' | 'kind' | 'domain' | 'urgency' | 'status' | 'expiresAt'>;
  now: number;
  settings: ProactivityPolicySettings;
  budget: NotificationBudgetState;
  /** 该事件（任意版本）最近一次成功弹窗时间；跨重启从投递账本读出 */
  lastPopupAt: number | null;
  /** 当前版本是否已经成功弹窗 */
  alreadyDelivered: boolean;
}

export interface EventRouteDecision {
  policy: AssistantActionPolicy;
  route: ProactivityRoute;
  reason: ProactivityRouteReason;
  /** route=defer 时的补发时间 */
  deferUntil: number | null;
  ruleVersion: string;
}

export function isNotificationBudgetExhausted(
  budget: NotificationBudgetState,
  settings: Pick<ProactivityPolicySettings, 'notifyHourlyLimit' | 'notifyDailyLimit'>,
): boolean {
  if (settings.notifyHourlyLimit > 0 && budget.sentLastHour >= settings.notifyHourlyLimit) return true;
  if (settings.notifyDailyLimit > 0 && budget.sentToday >= settings.notifyDailyLimit) return true;
  return false;
}

/** 本地事件是否具备弹窗资格：只有高紧急度且属于白名单类型的事件。 */
export function isNotifyEligible(event: Pick<ProactiveEventInfo, 'kind' | 'urgency'>): boolean {
  return event.urgency === 'high' && NOTIFY_ELIGIBLE_KINDS.has(event.kind);
}

export function routeProactiveEvent(input: EventRouteInput): EventRouteDecision {
  const { event, now, settings } = input;
  const decision = (
    policy: AssistantActionPolicy,
    route: ProactivityRoute,
    reason: ProactivityRouteReason,
    deferUntil: number | null = null,
  ): EventRouteDecision => ({ policy, route, reason, deferUntil, ruleVersion: PROACTIVITY_RULE_VERSION });

  if (event.status === 'resolved') return decision('silent', 'suppress', 'resolved');
  if (event.status === 'dismissed') return decision('silent', 'suppress', 'dismissed');
  if (event.status === 'snoozed') return decision('silent', 'suppress', 'snoozed');
  if (event.expiresAt != null && event.expiresAt <= now) return decision('silent', 'suppress', 'expired');
  if (!settings.proactivityEnabled) return decision('deny', 'suppress', 'disabled');

  const wantsNotify = isNotifyEligible(event) && DEFAULT_ROUTE_BY_KIND[event.kind] !== undefined;
  if (!wantsNotify) {
    return decision('silent', 'inbox', event.urgency === 'low' ? 'low_urgency' : 'inbox_default');
  }

  if (input.alreadyDelivered) return decision('silent', 'suppress', 'repeated');
  if (isRepeatedNotification(input.lastPopupAt, now, settings.notificationDedupMinutes)) {
    return decision('silent', 'suppress', 'repeated');
  }
  if (settings.mutedEventDomains.includes(event.domain)) return decision('silent', 'inbox', 'domain_muted');
  if (isNotificationBudgetExhausted(input.budget, settings)) return decision('silent', 'inbox', 'budget_exhausted');

  const nowDate = new Date(now);
  if (isWithinQuietHours(nowDate, settings.quietHoursStart, settings.quietHoursEnd)) {
    const deferUntil = getQuietHoursEndAt(nowDate, settings.quietHoursStart, settings.quietHoursEnd) ?? now + 60_000;
    return decision('silent', 'defer', 'quiet_hours', deferUntil);
  }
  return decision('notify', 'notify', 'notified');
}

/** 延后投递到点后再次评估：安静时段可能再次命中，预算可能已耗尽。 */
export function reevaluateDeferredDelivery(input: {
  event: EventRouteInput['event'];
  now: number;
  settings: ProactivityPolicySettings;
  budget: NotificationBudgetState;
}): EventRouteDecision {
  return routeProactiveEvent({
    ...input,
    lastPopupAt: null,
    alreadyDelivered: false,
  });
}

export function startOfLocalDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
