import { trustedIpcMain as ipcMain } from './trusted-ipc';
import type {
  ProactiveEventInfo,
  ProactiveInboxSnapshot,
  ProactiveSourceTarget,
  ProactivityFeedbackReason,
  ProactivityMetricsInfo,
} from '../../src/shared/types';
import { requireEnum, requireFiniteNumber, requireString } from '../../src/shared/ipc-validation';
import {
  clearHandledInboxEvents,
  dismissInboxEvent,
  getInboxSnapshot,
  getProactivityMetrics,
  getUnreadCount,
  markAllInboxRead,
  markInboxEventRead,
  openInboxEventSource,
  resolveInboxEvent,
  snoozeInboxEvent,
} from '../../src/proactivity/inbox';
import { SNOOZE_PRESETS_MINUTES } from '../../src/proactivity/contract';
import { broadcastInboxUpdated, refreshProactivityNow } from '../proactivity/runtime';

function parseEventId(value: unknown): string {
  return requireString(value, '事件 ID', { maxLength: 64 });
}

const DISMISS_REASONS = ['not_relevant', 'already_handled', 'too_noisy'] as const satisfies readonly ProactivityFeedbackReason[];

function parseReason(value: unknown): ProactivityFeedbackReason | null {
  if (value == null) return null;
  return requireEnum(value, '忽略原因', DISMISS_REASONS);
}

export function registerProactivityIpc(): void {
  ipcMain.handle('proactivity:inbox', (): ProactiveInboxSnapshot => getInboxSnapshot());

  ipcMain.handle('proactivity:unreadCount', (): number => getUnreadCount());

  ipcMain.handle('proactivity:markRead', (_event, id: unknown): ProactiveEventInfo | null => {
    const updated = markInboxEventRead(parseEventId(id));
    broadcastInboxUpdated();
    return updated;
  });

  ipcMain.handle('proactivity:markAllRead', (): number => {
    const count = markAllInboxRead();
    if (count > 0) broadcastInboxUpdated();
    return count;
  });

  ipcMain.handle('proactivity:dismiss', (_event, id: unknown, reason: unknown): ProactiveEventInfo | null => {
    const updated = dismissInboxEvent(parseEventId(id), parseReason(reason));
    broadcastInboxUpdated();
    return updated;
  });

  ipcMain.handle('proactivity:snooze', (_event, id: unknown, minutes: unknown): ProactiveEventInfo | null => {
    const value = requireFiniteNumber(minutes, '稍后时长', { min: 1, max: 30 * 24 * 60 });
    if (!(SNOOZE_PRESETS_MINUTES as readonly number[]).includes(value)) {
      throw new TypeError('稍后时长必须是预设档位');
    }
    const updated = snoozeInboxEvent(parseEventId(id), value);
    broadcastInboxUpdated();
    return updated;
  });

  ipcMain.handle('proactivity:resolve', (_event, id: unknown): ProactiveEventInfo | null => {
    const updated = resolveInboxEvent(parseEventId(id));
    broadcastInboxUpdated();
    return updated;
  });

  ipcMain.handle('proactivity:openSource', (_event, id: unknown): ProactiveSourceTarget | null => {
    const target = openInboxEventSource(parseEventId(id));
    broadcastInboxUpdated();
    return target;
  });

  ipcMain.handle('proactivity:clearHandled', (): number => {
    const removed = clearHandledInboxEvents();
    if (removed > 0) broadcastInboxUpdated();
    return removed;
  });

  ipcMain.handle('proactivity:refresh', async (): Promise<ProactiveInboxSnapshot> => {
    await refreshProactivityNow();
    return getInboxSnapshot();
  });

  ipcMain.handle('proactivity:metrics', (_event, days: unknown): ProactivityMetricsInfo => {
    const span = days == null ? 14 : requireFiniteNumber(days, '统计天数', { min: 1, max: 90 });
    const until = Date.now();
    return getProactivityMetrics(until - span * 24 * 60 * 60 * 1000, until);
  });
}
