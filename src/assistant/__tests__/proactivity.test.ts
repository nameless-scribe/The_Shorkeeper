import { describe, expect, it } from 'vitest';
import {
  clearProactivityDecisions,
  evaluateReminderDelivery,
  getQuietHoursEndAt,
  isRepeatedNotification,
  isWithinQuietHours,
  listProactivityDecisions,
  recordProactivityDecision,
  resolveProactivityPolicy,
} from '../proactivity';

describe('proactivity policy', () => {
  it('notifies for an explicitly created scheduled reminder', () => {
    expect(resolveProactivityPolicy({
      kind: 'scheduled_reminder',
      explicit: true,
    })).toBe('notify');
  });

  it('suppresses disabled, quiet-hour, and repeated notifications', () => {
    expect(resolveProactivityPolicy({
      kind: 'scheduled_reminder',
      explicit: true,
      enabled: false,
    })).toBe('deny');
    expect(resolveProactivityPolicy({
      kind: 'scheduled_reminder',
      explicit: true,
      quietHours: true,
    })).toBe('silent');
    expect(resolveProactivityPolicy({
      kind: 'scheduled_reminder',
      explicit: true,
      repeated: true,
    })).toBe('silent');
  });

  it('keeps unrequested background work silent and external effects confirmable', () => {
    expect(resolveProactivityPolicy({
      kind: 'background_agent',
      explicit: false,
    })).toBe('silent');
    expect(resolveProactivityPolicy({
      kind: 'external_side_effect',
      explicit: false,
    })).toBe('deny');
    expect(resolveProactivityPolicy({
      kind: 'external_side_effect',
      explicit: true,
    })).toBe('confirm');
  });

  it('handles normal and overnight quiet-hour windows', () => {
    expect(isWithinQuietHours(new Date(2026, 0, 1, 23, 30), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(new Date(2026, 0, 2, 6, 59), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(new Date(2026, 0, 1, 12, 0), '22:00', '07:00')).toBe(false);
    expect(isWithinQuietHours(new Date(2026, 0, 1, 12, 0), '', '07:00')).toBe(false);
    expect(getQuietHoursEndAt(new Date(2026, 0, 1, 23, 30), '22:00', '07:00'))
      .toBe(new Date(2026, 0, 2, 7, 0, 0, 0).getTime());
    expect(getQuietHoursEndAt(new Date(2026, 0, 2, 6, 30), '22:00', '07:00'))
      .toBe(new Date(2026, 0, 2, 7, 0, 0, 0).getTime());
    expect(getQuietHoursEndAt(new Date(2026, 0, 1, 12, 0), '22:00', '07:00')).toBeNull();
  });

  it('suppresses only notifications inside the configured dedup window', () => {
    expect(isRepeatedNotification(100_000, 100_000 + 4 * 60_000, 5)).toBe(true);
    expect(isRepeatedNotification(100_000, 100_000 + 5 * 60_000, 5)).toBe(false);
    expect(isRepeatedNotification(null, 100_000, 5)).toBe(false);
  });

  it('defers once reminders in quiet hours and suppresses recurring ones', () => {
    expect(evaluateReminderDelivery({
      explicit: true,
      quietHours: true,
      scheduleKind: 'once',
    })).toEqual({
      policy: 'silent',
      action: 'defer',
      reason: 'quiet_hours',
    });
    expect(evaluateReminderDelivery({
      explicit: true,
      quietHours: true,
      scheduleKind: 'recurring',
    })).toEqual({
      policy: 'silent',
      action: 'suppress',
      reason: 'quiet_hours',
    });
    expect(evaluateReminderDelivery({
      explicit: true,
      enabled: false,
      scheduleKind: 'once',
    })).toEqual({
      policy: 'deny',
      action: 'suppress',
      reason: 'disabled',
    });
  });

  it('keeps a bounded decision log for later inspection', () => {
    clearProactivityDecisions();
    recordProactivityDecision({
      taskId: 'task-1',
      kind: 'scheduled_reminder',
      policy: 'silent',
      reason: 'quiet_hours',
      at: 100,
    });
    expect(listProactivityDecisions()).toEqual([
      expect.objectContaining({
        taskId: 'task-1',
        reason: 'quiet_hours',
        at: 100,
      }),
    ]);
    clearProactivityDecisions();
    expect(listProactivityDecisions()).toEqual([]);
  });
});
