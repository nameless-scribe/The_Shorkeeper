import { describe, expect, it } from 'vitest';
import {
  isNotificationBudgetExhausted,
  isNotifyEligible,
  routeProactiveEvent,
  type ProactivityPolicySettings,
} from '../policy';
import { PROACTIVITY_RULE_VERSION } from '../contract';

const settings: ProactivityPolicySettings = {
  proactivityEnabled: true,
  quietHoursStart: '',
  quietHoursEnd: '',
  notificationDedupMinutes: 5,
  notifyHourlyLimit: 3,
  notifyDailyLimit: 12,
  mutedEventDomains: [],
};

const highCommitment = {
  id: 'e1',
  kind: 'commitment_due_soon' as const,
  domain: 'commitment' as const,
  urgency: 'high' as const,
  status: 'open' as const,
  expiresAt: null,
};

const base = {
  now: new Date(2026, 8, 13, 15, 0).getTime(),
  settings,
  budget: { sentLastHour: 0, sentToday: 0 },
  lastPopupAt: null,
  alreadyDelivered: false,
};

describe('P3.3 proactivity routing policy', () => {
  it('sends everything to the inbox by default and records the rule version', () => {
    const decision = routeProactiveEvent({ ...base, event: { ...highCommitment, kind: 'task_overdue', domain: 'task', urgency: 'normal' } });
    expect(decision).toMatchObject({ route: 'inbox', reason: 'inbox_default', policy: 'silent', ruleVersion: PROACTIVITY_RULE_VERSION });
    expect(routeProactiveEvent({ ...base, event: { ...highCommitment, kind: 'goal_stalled', domain: 'goal', urgency: 'low' } }))
      .toMatchObject({ route: 'inbox', reason: 'low_urgency' });
  });

  it('only high-urgency whitelisted kinds become popups', () => {
    expect(isNotifyEligible({ kind: 'commitment_due_soon', urgency: 'high' })).toBe(true);
    expect(isNotifyEligible({ kind: 'commitment_due_soon', urgency: 'normal' })).toBe(false);
    expect(isNotifyEligible({ kind: 'document_changed', urgency: 'high' })).toBe(false);
    expect(routeProactiveEvent({ ...base, event: highCommitment })).toMatchObject({ route: 'notify', reason: 'notified', policy: 'notify' });
  });

  it('suppresses when disabled, resolved, dismissed, snoozed or expired', () => {
    expect(routeProactiveEvent({ ...base, settings: { ...settings, proactivityEnabled: false }, event: highCommitment }))
      .toMatchObject({ route: 'suppress', reason: 'disabled', policy: 'deny' });
    expect(routeProactiveEvent({ ...base, event: { ...highCommitment, status: 'resolved' } })).toMatchObject({ reason: 'resolved' });
    expect(routeProactiveEvent({ ...base, event: { ...highCommitment, status: 'dismissed' } })).toMatchObject({ reason: 'dismissed' });
    expect(routeProactiveEvent({ ...base, event: { ...highCommitment, status: 'snoozed' } })).toMatchObject({ reason: 'snoozed' });
    expect(routeProactiveEvent({ ...base, event: { ...highCommitment, expiresAt: base.now - 1 } })).toMatchObject({ reason: 'expired' });
  });

  it('blocks repeated popups from the persisted delivery history', () => {
    expect(routeProactiveEvent({ ...base, event: highCommitment, alreadyDelivered: true })).toMatchObject({ route: 'suppress', reason: 'repeated' });
    expect(routeProactiveEvent({ ...base, event: highCommitment, lastPopupAt: base.now - 60_000 })).toMatchObject({ route: 'suppress', reason: 'repeated' });
    expect(routeProactiveEvent({ ...base, event: highCommitment, lastPopupAt: base.now - 10 * 60_000 })).toMatchObject({ route: 'notify' });
  });

  it('downgrades muted domains and exhausted budgets to the inbox instead of dropping them', () => {
    expect(routeProactiveEvent({ ...base, event: highCommitment, settings: { ...settings, mutedEventDomains: ['commitment'] } }))
      .toMatchObject({ route: 'inbox', reason: 'domain_muted' });
    expect(routeProactiveEvent({ ...base, event: highCommitment, budget: { sentLastHour: 3, sentToday: 3 } }))
      .toMatchObject({ route: 'inbox', reason: 'budget_exhausted' });
    expect(routeProactiveEvent({ ...base, event: highCommitment, budget: { sentLastHour: 0, sentToday: 12 } }))
      .toMatchObject({ route: 'inbox', reason: 'budget_exhausted' });
    expect(isNotificationBudgetExhausted({ sentLastHour: 99, sentToday: 99 }, { notifyHourlyLimit: 0, notifyDailyLimit: 0 })).toBe(false);
  });

  it('defers popups inside quiet hours, including across midnight', () => {
    const night = new Date(2026, 8, 13, 23, 30).getTime();
    const decision = routeProactiveEvent({
      ...base,
      now: night,
      event: highCommitment,
      settings: { ...settings, quietHoursStart: '22:00', quietHoursEnd: '07:00' },
    });
    expect(decision).toMatchObject({ route: 'defer', reason: 'quiet_hours' });
    expect(decision.deferUntil).toBe(new Date(2026, 8, 14, 7, 0, 0, 0).getTime());
  });
});
