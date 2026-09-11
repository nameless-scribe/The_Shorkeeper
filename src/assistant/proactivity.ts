import type { AssistantActionPolicy } from '../shared/types';

export interface ProactivityDecisionInput {
  kind: 'scheduled_reminder' | 'background_agent' | 'external_side_effect';
  explicit: boolean;
  enabled?: boolean;
  quietHours?: boolean;
  repeated?: boolean;
  failed?: boolean;
}

export type ProactivityReason =
  | 'notified'
  | 'disabled'
  | 'quiet_hours'
  | 'repeated'
  | 'silent'
  | 'confirm'
  | 'deny';

export interface ProactivityDecisionRecord {
  at: number;
  taskId: string;
  kind: ProactivityDecisionInput['kind'];
  policy: AssistantActionPolicy;
  reason: ProactivityReason;
}

export interface ReminderDeliveryDecision {
  policy: AssistantActionPolicy;
  action: 'notify' | 'suppress' | 'defer';
  reason: ProactivityReason;
}

const MAX_DECISIONS = 50;
const recentDecisions: ProactivityDecisionRecord[] = [];

export function recordProactivityDecision(
  record: Omit<ProactivityDecisionRecord, 'at'> & { at?: number },
): ProactivityDecisionRecord {
  const stored: ProactivityDecisionRecord = {
    at: record.at ?? Date.now(),
    taskId: record.taskId,
    kind: record.kind,
    policy: record.policy,
    reason: record.reason,
  };
  recentDecisions.unshift(stored);
  if (recentDecisions.length > MAX_DECISIONS) recentDecisions.pop();
  return stored;
}

export function listProactivityDecisions(): ProactivityDecisionRecord[] {
  return recentDecisions.slice();
}

export function clearProactivityDecisions(): void {
  recentDecisions.length = 0;
}

function parseClock(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function isWithinQuietHours(now: Date, start: string, end: string): boolean {
  const startMinute = parseClock(start);
  const endMinute = parseClock(end);
  if (startMinute == null || endMinute == null || startMinute === endMinute) return false;

  const current = now.getHours() * 60 + now.getMinutes();
  return startMinute < endMinute
    ? current >= startMinute && current < endMinute
    : current >= startMinute || current < endMinute;
}

export function getQuietHoursEndAt(now: Date, start: string, end: string): number | null {
  if (!isWithinQuietHours(now, start, end)) return null;
  const endMinute = parseClock(end);
  if (endMinute == null) return null;

  const result = new Date(now);
  result.setSeconds(0, 0);
  result.setHours(Math.floor(endMinute / 60), endMinute % 60, 0, 0);
  if (result.getTime() <= now.getTime()) {
    result.setDate(result.getDate() + 1);
  }
  return result.getTime();
}

export function isRepeatedNotification(
  lastNotifiedAt: number | null | undefined,
  now: number,
  dedupMinutes: number,
): boolean {
  if (lastNotifiedAt == null || dedupMinutes <= 0) return false;
  return now - lastNotifiedAt < dedupMinutes * 60_000;
}

/**
 * 决定主动行为的用户可见策略；不执行工具，也不替代权限确认。
 * 已明确订阅的提醒默认通知，其他后台行为默认静默。
 */
export function resolveProactivityPolicy(
  input: ProactivityDecisionInput,
): AssistantActionPolicy {
  if (input.enabled === false) return 'deny';
  if (input.kind === 'external_side_effect') return input.explicit ? 'confirm' : 'deny';
  if (input.repeated || input.quietHours) return 'silent';
  if (input.kind === 'scheduled_reminder' && input.explicit) return 'notify';
  if (input.failed) return input.explicit ? 'notify' : 'silent';
  return 'silent';
}

export function evaluateReminderDelivery(input: {
  explicit: boolean;
  enabled?: boolean;
  quietHours?: boolean;
  repeated?: boolean;
  scheduleKind?: 'once' | 'recurring';
}): ReminderDeliveryDecision {
  const policy = resolveProactivityPolicy({
    kind: 'scheduled_reminder',
    explicit: input.explicit,
    enabled: input.enabled,
    quietHours: input.quietHours,
    repeated: input.repeated,
  });

  if (policy === 'notify') {
    return { policy, action: 'notify', reason: 'notified' };
  }
  if (input.enabled === false) {
    return { policy, action: 'suppress', reason: 'disabled' };
  }
  if (input.quietHours) {
    return {
      policy,
      action: input.scheduleKind === 'once' ? 'defer' : 'suppress',
      reason: 'quiet_hours',
    };
  }
  if (input.repeated) {
    return { policy, action: 'suppress', reason: 'repeated' };
  }
  return { policy, action: 'suppress', reason: 'silent' };
}
