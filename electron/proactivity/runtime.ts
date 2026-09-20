/**
 * 主进程侧的 P3 运行时：把纯逻辑的协调器 / 服务与 Electron 的弹窗、广播、设置和生命周期接起来。
 */
import { getPerformanceSettings, type PerformanceSettings } from '../../src/config/performance';
import { isDatabaseReady } from '../../src/db/state';
import { clearAllProactiveEvents } from '../../src/db/repositories/proactive-events';
import { createProactivityCoordinator, type ProactivityCoordinator, type ProactivityCycleTrigger } from '../../src/proactivity/coordinator';
import { getUnreadCount } from '../../src/proactivity/inbox';
import { runProactivityCycle, type CycleReport } from '../../src/proactivity/service';
import { setLocalStateChangeHandler } from '../../src/proactivity/signals';
import type { ProactiveEventDomain } from '../../src/shared/types';
import { showReminderPopup } from '../reminder/popup';
import { broadcastToAllRendererWindows } from '../windows/broadcast';

export const PROACTIVITY_INBOX_UPDATED_CHANNEL = 'proactivity:inbox:updated';

let coordinator: ProactivityCoordinator | null = null;
let lastReport: CycleReport | null = null;

export function broadcastInboxUpdated(): void {
  if (!isDatabaseReady()) return;
  let unreadCount = 0;
  try {
    unreadCount = getUnreadCount();
  } catch (error) {
    console.warn('[proactivity] 读取未读数失败:', error instanceof Error ? error.message : error);
  }
  broadcastToAllRendererWindows(PROACTIVITY_INBOX_UPDATED_CHANNEL, { ts: Date.now(), unreadCount });
}

function policySettings(settings: PerformanceSettings = getPerformanceSettings()) {
  return {
    proactivityEnabled: settings.proactivityEnabled,
    quietHoursStart: settings.quietHoursStart,
    quietHoursEnd: settings.quietHoursEnd,
    notificationDedupMinutes: settings.notificationDedupMinutes,
    notifyHourlyLimit: settings.notifyHourlyLimit,
    notifyDailyLimit: settings.notifyDailyLimit,
    mutedEventDomains: settings.mutedEventDomains,
  };
}

async function runCycle(
  domains: ReadonlySet<ProactiveEventDomain> | null,
  trigger: ProactivityCycleTrigger,
  signal: AbortSignal,
): Promise<void> {
  if (!isDatabaseReady()) return;
  lastReport = await runProactivityCycle({
    getSettings: () => policySettings(),
    popup: (title, body) => showReminderPopup(title, body),
    onInboxChanged: () => broadcastInboxUpdated(),
    log: (message) => console.info(message),
  }, { domains, trigger, signal });
  if (lastReport.created || lastReport.popupsSent || lastReport.resolvedBySource) {
    console.info(
      `[proactivity] ${trigger}: 新事件 ${lastReport.created}，来源解决 ${lastReport.resolvedBySource}，弹窗 ${lastReport.popupsSent}，延后补发 ${lastReport.deferredReplayed}`,
    );
  }
}

export function startProactivityRuntime(): void {
  if (coordinator) return;
  coordinator = createProactivityCoordinator({
    run: runCycle,
    onError: (error, trigger) => {
      console.error(`[proactivity] 采集周期失败 (${trigger}):`, error instanceof Error ? error.message : error);
    },
  });
  setLocalStateChangeHandler((domain) => coordinator?.signal(domain));
  coordinator.start();
}

export function wakeProactivityRuntime(): void {
  coordinator?.wake();
}

/** 手动刷新（收件箱按钮）：跑一整轮并等待完成。 */
export async function refreshProactivityNow(): Promise<CycleReport | null> {
  if (!coordinator) return null;
  await coordinator.requestFullCycle('manual');
  return lastReport;
}

export async function shutdownProactivityRuntime(timeoutMs = 5000): Promise<void> {
  setLocalStateChangeHandler(null);
  const current = coordinator;
  coordinator = null;
  if (current) await current.stop(timeoutMs);
}

/** 设置变化：关闭且不保留历史时清空收件箱；其余情况下重新评估一轮。 */
export function onProactivitySettingsChanged(settings: PerformanceSettings): void {
  if (!isDatabaseReady()) return;
  if (!settings.proactivityEnabled && !settings.keepInboxHistoryWhenDisabled) {
    try {
      const removed = clearAllProactiveEvents();
      if (removed) console.info(`[proactivity] 已按设置清空收件箱历史（${removed} 条）`);
    } catch (error) {
      console.error('[proactivity] 清空收件箱失败:', error instanceof Error ? error.message : error);
    }
    broadcastInboxUpdated();
    return;
  }
  coordinator?.wake();
  broadcastInboxUpdated();
}

export function getLastProactivityReport(): CycleReport | null {
  return lastReport;
}
