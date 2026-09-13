import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTE_BY_KIND,
  EVENT_DOMAIN_BY_KIND,
  EVENT_KIND_LABELS,
  NOTIFY_ELIGIBLE_KINDS,
  PROACTIVE_EVENT_KINDS,
  SNOOZE_PRESETS_MINUTES,
  canTransitionEventStatus,
  dedupeKeys,
  idempotencyKeys,
  isSnoozePreset,
  localDateKey,
  reminderOccurrenceKey,
} from '../contract';

describe('P3.0 event contract', () => {
  it('maps every event kind to a domain, a label and a default route', () => {
    for (const kind of PROACTIVE_EVENT_KINDS) {
      expect(EVENT_DOMAIN_BY_KIND[kind]).toBeTruthy();
      expect(EVENT_KIND_LABELS[kind]).toBeTruthy();
      expect(DEFAULT_ROUTE_BY_KIND[kind]).toBe('inbox');
    }
  });

  it('only lets a short whitelist of kinds escalate to popups', () => {
    expect([...NOTIFY_ELIGIBLE_KINDS].sort()).toEqual(['commitment_due_soon', 'commitment_missed', 'schedule_failed']);
  });

  it('builds stable dedupe keys per source and state window', () => {
    expect(dedupeKeys.taskDue('t1', '2026-09-13')).toBe('task:t1:due:2026-09-13');
    expect(dedupeKeys.taskOverdue('t1', '2026-09-10')).toBe('task:t1:overdue:2026-09-10');
    expect(dedupeKeys.commitment('c1', 'missed', '2026-09-13')).toBe('commitment:c1:missed:2026-09-13');
    expect(dedupeKeys.run('r1', 'error')).toBe('run:r1:error');
    expect(dedupeKeys.scheduleFailure('s1', '2026-09-13')).toBe('schedule:s1:failure:2026-09-13');
    expect(dedupeKeys.document('d1', 'changed', 3)).toBe('doc:d1:changed:3');
    expect(dedupeKeys.memory('m1', 'conflict')).toBe('memory:m1:conflict');
    expect(dedupeKeys.goal('g1', 'stalled', '2026-08-30')).toBe('goal:g1:stalled:2026-08-30');
  });

  it('keeps decision and delivery idempotency keys distinct per attempt', () => {
    expect(idempotencyKeys.eventDecision('e1', 0, 'initial')).not.toBe(idempotencyKeys.eventDecision('e1', 0, 'wake:1'));
    expect(idempotencyKeys.eventDelivery('e1', 0)).toBe('delivery:event:e1:0');
    expect(idempotencyKeys.reminderDelivery('task', 'once:100')).toBe('delivery:reminder:task:once:100');
    expect(reminderOccurrenceKey(90_000)).toBe('1');
    expect(reminderOccurrenceKey(119_999)).toBe('1');
    expect(reminderOccurrenceKey(120_000)).toBe('2');
  });

  it('enforces the event status machine', () => {
    expect(canTransitionEventStatus('open', 'snoozed')).toBe(true);
    expect(canTransitionEventStatus('open', 'dismissed')).toBe(true);
    expect(canTransitionEventStatus('snoozed', 'open')).toBe(true);
    expect(canTransitionEventStatus('dismissed', 'open')).toBe(false);
    expect(canTransitionEventStatus('resolved', 'open')).toBe(false);
    expect(canTransitionEventStatus('resolved', 'dismissed')).toBe(false);
  });

  it('accepts only preset snooze durations', () => {
    for (const minutes of SNOOZE_PRESETS_MINUTES) expect(isSnoozePreset(minutes)).toBe(true);
    expect(isSnoozePreset(45)).toBe(false);
  });

  it('formats local date keys', () => {
    expect(localDateKey(new Date(2026, 8, 3, 23, 59).getTime())).toBe('2026-09-03');
  });
});
