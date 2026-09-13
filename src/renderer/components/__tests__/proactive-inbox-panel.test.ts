import { describe, expect, it } from 'vitest';
import type { ProactiveInboxItemInfo } from '@/shared/types';
import {
  countBySection,
  describeWhy,
  formatInboxItemMeta,
  formatRelativeTime,
  SECTION_LABELS,
  SNOOZE_LABELS,
} from '../ProactiveInboxPanel';
import { PROACTIVE_EVENT_KINDS, SNOOZE_PRESETS_MINUTES } from '@/proactivity/contract';

const now = new Date(2026, 8, 13, 12, 0).getTime();

function item(overrides: Partial<ProactiveInboxItemInfo['event']> = {}, extra: Partial<ProactiveInboxItemInfo> = {}): ProactiveInboxItemInfo {
  return {
    event: {
      id: 'e1', domain: 'commitment', kind: 'commitment_due_soon', sourceType: 'commitment', sourceId: 'c1',
      sourceRef: null, dedupeKey: 'commitment:c1:due_soon:2026-09-13', sourceVersion: 0, title: '承诺临期：回复客户',
      summary: '将于 2026-09-13 13:00 到期。', urgency: 'high', status: 'open', dueAt: now + 3_600_000,
      occurredAt: now - 2 * 3_600_000, expiresAt: null, snoozedUntil: null, resolvedAt: null, resolvedReason: null,
      readAt: null, createdAt: now, updatedAt: now, ...overrides,
    },
    lastRoute: 'notify',
    lastRouteReason: 'notified',
    deliveredAt: now - 60_000,
    deferredUntil: null,
    ...extra,
  };
}

describe('ProactiveInboxPanel presenters', () => {
  it('formats meta with domain, kind, time, urgency and delivery state but never internal reasons', () => {
    const meta = formatInboxItemMeta(item(), now);
    expect(meta).toBe('承诺 · 承诺临期 · 2 小时前 · 紧急 · 已弹窗');
    expect(meta).not.toContain('notified');
    expect(formatInboxItemMeta(item({ status: 'snoozed', snoozedUntil: now + 30 * 60_000 }), now)).toContain('稍后：30 分钟后');
    expect(formatInboxItemMeta(item({}, { deliveredAt: null, deferredUntil: now + 7 * 3_600_000 }), now)).toContain('延后到 7 小时后');
    expect(formatInboxItemMeta(item({ status: 'resolved', resolvedReason: 'source:task' }, { deliveredAt: null }), now)).toContain('来源已解决');
    expect(formatInboxItemMeta(item({ status: 'dismissed' }, { deliveredAt: null }), now)).toContain('已忽略');
  });

  it('explains why every kind appears in plain language', () => {
    for (const kind of PROACTIVE_EVENT_KINDS) {
      expect(describeWhy(kind).length).toBeGreaterThan(4);
    }
  });

  it('labels sections and snooze presets consistently', () => {
    expect(Object.keys(SECTION_LABELS)).toEqual(['attention', 'later', 'handled']);
    for (const minutes of SNOOZE_PRESETS_MINUTES) expect(SNOOZE_LABELS[minutes]).toBeTruthy();
    expect(countBySection(null)).toEqual({ attention: 0, later: 0, handled: 0 });
    expect(countBySection({ attention: [item()], later: [], handled: [item(), item()], unreadCount: 1, generatedAt: now }))
      .toEqual({ attention: 1, later: 0, handled: 2 });
  });

  it('formats relative time in both directions', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('刚刚');
    expect(formatRelativeTime(now - 90 * 60_000, now)).toBe('1 小时前');
    expect(formatRelativeTime(now + 2 * 24 * 3_600_000, now)).toBe('2 天后');
  });
});
